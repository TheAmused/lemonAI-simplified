"""Server-side validation of uploaded model manifests.

The JSON Schema (``schemas/manifest.v1.schema.json``) is generated from the Rust types, so the
Hub accepts exactly the structure the desktop runtime can parse. A handful of cross-field rules
that JSON Schema cannot express are re-implemented here. The desktop app validates again with the
Rust implementation before installing anything, so this is a first gate, not the only one.

``schemas/runtime-policy.json`` holds the install/argument allow-lists. Both this module and the
Rust ``manifest-engine`` read it, so the two gates cannot drift apart.
"""

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

FORBIDDEN_WEIGHT_EXTENSIONS = (".pt", ".bin", ".ckpt", ".pth", ".pkl", ".pickle")
SLUG_PATTERN = re.compile(r"^[a-z0-9_-]+$")
SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")
MAX_ERRORS = 8

_FORBIDDEN_FLAGS = {
    "--port", "--host", "--model", "-m", "--api-key", "--api-key-file", "-mu", "-md", "-dr",
    "--path", "--static-path", "--ssl-key-file", "--ssl-cert-file",
}


def schema_dir(configured: str | None = None) -> Path:
    candidates = [configured, os.getenv("LEMON_SCHEMA_DIR")]
    candidates.append(str(Path(__file__).resolve().parents[2] / "schemas"))
    candidates.append("/app/schemas")
    for candidate in candidates:
        if candidate and (Path(candidate) / "manifest.v1.schema.json").is_file():
            return Path(candidate)
    raise FileNotFoundError(
        "manifest.v1.schema.json not found; set LEMON_SCHEMA_DIR to the directory containing it"
    )


@lru_cache(maxsize=4)
def _validator(directory: str) -> Draft7Validator:
    schema = json.loads((Path(directory) / "manifest.v1.schema.json").read_text(encoding="utf-8"))
    return Draft7Validator(schema)


@lru_cache(maxsize=4)
def runtime_policy(directory: str) -> dict:
    """``schemas/runtime-policy.json``: the same allow-lists the desktop app compiles in."""
    return json.loads((Path(directory) / "runtime-policy.json").read_text(encoding="utf-8"))


def normalize_package_name(name: str) -> str:
    """PEP 503 normalisation (mirror of `normalize_package_name` in manifest-engine)."""
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_name(spec: str) -> str:
    match = re.match(r"[A-Za-z0-9._-]*", spec.strip())
    return match.group(0) if match else ""


_PLAIN_VALUE = re.compile(r"^[A-Za-z0-9._,:+-]{1,64}$")
_NEGATIVE_NUMBER = re.compile(r"^-[0-9][0-9.]*$")


def _is_plain_value(token: str) -> bool:
    if token.startswith("-"):
        return bool(_NEGATIVE_NUMBER.match(token)) and len(token) <= 64
    return bool(_PLAIN_VALUE.match(token))


def check_llama_arguments(args: list[str], policy: dict) -> list[str]:
    """Mirror of `RuntimePolicy::check_llama_arguments`: flags must be on the allow-list."""
    flags: dict[str, str] = policy["llama_server_flags"]
    limit = policy["max_runtime_arguments"]
    if len(args) > limit:
        return [f"runtime.arguments: at most {limit} runtime arguments are allowed"]
    i = 0
    while i < len(args):
        token = args[i]
        name, sep, inline = token.partition("=")
        kind = flags.get(name)
        if kind is None:
            if token.startswith("-"):
                return [f"runtime.arguments: llama-server flag '{name}' is not on the allow-list"]
            return [f"runtime.arguments: unexpected positional argument '{token}'"]
        if sep:
            if kind == "switch":
                return [f"runtime.arguments: flag '{name}' does not take a value"]
            if not _is_plain_value(inline):
                return [f"runtime.arguments: value '{inline}' for '{name}' is not allowed"]
        elif kind == "value":
            if i + 1 >= len(args):
                return [f"runtime.arguments: flag '{name}' needs a value"]
            if not _is_plain_value(args[i + 1]):
                return [f"runtime.arguments: value '{args[i + 1]}' for '{name}' is not allowed"]
            i += 1
        elif kind == "optional_value" and i + 1 < len(args):
            nxt = args[i + 1]
            if nxt.split("=", 1)[0] not in flags:
                if not _is_plain_value(nxt):
                    return [f"runtime.arguments: value '{nxt}' for '{name}' is not allowed"]
                i += 1
        i += 1
    return []


