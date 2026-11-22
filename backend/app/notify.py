"""Notifications: an entry in the user's in-app list and (if they want it) an e-mail."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import mailer
from app.models import ADMIN_ROLE, SYSTEM_ROLE, Notification, Script, User

FOOTER = (
    "\n\n--\nLemonAI Hub. Powiadomienia e-mail możesz wyłączyć w aplikacji: Profil → Ustawienia konta."
)


def can_email(user: User) -> bool:
    return bool(
        user.email
        and not user.email.endswith(".invalid")
        and user.role != SYSTEM_ROLE
        and user.notify_email is not False
    )


def notify(
    db: Session,
    user: User | None,
    kind: str,
    title: str,
    body: str | None = None,
    script: Script | None = None,
    *,
    email: bool = True,
) -> None:
    if user is None or user.role == SYSTEM_ROLE:
        return
    db.add(
        Notification(
            user_id=user.id,
            kind=kind,
            title=title[:200],
            body=body,
            script_id=script.id if script else None,
            script_slug=script.slug if script else None,
        )
    )
    if email and can_email(user):
        mailer.queue(db, user.email, f"LemonAI Hub: {title}", f"{title}\n\n{body or ''}".rstrip() + FOOTER)


def notify_admins(
    db: Session,
    kind: str,
    title: str,
    body: str | None = None,
    script: Script | None = None,
    *,
    exclude: User | None = None,
    email: bool = True,
) -> None:
    for admin in db.query(User).filter(User.role == ADMIN_ROLE, User.banned_at.is_(None)).all():
        if exclude is not None and admin.id == exclude.id:
            continue
        notify(db, admin, kind, title, body, script, email=email)
