"""Core backend tests: configuration, auth/JWT, catalogue, manifest publishing, uploads, and curation."""

import io
import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.config import Config, ConfigError
from tests.conftest import ADMIN_PASSWORD, create_test_client

REPO_ROOT = Path(__file__).resolve().parents[2]
HUB_DIR = REPO_ROOT / "schemas" / "hub"


def hub_manifest(name: str = "llama-3-2-1b") -> dict:
    return json.loads((HUB_DIR / f"{name}.json").read_text(encoding="utf-8"))


def community_manifest(**overrides) -> dict:
    manifest = hub_manifest()
    manifest["id"] = "will-be-replaced"
    manifest["name"] = "Community Model"
    manifest.update(overrides)
    return manifest


def register(client, name: str = "coder_bob", password: str = "Password123!"):
    res = client.post(
        "/api/auth/register",
        json={"username": name, "email": f"{name}@lemonai.test", "password": password},
    )
    assert res.status_code == 201, res.get_json()
    data = res.get_json()
    return data, {"Authorization": f"Bearer {data['access_token']}"}


def admin_headers(client):
    res = client.post("/api/auth/login", json={"login": "test_admin", "password": ADMIN_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.get_json()['access_token']}"}


def publish(client, headers, manifest=None, image=None, **meta):
    metadata = {
        "name": "Custom Model",
        "description": "A community created package.",
        "category": "llm",
        "manifest": manifest if manifest is not None else community_manifest(),
        **meta,
    }
    data = {"metadata": json.dumps(metadata)}
    if image is not None:
        data["preview_image"] = image
    return client.post("/api/scripts", data=data, headers=headers, content_type="multipart/form-data")




@pytest.mark.parametrize("secret", [None, "", "short", "lemonai_jwt_secret_dev_2026"])
def test_app_refuses_to_start_with_missing_or_weak_jwt_secret(make_app, secret):
    with pytest.raises(ConfigError):
        make_app(JWT_SECRET_KEY=secret)


@pytest.mark.parametrize("secret", [None, "x" * 10, "lemonai_flask_secret_key_2026"])
def test_app_refuses_to_start_with_missing_or_weak_flask_secret(make_app, secret):
    with pytest.raises(ConfigError):
        make_app(SECRET_KEY=secret)


def test_cors_allows_only_configured_origins(client):
    assert "*" not in Config.CORS_ORIGINS
    allowed = client.get("/api/scripts", headers={"Origin": "http://localhost:1420"})
    assert allowed.headers.get("Access-Control-Allow-Origin") == "http://localhost:1420"
    denied = client.get("/api/scripts", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in denied.headers


def test_docs_disabled_when_not_dev_mode(make_app):
    prod_app = make_app(DEV_MODE=False)
    with create_test_client(prod_app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404




def test_registration_and_duplicate_rejection(client):
    data, _ = register(client)
    assert data["user"]["username"] == "coder_bob"
    assert "refresh_token" in data

    dup = client.post(
        "/api/auth/register",
        json={"username": "coder_bob", "email": "different@lemonai.test", "password": "Password123!"},
    )
    assert dup.status_code == 409


def test_login_valid_and_invalid(client):
    register(client, "alice", "SecretPassword123")
    ok = client.post("/api/auth/login", json={"login": "alice", "password": "SecretPassword123"})
    assert ok.status_code == 200 and "access_token" in ok.get_json()
    wrong = client.post("/api/auth/login", json={"login": "alice", "password": "WrongPassword"})
    assert wrong.status_code == 401


def test_token_refresh_me_and_logout(client):
    reg, headers = register(client, "david", "SecretPassword123")
    assert client.get("/api/auth/me", headers=headers).get_json()["user"]["username"] == "david"

    refresh_hdr = {"Authorization": f"Bearer {reg['refresh_token']}"}
    refreshed = client.post("/api/auth/refresh", headers=refresh_hdr)
    assert refreshed.status_code == 200
    rotated = refreshed.get_json()["refresh_token"]
    assert rotated and rotated != reg["refresh_token"]

    assert client.post("/api/auth/refresh", headers=refresh_hdr).status_code == 401
    new_refresh_hdr = {"Authorization": f"Bearer {rotated}"}
    assert client.post("/api/auth/logout", headers=new_refresh_hdr).status_code == 200
    assert client.post("/api/auth/refresh", headers=new_refresh_hdr).status_code == 401




def test_seeded_catalogue_and_listing(client):
    scripts = client.get("/api/scripts?adult=true&per_page=100").get_json()["scripts"]
    assert {s["slug"] for s in scripts} == {p.stem for p in HUB_DIR.glob("*.json")}
    assert all(s["is_curated"] is True for s in scripts)

    target = scripts[0]
    detail = client.get(f"/api/scripts/{target['slug']}").get_json()["script"]
    assert detail["slug"] == target["slug"]
    assert client.get("/api/scripts/does-not-exist").status_code == 404


def test_publish_valid_manifest_and_image(client):
    assert client.post("/api/scripts", data={"metadata": "{}"}).status_code == 401

    _, headers = register(client, "creator_user")
    res = publish(
        client,
        headers,
        image=(io.BytesIO(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), "banner.svg"),
    )
    assert res.status_code == 201, res.get_json()
    script = res.get_json()["script"]
    assert script["is_curated"] is False
    assert script["manifest"]["id"] == script["slug"]

    image = client.get(script["preview_image_url"])
    assert image.status_code == 200
    assert "sandbox" in image.headers["Content-Security-Policy"]


def test_invalid_manifests_and_images_are_rejected(client):
    _, headers = register(client, "bad_user")

    bad_manifest = community_manifest()
    bad_manifest["runtime"]["arguments"].append("--port=9")
    assert publish(client, headers, manifest=bad_manifest).status_code == 400

    traversal = community_manifest()
    traversal["install"][0]["destination"] = "../../outside.gguf"
    assert publish(client, headers, manifest=traversal).status_code == 400

    dup_inputs = community_manifest()
    dup_inputs["ui"]["inputs"].append(deepcopy(dup_inputs["ui"]["inputs"][0]))
    assert publish(client, headers, manifest=dup_inputs).status_code == 400

    bad_ext = publish(client, headers, image=(io.BytesIO(b"#!/bin/sh"), "exploit.sh"))
    assert bad_ext.status_code == 400
    bad_svg = publish(client, headers, image=(io.BytesIO(b"<svg><script>alert(1)</script></svg>"), "x.svg"))
    assert bad_svg.status_code == 400


def test_only_admins_can_curate(client):
    _, user_headers = register(client, "regular_joe")
    script = publish(client, user_headers).get_json()["script"]

    assert client.put(f"/api/scripts/{script['slug']}/curation", json={"curated": True}, headers=user_headers).status_code == 403
    ok = client.put(f"/api/scripts/{script['slug']}/curation", json={"curated": True}, headers=admin_headers(client))
    assert ok.status_code == 200 and ok.get_json()["script"]["is_curated"] is True