def loads_strict(text: str | bytes) -> Any:
    """``json.loads`` that rejects ``NaN`` / ``Infinity`` (Python accepts them, JavaScript cannot)."""

    def _reject(constant: str) -> Any:
        raise ValueError(f"non-finite number '{constant}' is not allowed")

    return json.loads(text, parse_constant=_reject)


def is_forbidden_flag(arg: str) -> bool:
    name = arg.split("=", 1)[0].strip().lower()
    if not name.startswith("-"):
        return False
    return (
        name in _FORBIDDEN_FLAGS
        or "url" in name
        or name.startswith(("--hf-", "-hf", "--docker", "--model-"))
    )


def _is_forbidden_weight(value: str) -> bool:
    lowered = value.lower().strip(" \"'").rstrip("/\\.")
    candidates = [lowered]
    if "=" in lowered:
        candidates.append(lowered.split("=", 1)[1].strip("\"'").rstrip("/\\."))
    return any(c.endswith(FORBIDDEN_WEIGHT_EXTENSIONS) for c in candidates)


def _bad_relative_path(value: str) -> str | None:
    if "\0" in value:
        return "contains a NUL byte"
    stripped = value.strip()
    if not stripped:
        return "is empty"
    if stripped.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", stripped):
        return "must be a relative path"
    if any(part == ".." for part in re.split(r"[\\/]", stripped)):
        return "must not contain '..'"
    return None


_REPO_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")


def valid_hf_repo_id(repo_id: str) -> bool:
    """``owner/name`` using ``[A-Za-z0-9._-]`` (mirror of `validate_hf_repo_id` in Rust)."""
    parts = repo_id.split("/")
    return len(parts) == 2 and all(_REPO_PART.match(p) for p in parts)


def _bad_argument(arg: str) -> str | None:
    """Mirror of the path rules Rust applies to every runtime argument and its ``--k=v`` value."""
    values = [arg] + ([arg.split("=", 1)[1]] if "=" in arg else [])
    for value in values:
        trimmed = value.strip(" \"'")
        if not trimmed:
            continue
        if "\0" in trimmed:
            return "contains a NUL byte"
        if trimmed.startswith(("\\\\", "//", "/", "\\")) or re.match(r"^[A-Za-z]:", trimmed):
            return "must not be an absolute or UNC path"
        if any(part == ".." for part in re.split(r"[\\/]", trimmed)):
            return "must not contain '..'"
    return None


