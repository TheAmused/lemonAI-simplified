import math
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import relationship, Session

from app.database import Base, db

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("lemonai-timing-equaliser")
MAX_PASSWORD_LENGTH = 128

_REVOKED_PRUNE_INTERVAL = 60.0
_revoked_prune_lock = threading.Lock()
_last_revoked_prune = 0.0


def reset_revoked_prune_timer() -> None:
    global _last_revoked_prune
    with _revoked_prune_lock:
        _last_revoked_prune = 0.0

SYSTEM_ROLE = "system"
ADMIN_ROLE = "admin"
USER_ROLE = "user"

STATUS_PUBLISHED = "published"
STATUS_PENDING = "pending"
STATUS_REJECTED = "rejected"
SCRIPT_STATUSES = (STATUS_PUBLISHED, STATUS_PENDING, STATUS_REJECTED)

REPORT_REASONS = ("malicious", "broken", "misleading", "license", "spam", "other")
REPORT_OPEN = "open"
REPORT_RESOLVED = "resolved"
REPORT_DISMISSED = "dismissed"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def burn_password_check(password: str) -> None:
    if not isinstance(password, str) or len(password) > MAX_PASSWORD_LENGTH:
        return
    try:
        _hasher.verify(_DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        pass


class User(Base):
    __tablename__ = "users"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: str = Column(String(50), unique=True, nullable=False, index=True)
    email: str = Column(String(120), unique=True, nullable=False, index=True)
    password_hash: str = Column(String(255), nullable=False)
    role: str = Column(String(20), default=USER_ROLE, nullable=False)
    avatar_url: str | None = Column(String(255), nullable=True)
    two_factor_enabled: bool = Column(Boolean, default=False, nullable=False)
    totp_secret: str | None = Column(String(64), nullable=True)
    pending_totp_secret: str | None = Column(String(64), nullable=True)
    totp_last_step: int | None = Column(Integer, nullable=True)
    backup_codes: list[str] | None = Column(JSON, nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    tokens_valid_after: datetime | None = Column(DateTime, nullable=True)
    banned_at: datetime | None = Column(DateTime, nullable=True)
    ban_reason: str | None = Column(Text, nullable=True)
    notify_email: bool = Column(Boolean, nullable=False, default=True)

    scripts = relationship("Script", back_populates="author", cascade="all, delete-orphan")

    @property
    def is_banned(self) -> bool:
        return self.banned_at is not None

    def set_password(self, password: str) -> None:
        self.password_hash = hash_password(password)

    def check_password(self, password: str) -> bool:
        if not isinstance(password, str) or len(password) > MAX_PASSWORD_LENGTH:
            return False
        try:
            return _hasher.verify(self.password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "avatar_url": self.avatar_url,
            "two_factor_enabled": bool(self.two_factor_enabled),
            "notify_email": self.notify_email is not False,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def to_admin_dict(self) -> dict[str, Any]:
        data = self.to_dict()
        data["banned_at"] = _iso(self.banned_at)
        data["ban_reason"] = self.ban_reason
        return data


class Script(Base):
    __tablename__ = "scripts"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    slug: str = Column(String(100), unique=True, nullable=False, index=True)
    name: str = Column(String(120), nullable=False)
    description: str = Column(Text, nullable=False)
    author_id: str = Column(String(36), ForeignKey("users.id"), nullable=False)
    is_curated: bool = Column(Boolean, default=False, nullable=False, index=True)
    category: str = Column(String(50), default="llm", nullable=False, index=True)
    is_adult: bool = Column(Boolean, default=False, nullable=False, index=True)
    engine: str = Column(String(50), default="python_uv", nullable=False)
    preview_image_url: str | None = Column(String(255), nullable=True)
    script_file_url: str | None = Column(String(255), nullable=True)
    min_vram_gb: float = Column(Float, default=2.0)
    min_ram_gb: float = Column(Float, default=4.0)
    manifest_data: dict[str, Any] = Column(JSON, nullable=False)
    downloads_count: int = Column(Integer, default=0)
    installs_count: int = Column(Integer, nullable=False, default=0)
    status: str = Column(String(20), nullable=False, default=STATUS_PUBLISHED, index=True)
    rating_sum: int = Column(Integer, nullable=False, default=0)
    rating_count: int = Column(Integer, nullable=False, default=0)
    moderation_note: str | None = Column(Text, nullable=True)
    moderated_at: datetime | None = Column(DateTime, nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    author = relationship("User", back_populates="scripts")
    reports = relationship("Report", back_populates="script", cascade="all, delete-orphan")
    ratings = relationship("Rating", cascade="all, delete-orphan")
    messages = relationship("ScriptMessage", cascade="all, delete-orphan", order_by="ScriptMessage.created_at")

    def to_dict(self, *, moderation: bool = False) -> dict[str, Any]:
        """``moderation``: include the moderator's note (for the author and administrators)."""
        data = {
            "id": self.id,
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "author": self.author.username if self.author else "LemonAI Official",
            "is_curated": self.is_curated,
            "category": self.category,
            "is_adult": bool(self.is_adult),
            "engine": self.engine,
            "preview_image_url": self.preview_image_url,
            "min_vram_gb": self.min_vram_gb,
            "min_ram_gb": self.min_ram_gb,
            "manifest": self.manifest_data,
            "downloads_count": self.downloads_count,
            "installs_count": self.installs_count or 0,
            "status": self.status or STATUS_PUBLISHED,
            "rating": round(self.rating_sum / self.rating_count, 2) if self.rating_count else None,
            "rating_count": self.rating_count or 0,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if moderation:
            data["moderation_note"] = self.moderation_note
            data["moderated_at"] = _iso(self.moderated_at)
        return data


class Report(Base):
    """A user's complaint about a Hub entry (malicious, broken, misleading, ...)."""

    __tablename__ = "reports"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id: str = Column(String(36), ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_id: str | None = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    reason: str = Column(String(20), nullable=False)
    details: str | None = Column(Text, nullable=True)
    status: str = Column(String(20), nullable=False, default=REPORT_OPEN, index=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    resolved_by_id: str | None = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: datetime | None = Column(DateTime, nullable=True)
    resolution_note: str | None = Column(Text, nullable=True)

    script = relationship("Script", back_populates="reports")
    reporter = relationship("User", foreign_keys=[reporter_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_id])

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "script": (
                {"id": self.script.id, "slug": self.script.slug, "name": self.script.name,
                 "status": self.script.status, "author": self.script.author.username if self.script.author else None}
                if self.script else None
            ),
            "reporter": self.reporter.username if self.reporter else None,
            "reason": self.reason,
            "details": self.details,
            "status": self.status,
            "created_at": _iso(self.created_at),
            "resolved_by": self.resolved_by.username if self.resolved_by else None,
            "resolved_at": _iso(self.resolved_at),
            "resolution_note": self.resolution_note,
        }


class ModerationAction(Base):
    """Audit log of what administrators (or automatic rules, ``actor_id`` NULL) did."""

    __tablename__ = "moderation_actions"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id: str | None = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: str = Column(String(40), nullable=False)
    target_type: str = Column(String(20), nullable=False)
    target_id: str = Column(String(36), nullable=False, index=True)
    target_label: str = Column(String(200), nullable=False, default="")
    reason: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    actor = relationship("User")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "actor": self.actor.username if self.actor else None,
            "action": self.action,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "target_label": self.target_label,
            "reason": self.reason,
            "created_at": _iso(self.created_at),
        }


class Rating(Base):
    """One user's 1–5 star rating of a Hub entry."""

    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("script_id", "user_id", name="uq_ratings_script_user"),)

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id: str = Column(String(36), ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: str = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stars: int = Column(Integer, nullable=False)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AppRelease(Base):
    """A desktop app release the updater offers (the installer lives at ``url``, signed)."""

    __tablename__ = "app_releases"
    __table_args__ = (UniqueConstraint("version", "target", name="uq_app_releases_version_target"),)

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    version: str = Column(String(40), nullable=False)
    target: str = Column(String(40), nullable=False, index=True)
    url: str = Column(String(500), nullable=False)
    signature: str = Column(Text, nullable=False)
    notes: str | None = Column(Text, nullable=True)
    created_by_id: str | None = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "target": self.target,
            "url": self.url,
            "signature": self.signature,
            "notes": self.notes,
            "created_at": _iso(self.created_at),
        }


class PasswordResetToken(Base):
    """A one-time code e-mailed to reset a forgotten password (only its hash is stored)."""

    __tablename__ = "password_reset_tokens"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: str = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash: str = Column(String(64), nullable=False)
    expires_at: datetime = Column(DateTime, nullable=False)
    attempts: int = Column(Integer, nullable=False, default=0)
    used_at: datetime | None = Column(DateTime, nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    """Something the user should know: a moderation decision, a moderator's reply, ..."""

    __tablename__ = "notifications"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: str = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: str = Column(String(40), nullable=False)
    title: str = Column(String(200), nullable=False)
    body: str | None = Column(Text, nullable=True)
    script_id: str | None = Column(String(36), nullable=True)
    script_slug: str | None = Column(String(100), nullable=True)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    read_at: datetime | None = Column(DateTime, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "body": self.body,
            "script_id": self.script_id,
            "script_slug": self.script_slug,
            "created_at": _iso(self.created_at),
            "read": self.read_at is not None,
        }


class ScriptMessage(Base):
    """The conversation between an entry's author and the moderators (appeals, questions)."""

    __tablename__ = "script_messages"

    id: str = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id: str = Column(String(36), ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: str | None = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    from_moderator: bool = Column(Boolean, nullable=False, default=False)
    body: str = Column(Text, nullable=False)
    created_at: datetime = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    author = relationship("User")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "author": self.author.username if self.author else None,
            "from_moderator": bool(self.from_moderator),
            "body": self.body,
            "created_at": _iso(self.created_at),
        }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


class RevokedToken(Base):
    """JWT ids that may no longer be used."""

    __tablename__ = "revoked_tokens"

    jti: str = Column(String(64), primary_key=True)
    user_id: str | None = Column(String(36), nullable=True, index=True)
    expires_at: datetime = Column(DateTime, nullable=False, index=True)


def _naive_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _maybe_prune_revoked_tokens(session: Session, now: datetime) -> None:
    global _last_revoked_prune
    mono = time.monotonic()
    should_prune = False
    with _revoked_prune_lock:
        if _last_revoked_prune == 0.0 or (mono - _last_revoked_prune) >= _REVOKED_PRUNE_INTERVAL:
            _last_revoked_prune = mono
            should_prune = True
    if should_prune:
        session.query(RevokedToken).filter(RevokedToken.expires_at < _naive_utc(now)).delete()


def consume_token(session: Session, payload: dict[str, Any]) -> bool:
    """Atomically revokes a single-use token inside a savepoint.

    Returns ``True`` if this caller consumed the token, or ``False`` if it was
    already revoked (replay detected via primary-key IntegrityError).
    """
    jti = payload.get("jti")
    if not jti:
        return False
    expires = datetime.fromtimestamp(int(payload.get("exp", 0)), tz=timezone.utc)
    now = datetime.now(timezone.utc)
    _maybe_prune_revoked_tokens(session, now)
    try:
        with session.begin_nested():
            session.add(
                RevokedToken(jti=jti, user_id=payload.get("sub"), expires_at=_naive_utc(expires))
            )
            session.flush()
        return True
    except IntegrityError:
        return False


def revoke_token(session_or_payload: Any, payload: dict[str, Any] | None = None) -> None:
    """Adds the token described by a decoded JWT payload to the blocklist."""
    if payload is None:
        actual_payload = session_or_payload
        session = db.session
    else:
        actual_payload = payload
        session = session_or_payload

    jti = actual_payload.get("jti")
    if not jti:
        return
    expires = datetime.fromtimestamp(int(actual_payload.get("exp", 0)), tz=timezone.utc)
    now = datetime.now(timezone.utc)
    _maybe_prune_revoked_tokens(session, now)
    if session.get(RevokedToken, jti) is None:
        try:
            with session.begin_nested():
                session.add(
                    RevokedToken(jti=jti, user_id=actual_payload.get("sub"), expires_at=_naive_utc(expires))
                )
                session.flush()
        except IntegrityError:
            pass


def is_token_revoked(session_or_payload: Any, payload: dict[str, Any] | None = None) -> bool:
    if payload is None:
        actual_payload = session_or_payload
        session = db.session
    else:
        actual_payload = payload
        session = session_or_payload

    jti = actual_payload.get("jti")
    user_id = actual_payload.get("sub")
    if not jti:
        return True
    if session.get(RevokedToken, jti) is not None:
        return True
    if user_id:
        user = session.get(User, user_id)
        if user is not None and user.tokens_valid_after is not None:
            token_iat = actual_payload.get("iat")
            if token_iat is None or isinstance(token_iat, bool):
                return True
            try:
                iat_ts = float(token_iat)
            except (ValueError, TypeError):
                return True
            if not math.isfinite(iat_ts):
                return True
            tva = user.tokens_valid_after
            tva_utc = tva if tva.tzinfo else tva.replace(tzinfo=timezone.utc)
            if iat_ts <= tva_utc.timestamp():
                return True
    return False


class QueryProperty:
    def __get__(self, instance, owner):
        return db.session.query(owner)

Base.query = QueryProperty()
