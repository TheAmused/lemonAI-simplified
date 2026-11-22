import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.manifest_validation import (
    is_forbidden_flag,
    loads_strict,
    normalize_package_name,
    validate_manifest,
)
from app.models import User
from app.standards import check_standards

REPO_ROOT = Path(__file__).resolve().parents[2]
HUB_DIR = REPO_ROOT / "schemas" / "hub"


def load_sample_manifest(name: str = "llama-3-2-1b") -> dict:
    return json.loads((HUB_DIR / f"{name}.json").read_text(encoding="utf-8"))


def test_is_forbidden_flag_blocks_launcher_flags():
    flags = ["--port", "--port=8080", "-m", "--MODEL", "--model-url=https://evil.example/x.gguf"]

    results = [is_forbidden_flag(flag) for flag in flags]

    assert all(results)


def test_is_forbidden_flag_allows_tuning_flags():
    flags = ["--ctx-size", "--n-gpu-layers", "-c", "4096", "--flash-attn"]

    results = [is_forbidden_flag(flag) for flag in flags]

    assert not any(results)


def test_normalize_package_name_follows_pep503():
    raw_names = ["HuggingFace_Hub", "torch.cuda", "sentence--transformers"]

    normalized = [normalize_package_name(name) for name in raw_names]

    assert normalized == ["huggingface-hub", "torch-cuda", "sentence-transformers"]


def test_loads_strict_rejects_nan_and_infinity():
    invalid_payloads = ['{"vram": NaN}', '{"vram": Infinity}', '{"vram": -Infinity}']

    for payload in invalid_payloads:
        with pytest.raises(ValueError):
            loads_strict(payload)


def test_validate_manifest_accepts_hub_manifest():
    manifest = load_sample_manifest()

    errors = validate_manifest(manifest)

    assert errors == []


def test_validate_manifest_rejects_extra_top_level_key():
    manifest = load_sample_manifest()
    manifest["unexpected_field"] = "invalid"

    errors = validate_manifest(manifest)

    assert len(errors) > 0


def test_validate_manifest_rejects_pickle_destination():
    manifest = load_sample_manifest()
    manifest["install"][0]["destination"] = "weights/model.pt"

    errors = validate_manifest(manifest)

    assert any("pickle" in error.lower() for error in errors)


def test_validate_manifest_rejects_path_traversal():
    manifest = load_sample_manifest()
    manifest["install"][0]["destination"] = "../../outside.gguf"

    errors = validate_manifest(manifest)

    assert len(errors) > 0


def test_check_standards_flags_short_description():
    manifest = load_sample_manifest()
    short_description = "Too short"

    issues = check_standards(
        manifest=manifest,
        name="Community Chat",
        description=short_description,
        has_preview_image=True,
        official=set(),
    )

    assert any(issue["code"] == "short_description" for issue in issues)


def test_check_standards_flags_official_name_impersonation():
    manifest = deepcopy(load_sample_manifest())
    long_description = "A community model package with a detailed description for testing standards."

    issues = check_standards(
        manifest=manifest,
        name="Llama 3.2 1B Instruct",
        description=long_description,
        has_preview_image=True,
        official={"llama321binstruct"},
    )

    assert any(issue["code"] == "impersonation_name" for issue in issues)


def test_user_password_hashing_and_verification():
    user = User(username="unit_user", email="unit@lemonai.test")

    user.set_password("StrongPass123!")

    assert user.password_hash != "StrongPass123!"
    assert user.check_password("StrongPass123!") is True
    assert user.check_password("WrongPass123!") is False


def test_user_to_dict_never_exposes_password_hash():
    user = User(username="safe_user", email="safe@lemonai.test", role="user")
    user.set_password("StrongPass123!")

    serialized = user.to_dict()

    assert serialized["username"] == "safe_user"
    assert "password_hash" not in serialized
