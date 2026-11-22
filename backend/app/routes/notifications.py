"""The signed-in user's notifications (moderation decisions, moderators' replies, ...)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth_jwt import get_current_user
from app.database import get_db
from app.moderation import now_naive
from app.models import Notification, User

notifications_router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@notifications_router.get("")
def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.asc())
        .limit(limit)
        .all()
    )
    unread = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user.id, Notification.read_at.is_(None))
        .scalar()
        or 0
    )
    return {"notifications": [n.to_dict() for n in items], "unread": unread}


class MarkRead(BaseModel):
    ids: list[str] | None = None
    all: bool = False


@notifications_router.post("/read")
def mark_read(payload: MarkRead, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None))
    if not payload.all:
        query = query.filter(Notification.id.in_(payload.ids or []))
    changed = query.update({Notification.read_at: now_naive()}, synchronize_session=False)
    db.commit()
    return {"marked": changed}
