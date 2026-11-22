import math
import os
import re
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, StrictBool
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.auth_jwt import get_current_user, get_optional_user
from app.config import Config
from app.database import get_db
from app.manifest_validation import SLUG_PATTERN, loads_strict, validate_manifest
from app.moderation import log_action, maybe_hold_for_review, set_status
from app.models import (
    ADMIN_ROLE,
    REPORT_OPEN,
    REPORT_REASONS,
    STATUS_PENDING,
    STATUS_PUBLISHED,
    STATUS_REJECTED,
    SYSTEM_ROLE,
    Report,
    Script,
    User,
)
from app.standards import check_standards, has_errors, official_names
from app.notify import notify, notify_admins
from app.models import Rating, ScriptMessage

scripts_router = APIRouter(prefix="/api", tags=["scripts"])

ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
MAX_IMAGE_BYTES = 2 * 1024 * 1024
CATEGORY_RE = re.compile(r"^[a-z0-9_-]{1,50}$")
_SVG_FORBIDDEN_PROLOG = re.compile(rb"<!\s*(?:doctype|entity|element|attlist)|<!\[cdata\[", re.I)
_SVG_DANGEROUS_VAL = re.compile(r"(?:javascript|vbscript|data)\s*:", re.I)
_SVG_ALLOWED_NS = frozenset({"", "http://www.w3.org/2000/svg"})
_SVG_ALLOWED_TAGS = frozenset({
    "svg", "g", "defs", "title", "desc",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan",
    "lineargradient", "radialgradient", "stop",
    "clippath", "mask", "pattern", "symbol",
    "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "femerge", "femergenode",
})
_SVG_ALLOWED_ATTRS = frozenset({
    "id", "class", "xmlns", "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
    "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "preserveaspectratio",
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
    "opacity", "stop-color", "stop-opacity", "offset", "gradientunits", "gradienttransform",
    "spreadmethod", "clip-path", "clip-rule", "mask", "filter",
    "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline",
    "dx", "dy", "letter-spacing", "version",
    "stddeviation", "in", "in2", "result", "mode", "type", "values",
})


def _local_name(tag_or_attr: str) -> tuple[str, str]:
    if tag_or_attr.startswith("{"):
        ns, _, local = tag_or_attr[1:].partition("}")
        return ns, local.lower()
    return "", tag_or_attr.lower()


def _validate_svg(data: bytes) -> None:
    if _SVG_FORBIDDEN_PROLOG.search(data):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "SVG images must not contain DOCTYPE, ENTITY, or CDATA declarations"},
        )
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid SVG XML"},
        )
    root_ns, root_tag = _local_name(root.tag)
    if root_tag != "svg" or root_ns not in _SVG_ALLOWED_NS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "SVG root element must be <svg>"},
        )
    for elem in root.iter():
        ns, tag = _local_name(elem.tag)
        if ns not in _SVG_ALLOWED_NS or tag not in _SVG_ALLOWED_TAGS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": f"Disallowed SVG element '<{tag}>'"},
            )
        for attr_key, attr_val in elem.attrib.items():
            attr_ns, attr_local = _local_name(attr_key)
            if (
                attr_ns not in _SVG_ALLOWED_NS
                or attr_local.startswith("on")
                or attr_local not in _SVG_ALLOWED_ATTRS
                or _SVG_DANGEROUS_VAL.search(attr_val)
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"error": f"Disallowed SVG attribute '{attr_local}'"},
                )


def _validate_raster_magic(ext: str, data: bytes) -> None:
    if ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    if ext in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8\xff"):
        return
    if ext == ".webp" and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": f"File contents do not match image extension '{ext}'"},
    )


