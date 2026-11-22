import time
import uuid
from datetime import timedelta
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

import app.config as config_mod
from app.database import get_db
from app.models import User, is_token_revoked


def _get_secret(secret_key: str | None = None) -> str:
    if secret_key:
        return secret_key
    cfg = config_mod.active_config
    secret = getattr(cfg, "JWT_SECRET_KEY", None)
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY is not configured")
    return secret


def create_access_token(
    identity: str,
    secret_key: str | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    cfg = config_mod.active_config
    secret = _get_secret(secret_key)
    delta = expires_delta if expires_delta is not None else getattr(cfg, "JWT_ACCESS_TOKEN_EXPIRES", timedelta(minutes=15))
    now_ts = time.time()
    payload = {
        "sub": str(identity),
        "type": "access",
        "jti": str(uuid.uuid4()),
        "iat": now_ts,
        "exp": now_ts + delta.total_seconds(),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_refresh_token(
    identity: str,
    secret_key: str | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    cfg = config_mod.active_config
    secret = _get_secret(secret_key)
    delta = expires_delta if expires_delta is not None else getattr(cfg, "JWT_REFRESH_TOKEN_EXPIRES", timedelta(days=14))
    now_ts = time.time()
    payload = {
        "sub": str(identity),
        "type": "refresh",
        "jti": str(uuid.uuid4()),
        "iat": now_ts,
        "exp": now_ts + delta.total_seconds(),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_2fa_ticket(
    identity: str,
    secret_key: str | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    secret = _get_secret(secret_key)
    delta = expires_delta if expires_delta is not None else timedelta(minutes=5)
    now_ts = time.time()
    payload = {
        "sub": str(identity),
        "type": "2fa_challenge",
        "jti": str(uuid.uuid4()),
        "iat": now_ts,
        "exp": now_ts + delta.total_seconds(),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, secret_key: str | None = None) -> dict[str, Any]:
    secret = _get_secret(secret_key)
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Authentication token expired", "code": "token_expired"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication token"},
        )


def reject_banned(user: User) -> None:
    """A blocked account can neither sign in nor use a session it still holds."""
    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "This account has been blocked by a moderator",
                "code": "account_banned",
                "reason": user.ban_reason,
            },
        )


def _extract_bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Authentication required"},
        )
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication token"},
        )
    return parts[1]


def get_current_user_and_token(
    token: str = Depends(_extract_bearer),
    db: Session = Depends(get_db),
) -> tuple[User, dict[str, Any]]:
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication token"},
        )
    if is_token_revoked(db, payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Session has been signed out", "code": "token_revoked"},
        )
    user_id = payload.get("sub")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "User not found"},
        )
    reject_banned(user)
    return user, payload


def get_current_user(user_and_token: tuple[User, dict[str, Any]] = Depends(get_current_user_and_token)) -> User:
    return user_and_token[0]


def get_refresh_user_and_token(
    token: str = Depends(_extract_bearer),
    db: Session = Depends(get_db),
) -> tuple[User, dict[str, Any]]:
    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication token"},
        )
    if is_token_revoked(db, payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Session has been signed out", "code": "token_revoked"},
        )
    user_id = payload.get("sub")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "User not found"},
        )
    reject_banned(user)
    return user, payload


def get_optional_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """The signed-in user when a valid access token is sent, otherwise ``None`` (never an error)."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    try:
        payload = decode_token(parts[1])
    except HTTPException:
        return None
    if payload.get("type") != "access" or is_token_revoked(db, payload):
        return None
    user = db.get(User, payload.get("sub"))
    if user is None or user.is_banned:
        return None
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    from app.models import ADMIN_ROLE

    if user.role != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "Administrator privileges required"},
        )
    return user
