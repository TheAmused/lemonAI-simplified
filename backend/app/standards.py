"""Hub standards for community entries.

``validate_manifest`` decides whether a manifest is *safe and well-formed*; this module decides
whether an entry is *good enough to list without a moderator looking at it*. Problems come in two
levels:

* ``error``: the entry is held for review (status ``pending``) instead of being published, e.g. it
  poses as an official LemonAI model;
* ``warning``: shown to the author and to moderators, the entry is still published.

Every problem has a stable ``code`` (the desktop app shows its own translated text for known codes)
and an English ``message``.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from sqlalchemy.orm import Session

MIN_DESCRIPTION_CHARS = 40
_OFFICIAL_WORDS = re.compile(r"lemon\s*-?\s*ai|\bofficial\b|\boficjaln", re.I)


def _fold(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", ascii_text.lower())


def _issue(code: str, level: str, message: str) -> dict[str, str]:
    return {"code": code, "level": level, "message": message}


def official_names(db: Session) -> set[str]:
    """Folded names of the official (system-owned) catalogue entries."""
    from app.models import SYSTEM_ROLE, Script, User

    rows = db.query(Script.name).join(User, Script.author_id == User.id).filter(User.role == SYSTEM_ROLE).all()
    return {_fold(name) for (name,) in rows}


def check_standards(
    *,
    name: str,
    description: str,
    manifest: dict[str, Any],
    has_preview_image: bool,
    official: set[str],
) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    if _fold(name) and _fold(name) in official:
        issues.append(_issue(
            "impersonation_name", "error",
            "The name is the same as an official LemonAI model; choose a name of your own.",
        ))
    author = str(manifest.get("author") or "")
    if _OFFICIAL_WORDS.search(author) or _OFFICIAL_WORDS.search(name):
        issues.append(_issue(
            "impersonation_author", "error",
            "Community entries must not present themselves as LemonAI or official.",
        ))

    if len(description.strip()) < MIN_DESCRIPTION_CHARS:
        issues.append(_issue(
            "short_description", "warning",
            f"Describe what the model does and what it needs (at least {MIN_DESCRIPTION_CHARS} characters).",
        ))
    if not has_preview_image:
        issues.append(_issue("no_preview_image", "warning", "Add a preview image."))

    licence = str(manifest.get("license") or "").strip().lower()
    if licence in ("", "unknown", "none", "n/a", "?"):
        issues.append(_issue("no_license", "warning", "State the licence of the model weights."))

    all_install_steps: list[Any] = list(manifest.get("install") or [])
    for variant in manifest.get("variants") or []:
        if isinstance(variant, dict):
            all_install_steps.extend(variant.get("install") or [])

    for step in all_install_steps:
        if not isinstance(step, dict) or step.get("step_type") not in ("hf_download", "civitai_download"):
            continue
        if (step.get("filename") or step.get("step_type") == "civitai_download") and not step.get("sha256"):
            target = step.get("filename") or step.get("destination") or "weights"
            issues.append(_issue(
                "no_checksum", "warning",
                f"'{target}' has no SHA-256, so a changed file in the repository would be installed unchecked.",
            ))
            break

    hardware = manifest.get("hardware_requirements") or {}
    accelerators = hardware.get("supported_accelerators") or []
    try:
        vram = float(hardware.get("min_vram_gb") or 0)
    except (TypeError, ValueError):
        vram = 0.0
    if accelerators and "cpu" not in accelerators and vram <= 0:
        issues.append(_issue(
            "unrealistic_requirements", "warning",
            "A GPU-only model needs a minimum VRAM above 0 GB.",
        ))

    return issues


def has_errors(issues: list[dict[str, str]]) -> bool:
    return any(issue["level"] == "error" for issue in issues)