def _validate_install_steps(
    steps: list[dict[str, Any]],
    archetype: str,
    archetype_policy: dict[str, Any] | None,
    prefix: str = "install",
) -> list[str]:
    problems: list[str] = []
    for idx, step in enumerate(steps):
        for key in ("destination", "filename"):
            value = step.get(key)
            if value is None:
                continue
            if _is_forbidden_weight(value):
                problems.append(f"{prefix}[{idx}].{key}: pickle-based weight formats are not allowed")
            reason = _bad_relative_path(value)
            if reason:
                problems.append(f"{prefix}[{idx}].{key} {reason}")
        if step.get("repo_id") is not None and not valid_hf_repo_id(step["repo_id"]):
            problems.append(f"{prefix}[{idx}].repo_id: '{step['repo_id']}' is not a valid owner/name repo id")
        if step.get("step_type") == "uv_pip_install" and not step.get("packages"):
            problems.append(f"{prefix}[{idx}].packages: uv_pip_install needs packages")
        if step.get("extra_index_urls"):
            problems.append(f"{prefix}[{idx}].extra_index_urls: manifests may not add package indexes")
        if step.get("step_type") == "uv_pip_install":
            allowed = archetype_policy.get("allowed_packages", []) if archetype_policy else []
            allowed_names = {normalize_package_name(a) for a in allowed}
            for pkg in step.get("packages") or []:
                name = normalize_package_name(requirement_name(pkg))
                if name not in allowed_names:
                    problems.append(
                        f"{prefix}[{idx}].packages: package '{name}' is not allowed for "
                        f"{archetype} models (allowed: {', '.join(allowed) or 'none'})"
                    )
        if step.get("step_type") == "hf_download" and not (step.get("repo_id") and step.get("destination")):
            problems.append(f"{prefix}[{idx}]: hf_download needs repo_id and destination")
        if step.get("step_type") == "civitai_download":
            version_id = step.get("civitai_version_id")
            if isinstance(version_id, bool) or not isinstance(version_id, int) or version_id <= 0:
                problems.append(
                    f"{prefix}[{idx}].civitai_version_id: civitai_download requires a positive integer civitai_version_id"
                )
            if not step.get("destination"):
                problems.append(f"{prefix}[{idx}].destination: civitai_download requires destination")
        sha = step.get("sha256")
        if sha is not None and (not isinstance(sha, str) or not SHA256_PATTERN.match(sha)):
            problems.append(f"{prefix}[{idx}].sha256: must be a 64-character hexadecimal string")
    return problems


def _validate_bounds_pair(
    bounds: Any,
    prefix: str,
    problems: list[str],
) -> tuple[int | None, int | None]:
    if not isinstance(bounds, dict):
        return None, None
    rec = bounds.get("recommended")
    max_sup = bounds.get("max_supported")
    valid_rec = isinstance(rec, int) and not isinstance(rec, bool)
    valid_max = isinstance(max_sup, int) and not isinstance(max_sup, bool)
    if valid_rec and valid_max and rec > max_sup:
        problems.append(
            f"{prefix}.recommended: recommended ({rec}) cannot exceed max_supported ({max_sup})"
        )
    return (rec if valid_rec else None), (max_sup if valid_max else None)


def _validate_output_tokens(
    ot: Any,
    cw_max_sup: int | None,
    prefix: str,
    problems: list[str],
) -> None:
    _, ot_max = _validate_bounds_pair(ot, prefix, problems)
    if ot_max is not None and cw_max_sup is not None and ot_max > cw_max_sup:
        problems.append(
            f"{prefix}.max_supported: max_supported ({ot_max}) cannot exceed context_window.max_supported ({cw_max_sup})"
        )


def _validate_runtime(
    runtime: dict[str, Any],
    policy: dict[str, Any],
    prefix: str = "runtime",
    inherited_max_ctx: int | None = None,
) -> list[str]:
    problems: list[str] = []
    archetype = runtime["archetype"]
    entry = runtime["entrypoint"]
    if _is_forbidden_weight(entry):
        problems.append(f"{prefix}.entrypoint: pickle-based weight formats are not allowed")
    reason = _bad_relative_path(entry)
    if reason:
        problems.append(f"{prefix}.entrypoint {reason}")
    arguments = runtime.get("arguments", [])
    for arg in arguments:
        if _is_forbidden_weight(arg):
            problems.append(f"{prefix}.arguments: '{arg}' references a pickle-based weight format")
        elif is_forbidden_flag(arg):
            problems.append(f"{prefix}.arguments: '{arg}' is managed by the launcher")
        else:
            reason = _bad_argument(arg)
            if reason:
                problems.append(f"{prefix}.arguments: '{arg}' {reason}")
    if archetype == "llama_cpp_server":
        for err in check_llama_arguments(arguments, policy):
            if prefix != "runtime" and err.startswith("runtime."):
                problems.append(f"{prefix}.{err[len('runtime.'):]}")
            else:
                problems.append(err)
    elif arguments:
        problems.append(f"{prefix}.arguments: Python runner archetypes do not accept runtime arguments")
    _, cw_max_sup = _validate_bounds_pair(runtime.get("context_window"), f"{prefix}.context_window", problems)
    effective_max_ctx = cw_max_sup if cw_max_sup is not None else inherited_max_ctx
    _validate_output_tokens(runtime.get("output_tokens"), effective_max_ctx, f"{prefix}.output_tokens", problems)
    return problems


