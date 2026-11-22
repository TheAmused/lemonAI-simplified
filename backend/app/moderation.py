"""Shared moderation helpers: the audit log, status changes and the automatic report hold."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    REPORT_OPEN,
    STATUS_PENDING,
    STATUS_PUBLISHED,
    ModerationAction,
    Report,
    Script,
    User,
)


def now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def log_action(
    db: Session,
    actor: User | None,
    action: str,
    target_type: str,
    target_id: str,
    target_label: str,
    reason: str | None = None,
) -> None:
    db.add(
        ModerationAction(
            actor_id=actor.id if actor else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label[:200],
            reason=reason,
            created_at=now_naive(),
        )
    )


def set_status(script: Script, status: str, note: str | None) -> None:
    script.status = status
    script.moderation_note = note
    script.moderated_at = now_naive()


def resolve_open_reports(db: Session, script: Script, actor: User | None, note: str, *, dismissed: bool = False) -> int:
    from app.models import REPORT_DISMISSED, REPORT_RESOLVED

    count = 0
    for report in db.query(Report).filter(Report.script_id == script.id, Report.status == REPORT_OPEN).all():
        report.status = REPORT_DISMISSED if dismissed else REPORT_RESOLVED
        report.resolved_by_id = actor.id if actor else None
        report.resolved_at = now_naive()
        report.resolution_note = note
        count += 1
    return count


def maybe_hold_for_review(db: Session, script: Script, threshold: int) -> bool:
    """Takes a published community entry off the list once ``threshold`` users reported it."""
    if threshold <= 0:
        return False
    locked = db.query(Script).filter(Script.id == script.id).with_for_update().first()
    if locked is None or locked.status != STATUS_PUBLISHED or locked.is_curated:
        return False
    reporters = (
        db.query(func.count(func.distinct(Report.reporter_id)))
        .filter(Report.script_id == locked.id, Report.status == REPORT_OPEN, Report.reporter_id.isnot(None))
        .scalar()
        or 0
    )
    if reporters < threshold:
        return False
    set_status(locked, STATUS_PENDING, f"Held for review after {reporters} user reports.")
    log_action(db, None, "auto_hold", "script", locked.id, locked.name, f"{reporters} open reports")
    return True
