"""Administration: the review queue, reports, users and the moderation log.

Every endpoint needs an administrator (``require_admin``) and every change is written to the
moderation log with the administrator's name and reason.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth_jwt import require_admin
from app.config import Config
from app.database import get_db
from app.moderation import log_action, now_naive, resolve_open_reports, set_status
from app.models import (
    ADMIN_ROLE,
    REPORT_DISMISSED,
    REPORT_OPEN,
    REPORT_RESOLVED,
    SCRIPT_STATUSES,
    STATUS_PENDING,
    STATUS_PUBLISHED,
    STATUS_REJECTED,
    SYSTEM_ROLE,
    ModerationAction,
    Report,
    Script,
    User,
)
from app.routes.scripts import _delete_uploaded_image, _standards_for
from app.standards import official_names
from app.notify import notify
from app.models import ScriptMessage

THREAD_HINT = "\n\nOdpowiedzieć moderatorom możesz w aplikacji: Profil → Moje modele → Wiadomości."


def _moderator_note(db: Session, admin: User, script: Script, text: str) -> None:
    """The decision also goes into the entry's conversation, so the author can answer it."""
    db.add(ScriptMessage(script_id=script.id, author_id=admin.id, from_moderator=True, body=text))

admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_REASON = 1000


def _reason(value: str | None, *, required: bool) -> str | None:
    text = (value or "").strip()
    if required and not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "A reason is required"})
    if len(text) > MAX_REASON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"The reason is too long (max {MAX_REASON} characters)"},
        )
    return text or None