def slugify(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    cleaned = re.sub(r"[^a-z0-9_]+", "-", folded).strip("-_")
    return cleaned[:90].strip("-_")


def _finite(value: Any, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    val = float(value)
    if not math.isfinite(val) or not (lo <= val <= hi):
        raise ValueError(f"{name} must be a finite number between {lo:g} and {hi:g}")
    return val


def _secure_filename(filename: str) -> str:
    cleaned = os.path.basename(filename)
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", cleaned)
    return cleaned


def _delete_uploaded_image(
    upload_folder: str,
    image_url: str | None,
    *,
    exclude_path: str | None = None,
) -> None:
    if not image_url or not image_url.startswith("/api/uploads/images/"):
        return
    images_dir = os.path.abspath(os.path.join(upload_folder, "images"))
    img_name = image_url.split("/")[-1]
    target_path = os.path.abspath(os.path.join(images_dir, _secure_filename(img_name)))
    if os.path.commonpath([images_dir, target_path]) != images_dir:
        return
    if exclude_path is not None and target_path == os.path.abspath(exclude_path):
        return
    if os.path.isfile(target_path):
        try:
            os.remove(target_path)
        except OSError:
            pass


@scripts_router.get("/scripts")
def list_scripts(
    curated: bool | None = None,
    category: str | None = None,
    search: str | None = None,
    adult: bool = False,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Script).filter(Script.status == STATUS_PUBLISHED)
    if not adult:
        query = query.filter(Script.is_adult.is_(False))
    if curated is not None:
        query = query.filter(Script.is_curated == curated)
    if category:
        query = query.filter(Script.category == category)
    if search:
        search_term = search.strip()[:100]
        escaped = search_term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            Script.name.ilike(f"%{escaped}%", escape="\\")
            | Script.description.ilike(f"%{escaped}%", escape="\\")
        )

    total = query.with_entities(func.count(Script.id)).scalar() or 0
    pages = (total + per_page - 1) // per_page if total else 0
    offset = (page - 1) * per_page
    if total == 0 or offset >= total:
        scripts = []
    else:
        scripts = (
            query.options(joinedload(Script.author))
            .order_by(
                Script.installs_count.desc(),
                Script.created_at.desc().nullslast(),
                Script.id.asc(),
            )
            .offset(offset)
            .limit(per_page)
            .all()
        )
    return {
        "scripts": [s.to_dict() for s in scripts],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


@scripts_router.get("/scripts/mine")
def get_my_scripts(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Script).filter(Script.author_id == user.id)
    total = query.with_entities(func.count(Script.id)).scalar() or 0
    pages = (total + per_page - 1) // per_page if total else 0
    scripts = (
        query.options(joinedload(Script.author))
        .order_by(Script.created_at.desc(), Script.id.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    official = official_names(db)
    return {
        "scripts": [_with_standards(s, official) for s in scripts],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


def _can_moderate_view(script: Script, user: User | None) -> bool:
    return user is not None and (user.id == script.author_id or user.role == ADMIN_ROLE)


def _visible_script(
    db: Session,
    id_or_slug: str,
    user: User | None,
    *,
    for_update: bool = False,
) -> Script:
    """The entry, if this user may see it: published ones for everyone, others for author and admins."""
    query = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug))
    if for_update:
        query = query.with_for_update()
    script = query.first()
    if not script or (script.status != STATUS_PUBLISHED and not _can_moderate_view(script, user)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Script not found"},
        )
    return script


def _standards_for(script: Script, official: set[str]) -> list[dict[str, str]]:
    if script.author is not None and script.author.role == SYSTEM_ROLE:
        return []
    return check_standards(
        name=script.name,
        description=script.description,
        manifest=script.manifest_data or {},
        has_preview_image=bool(script.preview_image_url),
        official=official,
    )


def _with_standards(script: Script, official: set[str]) -> dict[str, Any]:
    data = script.to_dict(moderation=True)
    data["standards"] = _standards_for(script, official)
    return data


@scripts_router.get("/scripts/{id_or_slug}")
def get_script(
    id_or_slug: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    script = _visible_script(db, id_or_slug, user)
    return {"script": script.to_dict(moderation=_can_moderate_view(script, user))}


class ReportRequest(BaseModel):
    reason: str
    details: str | None = None


@scripts_router.post("/scripts/{id_or_slug}/report", status_code=status.HTTP_201_CREATED)
def report_script(
    id_or_slug: str,
    payload: ReportRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Flags an entry for the moderators. One open report per user and entry."""
    from app.routes.auth import _enforce_rate_limit

    script = _visible_script(db, id_or_slug, user, for_update=True)
    if script.author_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "You cannot report your own model"},
        )
    reason = payload.reason.strip().lower()
    if reason not in REPORT_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Reason must be one of {list(REPORT_REASONS)}"},
        )
    details = (payload.details or "").strip()
    if len(details) > 2000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Details are too long (max 2000 characters)"},
        )
    if reason == "other" and not details:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Describe the problem"},
        )
    existing = (
        db.query(Report)
        .filter(Report.script_id == script.id, Report.reporter_id == user.id, Report.status == REPORT_OPEN)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "You have already reported this model; a moderator will look at it", "code": "already_reported"},
        )
    _enforce_rate_limit(
        f"report:{user.id}", max_requests=10, window=900.0,
        detail_msg="Too many reports. Please try again later.",
    )
    report = Report(script_id=script.id, reporter_id=user.id, reason=reason, details=details or None)
    db.add(report)
    db.flush()
    threshold = int(getattr(getattr(request.app.state, "config", None), "REPORT_HOLD_THRESHOLD", 3) or 0)
    if maybe_hold_for_review(db, script, threshold):
        notify(
            db, script.author, "script_held", f"Model {script.name} został wstrzymany do przeglądu",
            "Kilka osób zgłosiło problem z tym modelem, więc do czasu decyzji moderatora nie jest widoczny w katalogu. "
            "Możesz napisać do moderatorów w aplikacji: Profil → Moje modele → Wiadomości.",
            script,
        )
        notify_admins(db, "script_held", f"Model wstrzymany po zgłoszeniach: {script.name}", None, script)
    else:
        notify_admins(db, "report", f"Nowe zgłoszenie: {script.name}", f"Powód: {reason}", script, email=False)
    db.commit()
    return {"message": "Report received", "report_id": report.id}


class StandardsRequest(BaseModel):
    name: str = ""
    description: str = ""
    manifest: dict[str, Any] = {}
    has_preview_image: StrictBool = False


@scripts_router.post("/scripts/standards")
def preview_standards(
    payload: StandardsRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """What the Hub standards say about an entry before it is published."""
    official = set() if user.role == SYSTEM_ROLE else official_names(db)
    issues = check_standards(
        name=payload.name,
        description=payload.description,
        manifest=payload.manifest,
        has_preview_image=payload.has_preview_image,
        official=official,
    )
    return {
        "standards": issues,
        "will_need_review": _require_approval(request) or has_errors(issues),
    }


def _require_approval(request: Request) -> bool:
    return bool(getattr(getattr(request.app.state, "config", None), "HUB_REQUIRE_APPROVAL", False))


@scripts_router.post("/scripts/{id_or_slug}/install", status_code=status.HTTP_204_NO_CONTENT)
def install_script(
    id_or_slug: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.routes.auth import _enforce_rate_limit

    script = _visible_script(db, id_or_slug, None)
    _enforce_rate_limit(
        f"install:{_user.id}:{script.id}",
        max_requests=1,
        window=300.0,
        detail_msg="Too many install requests for this model. Please try again later.",
    )

    db.query(Script).filter(Script.id == script.id).update(
        {Script.installs_count: func.coalesce(Script.installs_count, 0) + 1},
        synchronize_session=False,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _read_image(upload: UploadFile) -> tuple[str, bytes]:
    ext = os.path.splitext(upload.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Disallowed image extension '{ext}'. Allowed: {sorted(ALLOWED_IMAGE_EXTS)}"},
        )
    data = upload.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Preview image is too large (max 2 MB)"},
        )
    if ext == ".svg":
        _validate_svg(data)
    else:
        _validate_raster_magic(ext, data)
    return ext, data


@scripts_router.post("/scripts", status_code=status.HTTP_201_CREATED)
def create_script(
    request: Request,
    metadata: str = Form(...),
    preview_image: UploadFile | None = None,
    script_file: UploadFile | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if script_file and script_file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Uploading script files is not supported; publish a manifest instead"},
        )

    try:
        meta = loads_strict(metadata)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid JSON metadata"},
        )
    if not isinstance(meta, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Metadata must be a JSON object"},
        )

    name = str(meta.get("name", "")).strip()
    description = str(meta.get("description", "")).strip()
    if not name or not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Name and description are required"},
        )
    if "\r" in name or "\n" in name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Name must be a single line without line breaks"},
        )
    if len(name) > 120 or len(description) > 4000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Name (max 120) or description (max 4000 characters) is too long"},
        )

    category = str(meta.get("category") or "llm").strip().lower()
    if not CATEGORY_RE.match(category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Category must be 1-50 characters of a-z, 0-9, '_' or '-'"},
        )

    manifest = meta.get("manifest")
    if manifest is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "A manifest is required"},
        )

    schema_dir_cfg = getattr(request.app.state, "schema_dir", Config.SCHEMA_DIR)
    problems = validate_manifest(manifest, schema_dir_cfg)
    if problems:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid manifest", "details": problems},
        )

    try:
        min_vram = _finite(manifest["hardware_requirements"]["min_vram_gb"], "min_vram_gb", 0, 1024)
        min_ram = _finite(manifest["hardware_requirements"]["min_ram_gb"], "min_ram_gb", 1, 4096)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": str(exc)},
        )

    image_data: tuple[str, bytes] | None = None
    if preview_image and preview_image.filename:
        image_data = _read_image(preview_image)

    requested = meta.get("slug") or manifest.get("id") or name
    base_slug = slugify(str(requested)) or slugify(name) or f"model-{uuid.uuid4().hex[:8]}"
    slug = base_slug
    if db.query(Script).filter(Script.slug == slug).first():
        slug = f"{base_slug[:90]}-{uuid.uuid4().hex[:6]}"
    if not SLUG_PATTERN.match(slug):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Failed to generate a valid slug for this model"},
        )

    upload_folder = getattr(request.app.state, "upload_folder", Config.UPLOAD_FOLDER)
    images_dir = os.path.abspath(os.path.join(upload_folder, "images"))
    os.makedirs(images_dir, exist_ok=True)

    saved_path: str | None = None
    preview_image_url: str | None = None

    official = set() if user.role == SYSTEM_ROLE else official_names(db)
    standards = check_standards(
        name=name,
        description=description,
        manifest=manifest,
        has_preview_image=image_data is not None,
        official=official,
    )
    needs_review = user.role not in (ADMIN_ROLE, SYSTEM_ROLE) and (
        _require_approval(request) or has_errors(standards)
    )
    initial_status = STATUS_PENDING if needs_review else STATUS_PUBLISHED

    def build_script(final_slug: str) -> Script:
        final_manifest = dict(manifest)
        final_manifest["id"] = final_slug
        return Script(
            status=initial_status,
            slug=final_slug,
            name=name,
            description=description,
            author_id=user.id,
            is_curated=False,
            category=category,
            is_adult=final_manifest.get("content_rating") == "adult",
            engine=final_manifest["engine"],
            preview_image_url=preview_image_url,
            min_vram_gb=min_vram,
            min_ram_gb=min_ram,
            manifest_data=final_manifest,
        )

    for attempt in range(2):
        if image_data is not None:
            ext, payload = image_data
            fname = f"{slug}_{uuid.uuid4().hex[:8]}{ext}"
            target = os.path.abspath(os.path.join(images_dir, _secure_filename(fname)))
            if os.path.commonpath([images_dir, target]) != images_dir:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"error": "Invalid file path detected"},
                )
            with open(target, "wb") as handle:
                handle.write(payload)
            saved_path = target
            preview_image_url = f"/api/uploads/images/{os.path.basename(target)}"

        script = build_script(slug)
        try:
            db.add(script)
            if script.status == STATUS_PENDING:
                db.flush()
                notify_admins(
                    db, "review_needed", f"Nowy model czeka na przegląd: {script.name}",
                    f"Autor: {user.username}. Otwórz Administracja → Modele w aplikacji.", script,
                )
            db.commit()
            db.refresh(script)
            data = script.to_dict(moderation=True)
            data["standards"] = standards
            return {"script": data}
        except IntegrityError:
            db.rollback()
            if saved_path and os.path.exists(saved_path):
                os.remove(saved_path)
            saved_path = None
            slug = f"{base_slug[:90]}-{uuid.uuid4().hex[:6]}"
        except Exception:
            db.rollback()
            if saved_path and os.path.exists(saved_path):
                os.remove(saved_path)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Failed to save script"},
            )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "Could not allocate a unique identifier, please retry"},
    )


@scripts_router.put("/scripts/{id_or_slug}")
def update_script(
    id_or_slug: str,
    request: Request,
    metadata: str = Form(...),
    preview_image: UploadFile | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    script = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug)).first()
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Script not found"},
        )
    if script.author_id != user.id and user.role != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "You do not have permission to edit this script"},
        )

    try:
        meta = loads_strict(metadata)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid JSON metadata"},
        )
    if not isinstance(meta, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Metadata must be a JSON object"},
        )

    if "name" in meta:
        name = str(meta["name"]).strip()
        if not name or len(name) > 120:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Name (max 120 chars) is required"},
            )
        if "\r" in name or "\n" in name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Name must be a single line without line breaks"},
            )
        script.name = name

    if "description" in meta:
        desc = str(meta["description"]).strip()
        if not desc or len(desc) > 4000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Description (max 4000 chars) is required"},
            )
        script.description = desc

    if "category" in meta:
        cat = str(meta["category"]).strip().lower()
        if not CATEGORY_RE.match(cat):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Category must be 1-50 characters of a-z, 0-9, '_' or '-'"},
            )
        script.category = cat

    manifest = meta.get("manifest")
    if manifest is not None:
        schema_dir_cfg = getattr(request.app.state, "schema_dir", Config.SCHEMA_DIR)
        problems = validate_manifest(manifest, schema_dir_cfg)
        if problems:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Invalid manifest", "details": problems},
            )
        if "hardware_requirements" in manifest:
            try:
                min_vram = _finite(manifest["hardware_requirements"]["min_vram_gb"], "min_vram_gb", 0, 1024)
                min_ram = _finite(manifest["hardware_requirements"]["min_ram_gb"], "min_ram_gb", 1, 4096)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"error": str(exc)},
                )
            script.min_vram_gb = min_vram
            script.min_ram_gb = min_ram
        script.manifest_data = dict(manifest)
        script.manifest_data["id"] = script.slug
        script.engine = manifest["engine"]
        script.is_adult = manifest.get("content_rating") == "adult"

    old_url = script.preview_image_url
    upload_folder: str | None = None
    new_image_path: str | None = None

    if preview_image and preview_image.filename:
        image_data = _read_image(preview_image)
        upload_folder = getattr(request.app.state, "upload_folder", Config.UPLOAD_FOLDER)
        images_dir = os.path.abspath(os.path.join(upload_folder, "images"))
        os.makedirs(images_dir, exist_ok=True)
        ext, payload = image_data
        fname = f"{script.slug}_{uuid.uuid4().hex[:8]}{ext}"
        target = os.path.abspath(os.path.join(images_dir, _secure_filename(fname)))
        if os.path.commonpath([images_dir, target]) != images_dir:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Invalid file path detected"},
            )
        try:
            with open(target, "wb") as handle:
                handle.write(payload)
        except Exception:
            if os.path.exists(target):
                try:
                    os.remove(target)
                except OSError:
                    pass
            raise
        new_image_path = target
        script.preview_image_url = f"/api/uploads/images/{os.path.basename(target)}"

    if script.is_curated and user.role != ADMIN_ROLE:
        script.is_curated = False

    standards = _standards_for(script, set() if user.role == SYSTEM_ROLE else official_names(db))
    if user.role != ADMIN_ROLE and script.author is not None and script.author.role != SYSTEM_ROLE:
        was = script.status
        if script.status == STATUS_REJECTED:
            set_status(script, STATUS_PENDING, "Changed by the author after rejection; waiting for review.")
        elif script.status == STATUS_PUBLISHED and (
            has_errors(standards) or (manifest is not None and _require_approval(request))
        ):
            set_status(script, STATUS_PENDING, "Changed by the author; waiting for review.")
        if was != script.status:
            notify_admins(
                db, "review_needed", f"Model do ponownego przeglądu: {script.name}",
                f"Autor {user.username} zmienił wpis.", script,
            )

    try:
        db.commit()
    except Exception:
        db.rollback()
        if new_image_path and os.path.exists(new_image_path):
            try:
                os.remove(new_image_path)
            except OSError:
                pass
        raise

    db.refresh(script)

    if new_image_path is not None and upload_folder is not None and old_url != script.preview_image_url:
        _delete_uploaded_image(upload_folder, old_url, exclude_path=new_image_path)

    data = script.to_dict(moderation=True)
    data["standards"] = standards
    return {"script": data}


@scripts_router.delete("/scripts/{id_or_slug}")
def delete_script(
    id_or_slug: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    script = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug)).first()
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Script not found"},
        )
    if script.author_id != user.id and user.role != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "You do not have permission to delete this script"},
        )
    if script.author is not None and script.author.role == SYSTEM_ROLE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Official entries come from the bundled catalogue; reject them instead"},
        )

    image_url = script.preview_image_url
    try:
        if script.author_id != user.id:
            log_action(db, user, "delete", "script", script.id, script.name, "Deleted via the API")
        db.delete(script)
        db.commit()
    except Exception:
        db.rollback()
        raise

    upload_folder = getattr(request.app.state, "upload_folder", Config.UPLOAD_FOLDER)
    _delete_uploaded_image(upload_folder, image_url)
    return {"message": "Script deleted successfully"}


class CurationRequest(BaseModel):
    curated: StrictBool


@scripts_router.put("/scripts/{id_or_slug}/curation")
def set_curation(
    id_or_slug: str,
    payload: CurationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "Administrator privileges required"},
        )
    script = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug)).first()
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Script not found"},
        )
    script.is_curated = payload.curated
    if payload.curated and script.status != STATUS_PUBLISHED:
        set_status(script, STATUS_PUBLISHED, None)
    log_action(db, user, "curate" if payload.curated else "uncurate", "script", script.id, script.name)
    db.commit()
    db.refresh(script)
    return {"script": script.to_dict(moderation=True)}


@scripts_router.get("/uploads/{subfolder}/{filename}")
def serve_upload(
    subfolder: str,
    filename: str,
    request: Request,
):
    if subfolder != "images":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Invalid upload directory"},
        )

    upload_folder = getattr(request.app.state, "upload_folder", Config.UPLOAD_FOLDER)
    folder = os.path.abspath(os.path.join(upload_folder, subfolder))
    file_path = os.path.abspath(os.path.join(folder, _secure_filename(filename)))

    if os.path.commonpath([folder, file_path]) != folder or not os.path.isfile(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "File not found"},
        )

    headers = {
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }
    return FileResponse(file_path, headers=headers)



MAX_MESSAGE = 4000


def _thread_script(db: Session, id_or_slug: str, user: User) -> Script:
    script = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug)).first()
    if script is None or not _can_moderate_view(script, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Script not found"})
    return script


@scripts_router.get("/scripts/{id_or_slug}/messages")
def list_messages(
    id_or_slug: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    script = _thread_script(db, id_or_slug, user)
    query = db.query(ScriptMessage).filter(ScriptMessage.script_id == script.id)
    total = query.with_entities(func.count(ScriptMessage.id)).scalar() or 0
    pages = (total + per_page - 1) // per_page if total else 0
    messages = (
        query.options(joinedload(ScriptMessage.author))
        .order_by(ScriptMessage.created_at.asc(), ScriptMessage.id.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "messages": [m.to_dict() for m in messages],
        "status": script.status,
        "moderation_note": script.moderation_note,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


class MessageRequest(BaseModel):
    body: str
    request_review: StrictBool = False


@scripts_router.post("/scripts/{id_or_slug}/messages", status_code=status.HTTP_201_CREATED)
def post_message(
    id_or_slug: str,
    payload: MessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The author writes to the moderators (optionally asking for another review of a rejected
    entry), or an administrator answers the author."""
    from app.routes.auth import _enforce_rate_limit

    script = _thread_script(db, id_or_slug, user)
    body = payload.body.strip()
    if not body or len(body) > MAX_MESSAGE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Write a message of 1-{MAX_MESSAGE} characters"},
        )
    _enforce_rate_limit(f"msg:{user.id}", max_requests=20, window=900.0, detail_msg="Too many messages. Please try again later.")
    from_moderator = user.role == ADMIN_ROLE and user.id != script.author_id
    message = ScriptMessage(script_id=script.id, author_id=user.id, from_moderator=from_moderator, body=body)
    db.add(message)
    if from_moderator:
        notify(
            db, script.author, "moderator_message", f"Moderator odpowiedział w sprawie modelu {script.name}",
            f"{body}\n\nOdpowiedz w aplikacji: Profil → Moje modele → Wiadomości.", script,
        )
    else:
        reopened = payload.request_review and script.status == STATUS_REJECTED
        if reopened:
            set_status(script, STATUS_PENDING, "The author asked for another review.")
            log_action(db, user, "appeal", "script", script.id, script.name, body[:500])
        notify_admins(
            db,
            "appeal" if reopened else "author_message",
            f"{'Odwołanie' if reopened else 'Wiadomość'} od autora modelu {script.name}",
            f"{user.username}: {body}",
            script,
        )
    db.commit()
    db.refresh(message)
    return {"message": message.to_dict(), "status": script.status}




class RatingRequest(BaseModel):
    stars: int


def _recount(db: Session, script: Script) -> None:
    total, count = (
        db.query(func.coalesce(func.sum(Rating.stars), 0), func.count(Rating.id))
        .filter(Rating.script_id == script.id)
        .one()
    )
    script.rating_sum = int(total or 0)
    script.rating_count = int(count or 0)


@scripts_router.put("/scripts/{id_or_slug}/rating")
def rate_script(
    id_or_slug: str,
    payload: RatingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sets (or changes) the signed-in user's 1–5 star rating of a published entry."""
    script = _visible_script(db, id_or_slug, None, for_update=True)
    if script.author_id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "You cannot rate your own model"})
    if isinstance(payload.stars, bool) or not 1 <= payload.stars <= 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Stars must be 1-5"})
    rating = db.query(Rating).filter(Rating.script_id == script.id, Rating.user_id == user.id).first()
    if rating is None:
        db.add(Rating(script_id=script.id, user_id=user.id, stars=payload.stars))
    else:
        rating.stars = payload.stars
    try:
        db.flush()
        _recount(db, script)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "Please try again"})
    db.refresh(script)
    return {"rating": script.to_dict()["rating"], "rating_count": script.rating_count, "mine": payload.stars}


@scripts_router.delete("/scripts/{id_or_slug}/rating")
def unrate_script(id_or_slug: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    script = _visible_script(db, id_or_slug, user, for_update=True)
    db.query(Rating).filter(Rating.script_id == script.id, Rating.user_id == user.id).delete()
    db.flush()
    _recount(db, script)
    db.commit()
    db.refresh(script)
    return {"rating": script.to_dict()["rating"], "rating_count": script.rating_count, "mine": None}


@scripts_router.get("/ratings/mine")
def my_ratings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Script.slug, Rating.stars)
        .join(Rating, Rating.script_id == Script.id)
        .filter(Rating.user_id == user.id)
        .all()
    )
    return {"ratings": {slug: stars for slug, stars in rows}}