def _validate_hardware(hw: dict[str, Any], prefix: str = "hardware_requirements") -> list[str]:
    if hw["min_vram_gb"] > 1024 or hw["min_ram_gb"] > 4096:
        return [f"{prefix}: values are not plausible"]
    return []


def validate_manifest(manifest: Any, schema_directory: str | None = None) -> list[str]:
    """Returns a list of human-readable problems (empty when the manifest is acceptable)."""
    if not isinstance(manifest, dict):
        return ["manifest must be a JSON object"]

    directory = str(schema_dir(schema_directory))
    problems = [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in sorted(_validator(directory).iter_errors(manifest), key=lambda e: list(map(str, e.absolute_path)))
    ][:MAX_ERRORS]
    if problems:
        return problems

    policy = runtime_policy(directory)
    runtime = manifest["runtime"]
    archetype = runtime["archetype"]
    archetype_policy = policy["archetypes"].get(archetype)

    problems.extend(_validate_install_steps(manifest["install"], archetype, archetype_policy))
    problems.extend(_validate_runtime(runtime, policy))

    names = [i["name"] for i in manifest["ui"]["inputs"]]
    if len(names) != len(set(names)):
        problems.append("ui.inputs: input names must be unique")

    problems.extend(_validate_hardware(manifest["hardware_requirements"]))

    base_cw = runtime.get("context_window")
    base_max_ctx = (
        base_cw.get("max_supported")
        if isinstance(base_cw, dict)
        and isinstance(base_cw.get("max_supported"), int)
        and not isinstance(base_cw.get("max_supported"), bool)
        else None
    )

    seen_variant_ids: set[str] = set()
    for v_idx, variant in enumerate(manifest.get("variants") or []):
        vid = variant.get("id")
        if isinstance(vid, str):
            if vid in seen_variant_ids:
                problems.append(f"variants[{v_idx}].id: duplicate variant id '{vid}'")
            else:
                seen_variant_ids.add(vid)
        v_runtime = variant.get("runtime")
        v_archetype = v_runtime["archetype"] if isinstance(v_runtime, dict) and v_runtime.get("archetype") else archetype
        v_archetype_policy = policy["archetypes"].get(v_archetype)
        v_install = variant.get("install")
        if v_install is not None:
            problems.extend(
                _validate_install_steps(v_install, v_archetype, v_archetype_policy, prefix=f"variants[{v_idx}].install")
            )
        if v_runtime is not None:
            problems.extend(
                _validate_runtime(
                    v_runtime,
                    policy,
                    prefix=f"variants[{v_idx}].runtime",
                    inherited_max_ctx=base_max_ctx,
                )
            )
        _, v_cw_max = _validate_bounds_pair(
            variant.get("context_window"),
            f"variants[{v_idx}].context_window",
            problems,
        )
        v_rt_cw = v_runtime.get("context_window") if isinstance(v_runtime, dict) else None
        v_rt_cw_max = (
            v_rt_cw.get("max_supported")
            if isinstance(v_rt_cw, dict)
            and isinstance(v_rt_cw.get("max_supported"), int)
            and not isinstance(v_rt_cw.get("max_supported"), bool)
            else None
        )
        effective_v_max_ctx = v_cw_max if v_cw_max is not None else (v_rt_cw_max if v_rt_cw_max is not None else base_max_ctx)
        _validate_output_tokens(
            variant.get("output_tokens"),
            effective_v_max_ctx,
            f"variants[{v_idx}].output_tokens",
            problems,
        )
        v_hw = variant.get("hardware_requirements")
        if v_hw is not None:
            problems.extend(_validate_hardware(v_hw, prefix=f"variants[{v_idx}].hardware_requirements"))

    return problems[:MAX_ERRORS]