def _escape_like(term: str) -> str:
    return term.strip()[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _page(total: int, page: int, per_page: int) -> dict[str, int]:
    return {"total": total, "page": page, "per_page": per_page, "pages": (total + per_page - 1) // per_page if total else 0}


def _script_or_404(db: Session, id_or_slug: str) -> Script:
    script = db.query(Script).filter((Script.id == id_or_slug) | (Script.slug == id_or_slug)).first()
    if script is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Script not found"})
    return script


def _user_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found"})
    return user


@admin_router.get("/overview")
def overview(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    by_status = dict(db.query(Script.status, func.count(Script.id)).group_by(Script.status).all())
    recent = (
        db.query(ModerationAction)
        .options(joinedload(ModerationAction.actor))
        .order_by(ModerationAction.created_at.desc())
        .limit(8)
        .all()
    )
    return {
        "users": db.query(func.count(User.id)).filter(User.role != SYSTEM_ROLE).scalar() or 0,
        "banned_users": db.query(func.count(User.id)).filter(User.banned_at.isnot(None)).scalar() or 0,
        "scripts": {s: int(by_status.get(s, 0)) for s in SCRIPT_STATUSES},
        "open_reports": db.query(func.count(Report.id)).filter(Report.status == REPORT_OPEN).scalar() or 0,
        "recent_actions": [a.to_dict() for a in recent],
    }




@admin_router.get("/scripts")
def list_scripts(
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    reported: bool = False,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """All entries in every state, with open-report counts and the standards check."""
    open_reports = (
        db.query(Report.script_id, func.count(Report.id).label("n"))
        .filter(Report.status == REPORT_OPEN)
        .group_by(Report.script_id)
        .subquery()
    )
    query = db.query(Script, func.coalesce(open_reports.c.n, 0)).outerjoin(
        open_reports, open_reports.c.script_id == Script.id
    )
    if status_filter:
        if status_filter not in SCRIPT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": f"status must be one of {list(SCRIPT_STATUSES)}"},
            )
        query = query.filter(Script.status == status_filter)
    if reported:
        query = query.filter(open_reports.c.n > 0)
    if search:
        term = _escape_like(search)
        query = query.join(User, Script.author_id == User.id).filter(
            Script.name.ilike(f"%{term}%", escape="\\")
            | Script.slug.ilike(f"%{term}%", escape="\\")
            | User.username.ilike(f"%{term}%", escape="\\")
        )
    total = query.with_entities(func.count(Script.id)).scalar() or 0
    rows = (
        query.options(joinedload(Script.author))
        .order_by(
            (Script.status == STATUS_PENDING).desc(),
            func.coalesce(open_reports.c.n, 0).desc(),
            Script.created_at.desc().nullslast(),
            Script.id.asc(),
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    official = official_names(db)
    items = []
    for script, reports in rows:
        data = script.to_dict(moderation=True)
        data["open_reports"] = int(reports)
        data["standards"] = _standards_for(script, official)
        data["author_role"] = script.author.role if script.author else None
        data["author_banned"] = bool(script.author and script.author.is_banned)
        items.append(data)
    return {"scripts": items, **_page(total, page, per_page)}


class ModerateRequest(BaseModel):
    action: Literal["approve", "reject", "delete"]
    reason: str | None = None
    note: str | None = None


@admin_router.post("/scripts/{id_or_slug}/moderate")
def moderate_script(
    id_or_slug: str,
    payload: ModerateRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """approve: publish (open reports dismissed); reject: hide with a reason the author sees;
    delete: remove for good (the image too)."""
    script = _script_or_404(db, id_or_slug)
    note = (payload.note or "").strip()[:500]

    def logged(text: str | None) -> str | None:
        return f"{text} · uwaga: {note}" if note and text else (f"uwaga: {note}" if note else text)

    if payload.action == "approve":
        reason = _reason(payload.reason, required=False)
        was_hidden = script.status != STATUS_PUBLISHED
        set_status(script, STATUS_PUBLISHED, reason)
        if was_hidden:
            if reason:
                _moderator_note(db, admin, script, f"Zatwierdzono: {reason}")
            notify(
                db, script.author, "script_approved", f"Model {script.name} jest opublikowany",
                (reason or "Moderator zatwierdził Twój model; jest teraz widoczny w katalogu."), script,
            )
        dismissed = resolve_open_reports(db, script, admin, reason or "Approved by a moderator", dismissed=True)
        log_action(db, admin, "approve", "script", script.id, script.name, logged(reason))
        db.commit()
        db.refresh(script)
        return {"script": script.to_dict(moderation=True), "reports_closed": dismissed}

    reason = _reason(payload.reason, required=True)
    if script.author is not None and script.author.role == SYSTEM_ROLE and payload.action == "delete":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Official entries come from the bundled catalogue; reject them instead"},
        )
    if payload.action == "reject":
        set_status(script, STATUS_REJECTED, reason)
        script.is_curated = False
        _moderator_note(db, admin, script, f"Odrzucono: {reason}")
        notify(
            db, script.author, "script_rejected", f"Model {script.name} został odrzucony",
            f"Powód: {reason}\n\nPopraw wpis (Profil → Moje modele → Edytuj), a wróci do przeglądu." + THREAD_HINT,
            script,
        )
        closed = resolve_open_reports(db, script, admin, f"Rejected: {reason}")
        log_action(db, admin, "reject", "script", script.id, script.name, logged(reason))
        db.commit()
        db.refresh(script)
        return {"script": script.to_dict(moderation=True), "reports_closed": closed}

    image_url = script.preview_image_url
    log_action(db, admin, "delete", "script", script.id, f"{script.name} ({script.slug})", logged(reason))
    notify(
        db, script.author, "script_deleted", f"Model {script.name} został usunięty z Hubu",
        f"Powód: {reason}",
    )
    db.delete(script)
    db.commit()
    upload_folder = getattr(request.app.state, "upload_folder", Config.UPLOAD_FOLDER)
    _delete_uploaded_image(upload_folder, image_url)
    return {"deleted": True}




@admin_router.get("/reports")
def list_reports(
    status_filter: str = Query(REPORT_OPEN, alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if status_filter not in (REPORT_OPEN, REPORT_RESOLVED, REPORT_DISMISSED, "all"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Unknown report status"})
    query = db.query(Report)
    if status_filter != "all":
        query = query.filter(Report.status == status_filter)
    total = query.with_entities(func.count(Report.id)).scalar() or 0
    reports = (
        query.options(
            joinedload(Report.script).joinedload(Script.author),
            joinedload(Report.reporter),
            joinedload(Report.resolved_by),
        )
        .order_by(Report.created_at.desc(), Report.id.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {"reports": [r.to_dict() for r in reports], **_page(total, page, per_page)}


class ResolveReportRequest(BaseModel):
    action: Literal["resolve", "dismiss"]
    note: str | None = None


@admin_router.post("/reports/{report_id}/resolve")
def resolve_report(
    report_id: str,
    payload: ResolveReportRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Report not found"})
    if report.status != REPORT_OPEN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "This report is already closed"})
    note = _reason(payload.note, required=False)
    report.status = REPORT_RESOLVED if payload.action == "resolve" else REPORT_DISMISSED
    report.resolved_by_id = admin.id
    report.resolved_at = now_naive()
    report.resolution_note = note
    label = report.script.name if report.script else report.script_id
    log_action(db, admin, f"report_{payload.action}", "report", report.id, label, note)
    notify(
        db, report.reporter, "report_closed", f"Twoje zgłoszenie modelu {label} zostało rozpatrzone",
        note or ("Dziękujemy, problem został rozwiązany." if payload.action == "resolve" else "Moderator nie znalazł naruszenia."),
        report.script, email=False,
    )
    db.commit()
    db.refresh(report)
    return {"report": report.to_dict()}




@admin_router.get("/users")
def list_users(
    search: str | None = None,
    banned: bool | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    counts = (
        db.query(Script.author_id, func.count(Script.id).label("n")).group_by(Script.author_id).subquery()
    )
    query = db.query(User, func.coalesce(counts.c.n, 0)).outerjoin(counts, counts.c.author_id == User.id)
    query = query.filter(User.role != SYSTEM_ROLE)
    if search:
        term = _escape_like(search)
        query = query.filter(
            User.username.ilike(f"%{term}%", escape="\\") | User.email.ilike(f"%{term}%", escape="\\")
        )
    if banned is not None:
        query = query.filter(User.banned_at.isnot(None) if banned else User.banned_at.is_(None))
    total = query.with_entities(func.count(User.id)).scalar() or 0
    rows = (
        query.order_by(User.created_at.desc().nullslast(), User.id.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    users = []
    for user, scripts in rows:
        data = user.to_admin_dict()
        data["scripts_count"] = int(scripts)
        users.append(data)
    return {"users": users, **_page(total, page, per_page)}


def _guard_target(admin: User, target: User, what: str) -> None:
    if target.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": f"You cannot {what} your own account"})
    if target.role == SYSTEM_ROLE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "The official catalogue account cannot be changed"})


class BanRequest(BaseModel):
    reason: str
    reject_scripts: bool = False


@admin_router.post("/users/{user_id}/ban")
def ban_user(
    user_id: str,
    payload: BanRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Blocks sign-in, ends every session and optionally takes the user's entries off the Hub."""
    target = _user_or_404(db, user_id)
    _guard_target(admin, target, "block")
    if target.role == ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Remove the administrator role before blocking this account"},
        )
    reason = _reason(payload.reason, required=True)
    now = now_naive()
    target.banned_at = now
    target.ban_reason = reason
    target.tokens_valid_after = now
    rejected = 0
    if payload.reject_scripts:
        for script in db.query(Script).filter(Script.author_id == target.id, Script.status != STATUS_REJECTED).all():
            set_status(script, STATUS_REJECTED, f"The author's account was blocked: {reason}")
            script.is_curated = False
            resolve_open_reports(db, script, admin, "Author blocked")
            rejected += 1
    log_action(db, admin, "ban", "user", target.id, target.username, reason)
    notify(db, target, "account_banned", "Twoje konto w LemonAI Hub zostało zablokowane", f"Powód: {reason}")
    db.commit()
    db.refresh(target)
    return {"user": target.to_admin_dict(), "scripts_rejected": rejected}


@admin_router.post("/users/{user_id}/unban")
def unban_user(user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = _user_or_404(db, user_id)
    _guard_target(admin, target, "unblock")
    target.banned_at = None
    target.ban_reason = None
    log_action(db, admin, "unban", "user", target.id, target.username)
    notify(db, target, "account_unbanned", "Twoje konto w LemonAI Hub zostało odblokowane", "Możesz się znowu zalogować.")
    db.commit()
    db.refresh(target)
    return {"user": target.to_admin_dict()}


class RoleRequest(BaseModel):
    role: Literal["user", "admin"]


@admin_router.put("/users/{user_id}/role")
def set_role(
    user_id: str,
    payload: RoleRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = _user_or_404(db, user_id)
    _guard_target(admin, target, "change the role of")
    if payload.role == ADMIN_ROLE and target.is_banned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Unblock the account first"})
    if target.role != payload.role:
        target.role = payload.role
        log_action(db, admin, f"role_{payload.role}", "user", target.id, target.username)
        db.commit()
        db.refresh(target)
    return {"user": target.to_admin_dict()}




@admin_router.get("/actions")
def list_actions(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(ModerationAction)
    total = query.with_entities(func.count(ModerationAction.id)).scalar() or 0
    actions = (
        query.options(joinedload(ModerationAction.actor))
        .order_by(ModerationAction.created_at.desc(), ModerationAction.id.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {"actions": [a.to_dict() for a in actions], **_page(total, page, per_page)}


@admin_router.post("/users/{user_id}/reset-code")
def reset_code(user_id: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """A password reset code to pass to the user some other way (for Hubs without e-mail)."""
    from app.routes.auth import issue_reset_code

    target = _user_or_404(db, user_id)
    _guard_target(admin, target, "issue a reset code for")
    if target.role == ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Cannot issue a reset code for another administrator"},
        )
    if target.is_banned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Cannot issue a reset code for a blocked account"},
        )
    code = issue_reset_code(db, target)
    log_action(db, admin, "reset_code", "user", target.id, target.username)
    db.commit()
    return {"code": code, "username": target.username}


@admin_router.get("/messages")
def list_threads(
    waiting: bool = True,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Conversations with authors; ``waiting``: only those whose last message is the author's."""
    stats = (
        db.query(
            ScriptMessage.script_id.label("script_id"),
            func.max(ScriptMessage.created_at).label("max_at"),
            func.count(ScriptMessage.id).label("msg_count"),
        )
        .group_by(ScriptMessage.script_id)
        .subquery()
    )
    latest_ids = (
        db.query(
            ScriptMessage.script_id.label("script_id"),
            func.max(ScriptMessage.id).label("last_id"),
        )
        .join(
            stats,
            (stats.c.script_id == ScriptMessage.script_id) & (stats.c.max_at == ScriptMessage.created_at),
        )
        .group_by(ScriptMessage.script_id)
        .subquery()
    )
    query = (
        db.query(ScriptMessage, Script, stats.c.msg_count)
        .join(latest_ids, latest_ids.c.last_id == ScriptMessage.id)
        .join(Script, Script.id == ScriptMessage.script_id)
        .join(stats, stats.c.script_id == Script.id)
    )
    if waiting:
        query = query.filter(ScriptMessage.from_moderator.is_(False))

    total = query.with_entities(func.count(ScriptMessage.id)).scalar() or 0
    rows = (
        query.options(joinedload(ScriptMessage.author), joinedload(Script.author))
        .order_by(ScriptMessage.created_at.desc(), ScriptMessage.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    threads = [
        {
            "script": {
                "id": script.id,
                "slug": script.slug,
                "name": script.name,
                "status": script.status,
                "author": script.author.username if script.author else None,
            },
            "last_message": message.to_dict(),
            "messages": int(msg_count or 0),
        }
        for message, script, msg_count in rows
    ]
    return {"threads": threads, **_page(total, page, per_page)}
