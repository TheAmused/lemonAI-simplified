"""Seeds the curated catalogue from ``schemas/hub/*.json``."""

import json
import logging
import secrets
import uuid
from html import escape
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.database import db_session
from app.manifest_validation import loads_strict, schema_dir, validate_manifest
from app.models import SYSTEM_ROLE, Script, User

logger = logging.getLogger("lemonai.hub.seed")

OFFICIAL_USERNAME = "lemonai-official"
OFFICIAL_EMAIL = "official@lemonai.invalid"

_PALETTE = {
    "llm": ("#3b82f6", "#1d4ed8"),
    "image": ("#ec4899", "#7c3aed"),
    "audio": ("#06b6d4", "#0369a1"),
}
_DEFAULT_COLORS = ("#10b981", "#047857")


def _generate_svg_banner(title: str, subtitle: str, color_start: str, color_end: str) -> str:
    title, subtitle = escape(title), escape(subtitle)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{color_start}" />
      <stop offset="100%" stop-color="{color_end}" />
    </linearGradient>
  </defs>
  <rect width="800" height="400" rx="24" fill="url(#grad)" />
  <circle cx="700" cy="80" r="140" fill="#ffffff" fill-opacity="0.06" />
  <circle cx="650" cy="340" r="100" fill="#ffffff" fill-opacity="0.04" />
  <text x="56" y="170" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" fill="#ffffff">{title}</text>
  <text x="56" y="225" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="20" fill="#e2e8f0">{subtitle}</text>
  <rect x="56" y="280" width="160" height="38" rx="19" fill="#ffffff" fill-opacity="0.18" stroke="#ffffff" stroke-opacity="0.3" />
  <text x="136" y="304" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff">LemonAI Curated</text>
</svg>"""


def load_hub_manifests(configured_dir: str | None = None) -> list[dict[str, Any]]:
    hub_dir = schema_dir(configured_dir) / "hub"
    manifests = []
    for path in sorted(hub_dir.glob("*.json")):
        manifest = loads_strict(path.read_text(encoding="utf-8"))
        problems = validate_manifest(manifest, configured_dir)
        if problems:
            raise ValueError(f"{path.name} is not a valid manifest: {problems}")
        if manifest["id"] != path.stem:
            raise ValueError(f"{path.name}: manifest id '{manifest['id']}' must equal the file name")
        manifests.append(manifest)
    return manifests


def _official_user(session: Session) -> User:
    """The author of the curated catalogue."""
    user = session.query(User).filter_by(username=OFFICIAL_USERNAME).first()
    if user:
        return user
    user = User(username=OFFICIAL_USERNAME, email=OFFICIAL_EMAIL, role=SYSTEM_ROLE)
    user.set_password(secrets.token_urlsafe(48))
    session.add(user)
    session.commit()
    return user


def _move_aside(session: Session, script: Script) -> None:
    old = script.slug
    while True:
        new = f"{old[:90]}-{uuid.uuid4().hex[:6]}"
        if session.query(Script).filter_by(slug=new).first() is None:
            break
    script.slug = new
    manifest = dict(script.manifest_data or {})
    manifest["id"] = new
    script.manifest_data = manifest
    session.flush()
    logger.warning(
        "community model '%s' used the official id '%s'; it was renamed to '%s'", script.name, old, new
    )


def seed_database(
    app_or_session: Any = None,
    session: Session | None = None,
    upload_folder: str | None = None,
    schema_dir_cfg: str | None = None,
) -> None:
    folder = upload_folder
    schema_dir = schema_dir_cfg
    actual_session = session

    if app_or_session is not None:
        if hasattr(app_or_session, "state"):
            folder = getattr(app_or_session.state, "upload_folder", folder)
            schema_dir = getattr(app_or_session.state, "schema_dir", schema_dir)
        elif hasattr(app_or_session, "query"):
            actual_session = app_or_session

    if actual_session is None:
        with db_session() as sess:
            _seed_session(sess, folder, schema_dir)
    else:
        _seed_session(actual_session, folder, schema_dir)


def _seed_session(session: Session, upload_folder: str | None, schema_dir_cfg: str | None) -> None:
    from app.config import Config

    folder = upload_folder or Config.UPLOAD_FOLDER
    images_dir = Path(folder) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    manifests = load_hub_manifests(schema_dir_cfg or Config.SCHEMA_DIR)
    official = _official_user(session)

    active_slugs = {m["id"] for m in manifests}
    for old_script in session.query(Script).filter_by(author_id=official.id).all():
        if old_script.slug not in active_slugs:
            session.delete(old_script)

    for manifest in manifests:
        slug = manifest["id"]
        banner_name = f"{slug}.svg"
        banner_path = images_dir / banner_name
        if not banner_path.exists():
            colors = _PALETTE.get(manifest.get("category", ""), _DEFAULT_COLORS)
            banner_path.write_text(
                _generate_svg_banner(
                    manifest["name"], manifest["ui"].get("description", ""), colors[0], colors[1]
                ),
                encoding="utf-8",
            )

        hw = manifest["hardware_requirements"]
        script = session.query(Script).filter_by(slug=slug).first()
        if script is not None and script.author_id != official.id:
            _move_aside(session, script)
            script = None
        if script is None:
            script = Script(slug=slug, author_id=official.id)
            session.add(script)

        script.name = manifest["name"]
        script.description = manifest.get("description") or manifest["ui"].get("description", manifest["name"])
        script.is_curated = True
        script.category = manifest.get("category", "llm")
        script.is_adult = manifest.get("content_rating") == "adult"
        script.engine = manifest["engine"]
        script.preview_image_url = f"/api/uploads/images/{banner_name}"
        script.min_vram_gb = hw["min_vram_gb"]
        script.min_ram_gb = hw["min_ram_gb"]
        script.manifest_data = json.loads(json.dumps(manifest))

    from app.config import active_config
    if getattr(active_config, "DEMO_ACCOUNTS_ENABLED", False) or getattr(active_config, "DEV_MODE", False):
        creator = session.query(User).filter_by(username="demo_creator").first()
        if not creator:
            u = User(username="demo_creator", email="creator@lemonai.local", role="user")
            u.set_password("CreatorPass123!")
            session.add(u)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
