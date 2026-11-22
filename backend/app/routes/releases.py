"""Desktop app releases: the update endpoint the app's updater asks, and their administration.

The Hub only *announces* releases; the installer is downloaded from ``url`` and the app checks
its ``signature`` against the release key compiled into it, so a release cannot be forged from
the Hub alone.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_jwt import require_admin
from app.database import get_db
from app.moderation import log_action
from app.models import AppRelease, User

releases_router = APIRouter(prefix="/api", tags=["releases"])

TARGETS = ("windows-x86_64", "windows-aarch64", "linux-x86_64", "darwin-x86_64", "darwin-aarch64")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
URL = re.compile(r"^(https://[^\s]+|http://(127\.0\.0\.1|localhost)(:\d+)?/[^\s]*)$")
SIGNATURE = re.compile(r"^[A-Za-z0-9+/=\s]{40,4000}$")


def version_key(version: str) -> tuple:
    """Sort key: numbers, then a release above its pre-releases (1.2.0 > 1.2.0-beta.1)."""
    match = SEMVER.match(version.strip().lstrip("v"))
    if not match:
        return (-1,)
    major, minor, patch, pre = match.groups()
    pre_key = (1,) if pre is None else (0, *[(0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split(".")])
    return (int(major), int(minor), int(patch), pre_key)


@releases_router.get("/app/updates/{target}/{arch}/{current_version}")
def check_update(target: str, arch: str, current_version: str, db: Session = Depends(get_db)):
    """Tauri updater endpoint: 204 when the app is up to date, else the newest release."""
    key = f"{target}-{arch}"
    if key not in TARGETS:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    releases = db.query(AppRelease).filter(AppRelease.target == key).all()
    if not releases:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    newest = max(releases, key=lambda r: version_key(r.version))
    if version_key(newest.version) <= version_key(current_version):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    created = newest.created_at
    return {
        "version": newest.version,
        "notes": newest.notes or "",
        "pub_date": created.strftime("%Y-%m-%dT%H:%M:%SZ") if created else None,
        "url": newest.url,
        "signature": newest.signature.strip(),
    }


class ReleaseRequest(BaseModel):
    version: str
    target: str = "windows-x86_64"
    url: str
    signature: str
    notes: str | None = None


@releases_router.get("/admin/releases")
def list_releases(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    releases = db.query(AppRelease).all()
    releases.sort(key=lambda r: (r.target, version_key(r.version)), reverse=True)
    return {"releases": [r.to_dict() for r in releases], "targets": list(TARGETS)}


@releases_router.post("/admin/releases", status_code=status.HTTP_201_CREATED)
def publish_release(payload: ReleaseRequest, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    version = payload.version.strip().lstrip("v")
    problems = []
    if not SEMVER.match(version):
        problems.append("version must look like 1.2.3")
    if payload.target not in TARGETS:
        problems.append(f"target must be one of {list(TARGETS)}")
    if not URL.match(payload.url.strip()) or len(payload.url) > 500:
        problems.append("url must be an https:// address of the installer")
    if not SIGNATURE.match(payload.signature.strip()):
        problems.append("signature must be the contents of the installer's .sig file")
    if payload.notes and len(payload.notes) > 10_000:
        problems.append("notes are too long")
    if problems:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "; ".join(problems)})
    release = AppRelease(
        version=version,
        target=payload.target,
        url=payload.url.strip(),
        signature=payload.signature.strip(),
        notes=(payload.notes or "").strip() or None,
        created_by_id=admin.id,
    )
    db.add(release)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": f"Version {version} for {payload.target} is already published"},
        )
    log_action(db, admin, "release_publish", "release", release.id, f"{version} ({payload.target})")
    db.commit()
    db.refresh(release)
    return {"release": release.to_dict()}


@releases_router.delete("/admin/releases/{release_id}")
def withdraw_release(release_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    release = db.get(AppRelease, release_id)
    if release is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Release not found"})
    log_action(db, admin, "release_withdraw", "release", release.id, f"{release.version} ({release.target})")
    db.delete(release)
    db.commit()
    return {"deleted": True}
