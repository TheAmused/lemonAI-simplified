import logging
import os
import re
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

logger = logging.getLogger("lemonai.hub.auth")

_login_attempts: dict[str, list[float]] = {}
_rate_limit_lock = threading.Lock()
_redis_clients: dict[str, Any] = {}
_redis_lock = threading.Lock()

_REDIS_SLIDING_WINDOW_LUA = """
local now = tonumber(ARGV[1])
local member = ARGV[2]
local n = #KEYS
for i = 1, n do
    local max_req = tonumber(ARGV[2 + (i - 1) * 2 + 1])
    local window_ms = tonumber(ARGV[2 + (i - 1) * 2 + 2])
    redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window_ms)
    local count = redis.call('ZCARD', KEYS[i])
    if count >= max_req then
        return 0
    end
end
for i = 1, n do
    local window_ms = tonumber(ARGV[2 + (i - 1) * 2 + 2])
    redis.call('ZADD', KEYS[i], now, member)
    redis.call('PEXPIRE', KEYS[i], window_ms)
end
return 1
"""


def _get_redis_client(uri: str) -> Any | None:
    with _redis_lock:
        if uri in _redis_clients:
            return _redis_clients[uri]
        try:
            import redis
            client = redis.Redis.from_url(uri, socket_connect_timeout=1.0, socket_timeout=1.0)
            _redis_clients[uri] = client
            return client
        except Exception as exc:
            logger.warning("Redis rate-limit store unavailable (%s); falling back to memory", exc)
            return None


def _enforce_rate_limits_redis(
    uri: str,
    rules: list[tuple[str, int, float]],
    detail_msg: str,
) -> bool:
    """Returns True if handled by Redis, False if caller should fall back to memory."""
    client = _get_redis_client(uri)
    if client is None:
        return False
    now_ms = int(time.time() * 1000)
    member = f"{now_ms}:{secrets.token_hex(8)}"
    keys = [f"rl:{key}" for key, _, _ in rules]
    args: list[Any] = [now_ms, member]
    for _, max_requests, window in rules:
        args.append(int(max_requests))
        args.append(max(1, int(window * 1000)))
    try:
        allowed = client.eval(_REDIS_SLIDING_WINDOW_LUA, len(keys), *keys, *args)
    except Exception as exc:
        logger.warning("Redis rate-limit eval failed (%s); falling back to memory", exc)
        return False
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": detail_msg},
        )
    return True


def get_client_ip(request: Request) -> str:
    from app.config import active_config
    hops = int(getattr(active_config, "TRUSTED_PROXY_HOPS", 0) or 0)
    allow_test_remote = (
        os.environ.get("TESTING", "0") == "1"
        and bool(getattr(active_config, "TESTING", False))
    )
    test_ip = request.headers.get("x-test-remote-addr") if allow_test_remote else None
    direct_ip = test_ip or (request.client.host if request.client else "127.0.0.1")
    if hops > 0:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
            if len(ips) >= hops:
                return ips[-hops]
    return direct_ip


_MAX_RATE_LIMIT_KEYS = 10_000
_MAX_RATE_LIMIT_WINDOW = 900.0


def _enforce_rate_limits(
    rules: list[tuple[str, int, float]],
    detail_msg: str = "Too many login attempts. Please try again later.",
) -> None:
    """Atomically enforce sliding-window rate limits across multiple buckets."""
    from app.config import active_config
    if not getattr(active_config, "RATELIMIT_ENABLED", False):
        return
    if not rules:
        return

    storage_uri = str(getattr(active_config, "RATELIMIT_STORAGE_URI", "memory://") or "memory://")
    if storage_uri.startswith(("redis://", "rediss://")):
        if _enforce_rate_limits_redis(storage_uri, rules, detail_msg):
            return

    prune_window = max([_MAX_RATE_LIMIT_WINDOW, *(window for _, _, window in rules)])
    with _rate_limit_lock:
        now = time.monotonic()
        if len(_login_attempts) > 1000:
            stale_keys = [
                k for k, timestamps in _login_attempts.items()
                if not timestamps or timestamps[-1] <= now - prune_window
            ]
            for k in stale_keys:
                _login_attempts.pop(k, None)
        while len(_login_attempts) > _MAX_RATE_LIMIT_KEYS:
            _login_attempts.pop(next(iter(_login_attempts)), None)

        filtered_buckets: list[tuple[str, list[float]]] = []
        for key, max_requests, window in rules:
            recent = [t for t in _login_attempts.get(key, []) if t > now - window]
            if len(recent) >= max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={"error": detail_msg},
                )
            filtered_buckets.append((key, recent))

        for key, recent in filtered_buckets:
            _login_attempts.pop(key, None)
            recent.append(now)
            _login_attempts[key] = recent

        if len(_login_attempts) > _MAX_RATE_LIMIT_KEYS:
            stale_keys = [
                k for k, timestamps in _login_attempts.items()
                if not timestamps or timestamps[-1] <= now - prune_window
            ]
            for k in stale_keys:
                _login_attempts.pop(k, None)
        while len(_login_attempts) > _MAX_RATE_LIMIT_KEYS:
            _login_attempts.pop(next(iter(_login_attempts)), None)


def _enforce_rate_limit(
    key: str,
    max_requests: int = 10,
    window: float = 900.0,
    detail_msg: str = "Too many login attempts. Please try again later.",
) -> None:
    """Enforce a sliding-window rate limit for a single bucket key."""
    _enforce_rate_limits([(key, max_requests, window)], detail_msg=detail_msg)


def check_login_rate_limit(
    ip: str,
    identifier: str,
    max_requests: int = 10,
    window: float = 900.0,
) -> None:
    """Enforce a rate limit for a client IP and normalised identifier."""
    normalised = identifier.strip().lower()[:254]
    _enforce_rate_limit(f"{ip}:{normalised}", max_requests=max_requests, window=window)
import binascii
from datetime import datetime, timezone
import hashlib
import hmac
import secrets
import pyotp
import qrcode
import qrcode.image.svg
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_jwt import (
    create_2fa_ticket,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    get_current_user_and_token,
    get_refresh_user_and_token,
    reject_banned,
)
from app.database import get_db
from app.models import (
    MAX_PASSWORD_LENGTH,
    PasswordResetToken,
    User,
    _naive_utc,
    burn_password_check,
    consume_token,
    is_token_revoked,
    revoke_token,
)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,50}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
MIN_PASSWORD_LENGTH = 10


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str = ""
    email: str = ""
    password: str = ""


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    login: str | None = None
    username_or_email: str | None = None
    password: str = ""


def _tokens(user: User) -> dict[str, Any]:
    return {
        "access_token": create_access_token(identity=user.id),
        "refresh_token": create_refresh_token(identity=user.id),
        "user": user.to_dict(),
    }


@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(request)
    _enforce_rate_limit(
        f"register:{client_ip}",
        max_requests=10,
        window=900.0,
        detail_msg="Too many registration attempts. Please try again later.",
    )
    username = payload.username.strip()
    email = payload.email.strip().lower()
    password = payload.password

    if not username or not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Username, email, and password are required"},
        )
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Username must be 3-50 characters: letters, digits, '_', '.' or '-'"},
        )
    if not EMAIL_RE.match(email) or len(email) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "A valid email address is required"},
        )
    if not (MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters long"},
        )

    existing_user = db.query(User).filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "User with this username or email already exists"},
        )

    user = User(username=username, email=email)
    user.set_password(password)

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "User with this username or email already exists"},
        )
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Registration failed"},
        )

    return _tokens(user)


@auth_router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    login_id = (payload.login or payload.username_or_email or "").strip()
    password = payload.password

    if not login_id or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Login identifier and password are required"},
        )

    normalised_id = login_id.lower()[:254]
    client_ip = get_client_ip(request)
    _enforce_rate_limits(
        [
            (f"login-ip:{client_ip}", 60, 900.0),
            (f"login:{client_ip}:{normalised_id}", 10, 900.0),
            (f"acct:{normalised_id}", 20, 900.0),
        ]
    )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid credentials"},
        )

    user = db.query(User).filter(
        (User.username == login_id) | (User.email == login_id.lower())
    ).first()

    if user is None:
        burn_password_check(password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid credentials"},
        )
    if not user.check_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid credentials"},
        )
    reject_banned(user)

    if user.two_factor_enabled:
        ticket = create_2fa_ticket(identity=user.id)
        return {"two_factor_required": True, "ticket": ticket}

    return _tokens(user)


class Verify2FARequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ticket: str = ""
    code: str = ""


class Enable2FARequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    secret: str | None = None
    code: str = ""
    password: str = ""


class Disable2FARequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = ""


def _totp_now() -> int:
    return int(time.time())


def _verify_totp_step(
    secret: str,
    clean_code: str,
    last_step: int | None,
    valid_window: int = 1,
) -> int | None:
    """Verify a 6-digit TOTP code against ``secret`` with step-based replay protection.

    Returns the matched 30s time step (>= 0) on success, ``-1`` if the code
    matches a previously used (or older) step, or ``None`` if invalid.
    """
    if not secret or len(clean_code) != 6 or not clean_code.isascii() or not clean_code.isdigit():
        return None
    try:
        totp = pyotp.TOTP(secret)
        now_step = _totp_now() // 30
        replayed = False
        for offset in range(-valid_window, valid_window + 1):
            step = now_step + offset
            if step < 0:
                continue
            expected = totp.at(step * 30)
            if hmac.compare_digest(expected, clean_code):
                if last_step is not None and step <= last_step:
                    replayed = True
                    continue
                return step
        return -1 if replayed else None
    except (binascii.Error, ValueError, TypeError):
        return None


def _consume_backup_code(stored_codes: list[str], raw_code: str) -> list[str] | None:
    """Verify ``raw_code`` against salted (or legacy unsalted) backup hashes and return remaining codes."""
    stripped = raw_code.strip()
    clean_upper = stripped.replace(" ", "").replace("-", "").upper()
    if not clean_upper:
        return None
    if len(clean_upper) == 16:
        formatted = f"{clean_upper[:8]}-{clean_upper[8:]}"
    elif len(clean_upper) == 8:
        formatted = f"{clean_upper[:4]}-{clean_upper[4:]}"
    else:
        formatted = clean_upper
    candidates = tuple(dict.fromkeys((stripped, stripped.upper(), formatted, clean_upper)))
    remaining = list(stored_codes)
    for entry in remaining:
        if not isinstance(entry, str):
            continue
        if "$" in entry:
            salt, expected = entry.split("$", 1)
            matched = any(
                hmac.compare_digest(
                    hashlib.sha256(f"{salt}:{cand}".encode("utf-8")).hexdigest(),
                    expected,
                )
                for cand in candidates
            )
        else:
            matched = any(
                hmac.compare_digest(
                    hashlib.sha256(cand.encode("utf-8")).hexdigest(),
                    entry,
                )
                for cand in candidates
            )
        if matched:
            remaining.remove(entry)
            return remaining
    return None


@auth_router.post("/2fa/verify")
def verify_2fa(
    payload: Verify2FARequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if not payload.ticket or not payload.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Ticket and code are required"},
        )
    token_data = decode_token(payload.ticket)
    if token_data.get("type") != "2fa_challenge" or is_token_revoked(db, token_data):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication ticket"},
        )
    user_id = token_data.get("sub")
    client_ip = get_client_ip(request)
    _enforce_rate_limits(
        [
            (f"2fa:{client_ip}:{str(user_id or '').lower()}", 5, 300.0),
            (f"2fa-ticket:{client_ip}:{payload.ticket}", 5, 300.0),
            (f"2fa-acct:{user_id}", 10, 300.0),
        ],
        detail_msg="Too many 2FA verification attempts. Please try again later.",
    )

    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if not user or not user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Two-factor authentication is not active for this user"},
        )
    reject_banned(user)
    if is_token_revoked(db, token_data):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication ticket"},
        )

    clean_code = payload.code.strip().replace(" ", "").replace("-", "")
    verified = False

    if user.totp_secret:
        matched_step = _verify_totp_step(user.totp_secret, clean_code, user.totp_last_step)
        if matched_step is not None and matched_step >= 0:
            user.totp_last_step = matched_step
            verified = True

    if not verified and user.backup_codes:
        remaining_codes = _consume_backup_code(user.backup_codes, payload.code)
        if remaining_codes is not None:
            user.backup_codes = remaining_codes
            verified = True

    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid verification code"},
        )

    if not consume_token(db, token_data):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid authentication ticket"},
        )
    db.commit()

    return _tokens(user)


@auth_router.post("/2fa/setup")
def setup_2fa(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "Two-factor authentication is already enabled"},
        )
    secret = pyotp.random_base32()
    user.pending_totp_secret = secret
    user.totp_last_step = None
    db.commit()

    otpauth_url = pyotp.totp.TOTP(secret).provisioning_uri(
        name=user.email,
        issuer_name="LemonAI",
    )
    img = qrcode.make(otpauth_url, image_factory=qrcode.image.svg.SvgImage)
    svg_data = img.to_string(encoding="unicode")
    return {
        "secret": secret,
        "otpauth_url": otpauth_url,
        "qr_code_svg": svg_data,
    }


@auth_router.post("/2fa/enable")
def enable_2fa(
    payload: Enable2FARequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _enforce_rate_limit(
        f"2fa-enable:{user.id}",
        max_requests=10,
        window=300.0,
        detail_msg="Too many 2FA setup attempts. Please try again later.",
    )
    if user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "Two-factor authentication is already enabled"},
        )
    if not user.pending_totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "No pending 2FA setup. Call /2fa/setup first."},
        )
    if (
        not payload.password
        or len(payload.password) > MAX_PASSWORD_LENGTH
        or not user.check_password(payload.password)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Current password is required to enable 2FA"},
        )
    if payload.secret is not None and not hmac.compare_digest(
        payload.secret.encode("utf-8"),
        user.pending_totp_secret.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid or mismatched 2FA setup secret"},
        )
    if not payload.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Verification code is required"},
        )

    clean_code = payload.code.strip().replace(" ", "").replace("-", "")
    matched_step = _verify_totp_step(user.pending_totp_secret, clean_code, None)
    if matched_step is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid verification code"},
        )
    if matched_step == -1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "This code has already been used. Wait for the next code."},
        )

    plain_codes = [f"{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}" for _ in range(8)]
    hashed_codes = []
    for c in plain_codes:
        salt = secrets.token_hex(16)
        digest = hashlib.sha256(f"{salt}:{c}".encode("utf-8")).hexdigest()
        hashed_codes.append(f"{salt}${digest}")

    user.totp_secret = user.pending_totp_secret
    user.pending_totp_secret = None
    user.two_factor_enabled = True
    user.backup_codes = hashed_codes
    user.totp_last_step = matched_step
    db.commit()

    return {"backup_codes": plain_codes}


@auth_router.post("/2fa/disable")
def disable_2fa(
    payload: Disable2FARequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _enforce_rate_limit(
        f"2fa-disable:{user.id}",
        max_requests=5,
        window=300.0,
        detail_msg="Too many attempts to disable 2FA. Please try again later.",
    )
    if not user.check_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid password"},
        )
    user.two_factor_enabled = False
    user.totp_secret = None
    user.pending_totp_secret = None
    user.totp_last_step = None
    user.backup_codes = None
    db.commit()
    return {"message": "Two-factor authentication disabled"}


@auth_router.post("/refresh")
def refresh(
    auth_data: tuple[User, dict[str, Any]] = Depends(get_refresh_user_and_token),
    db: Session = Depends(get_db),
):
    user, payload = auth_data
    if not consume_token(db, payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Token has been revoked", "code": "token_revoked"},
        )
    db.commit()
    return {
        "access_token": create_access_token(identity=user.id),
        "refresh_token": create_refresh_token(identity=user.id),
    }


@auth_router.post("/logout")
def logout(
    auth_data: tuple[User, dict[str, Any]] = Depends(get_refresh_user_and_token),
    db: Session = Depends(get_db),
):
    _, payload = auth_data
    revoke_token(db, payload)
    db.commit()
    return {"status": "signed_out"}


@auth_router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"user": user.to_dict()}


@auth_router.get("/demo-accounts")
def get_demo_accounts():
    from app.config import active_config
    is_dev = getattr(active_config, "DEV_MODE", False) and getattr(active_config, "DEMO_ACCOUNTS_ENABLED", False)
    if not is_dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Demo accounts not available in production"},
        )
    admin_user = getattr(active_config, "ADMIN_USERNAME", "admin") or "admin"
    admin_pw = "AdminPass123!"
    return {
        "demo_accounts": [
            {
                "username": admin_user,
                "label": "Administrator",
                "role": "admin",
                "password": admin_pw,
            },
            {
                "username": "demo_creator",
                "label": "Twórca modeli",
                "role": "user",
                "password": "CreatorPass123!",
            },
        ]
    }


class UpdateProfileRequest(BaseModel):
    notify_email: bool | None = None
    model_config = ConfigDict(extra="ignore")
    username: str | None = None
    email: str | None = None
    avatar_url: str | None = None
    current_password: str | None = None


def _validate_avatar_url(raw: str) -> str | None:
    cleaned = raw.strip()
    if not cleaned:
        return None
    if len(cleaned) > 255 or any(ch.isspace() or ord(ch) < 32 for ch in cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Avatar URL must be a valid https:// URL or uploaded image path"},
        )
    if cleaned.startswith("https://"):
        if len(cleaned) <= len("https://"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Avatar URL must be a valid https:// URL or uploaded image path"},
            )
        return cleaned
    if cleaned.startswith("/api/uploads/images/"):
        rest = cleaned[len("/api/uploads/images/"):]
        if not rest or "/" in rest or "\\" in rest or ".." in rest:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Avatar URL must be a valid https:// URL or uploaded image path"},
            )
        return cleaned
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "Avatar URL must be an https:// URL or an uploaded image path"},
    )


@auth_router.put("/profile")
def update_profile(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.username is not None:
        new_username = payload.username.strip()
        if not USERNAME_RE.match(new_username):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Username must be 3-50 characters: letters, digits, '_', '.' or '-'"},
            )
        existing = db.query(User).filter(User.username == new_username, User.id != user.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "User with this username or email already exists"},
            )
        user.username = new_username

    if payload.email is not None:
        new_email = payload.email.strip().lower()
        if not EMAIL_RE.match(new_email) or len(new_email) > 120:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "A valid email address is required"},
            )
        if new_email != user.email:
            if not payload.current_password or not user.check_password(payload.current_password):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"error": "Current password is required to change email"},
                )
        existing = db.query(User).filter(User.email == new_email, User.id != user.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "User with this username or email already exists"},
            )
        user.email = new_email

    if payload.avatar_url is not None:
        user.avatar_url = _validate_avatar_url(payload.avatar_url)

    if payload.notify_email is not None:
        user.notify_email = bool(payload.notify_email)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "User with this username or email already exists"},
        )
    db.refresh(user)
    return {"user": user.to_dict()}


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    old_password: str = ""
    new_password: str = ""


@auth_router.put("/password")
def change_password(
    payload: ChangePasswordRequest,
    user_and_token: tuple[User, dict[str, Any]] = Depends(get_current_user_and_token),
    db: Session = Depends(get_db),
):
    user, token_payload = user_and_token
    _enforce_rate_limit(
        f"pw:{user.id}",
        max_requests=10,
        window=900.0,
        detail_msg="Too many password change attempts. Please try again later.",
    )
    if not user.check_password(payload.old_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Current password is incorrect"},
        )
    if not (MIN_PASSWORD_LENGTH <= len(payload.new_password) <= MAX_PASSWORD_LENGTH):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters long"},
        )
    user.set_password(payload.new_password)
    user.tokens_valid_after = _naive_utc(datetime.now(timezone.utc))
    revoke_token(db, token_payload)
    db.commit()
    return {"message": "Password updated successfully"}


@auth_router.post("/sessions/revoke-all")
def revoke_all_sessions(
    user_and_token: tuple[User, dict[str, Any]] = Depends(get_current_user_and_token),
    db: Session = Depends(get_db),
):
    user, token_payload = user_and_token
    user.tokens_valid_after = _naive_utc(datetime.now(timezone.utc))
    revoke_token(db, token_payload)
    db.commit()
    return {"message": "All sessions revoked"}


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = ""


@auth_router.delete("/account")
def delete_account(
    payload: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _enforce_rate_limit(
        f"delete-acct:{user.id}",
        max_requests=5,
        window=900.0,
        detail_msg="Too many account deletion attempts. Please try again later.",
    )
    if not user.check_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Current password is required to delete account"},
        )
    from app.config import Config, active_config
    upload_folder = getattr(active_config, "UPLOAD_FOLDER", Config.UPLOAD_FOLDER)
    images_dir = os.path.abspath(os.path.join(upload_folder, "images"))
    preview_paths: list[str] = []
    for s in user.scripts:
        if s.preview_image_url and s.preview_image_url.startswith("/api/uploads/images/"):
            img_name = s.preview_image_url.split("/")[-1]
            img_path = os.path.abspath(os.path.join(images_dir, os.path.basename(img_name)))
            if os.path.commonpath([images_dir, img_path]) == images_dir:
                preview_paths.append(img_path)

    from app.models import (
        AppRelease,
        ModerationAction,
        Notification,
        PasswordResetToken,
        Rating,
        Report,
        Script,
        ScriptMessage,
    )

    db.query(AppRelease).filter(AppRelease.created_by_id == user.id).update(
        {AppRelease.created_by_id: None}, synchronize_session=False
    )
    db.query(Report).filter(Report.reporter_id == user.id).update({Report.reporter_id: None}, synchronize_session=False)
    db.query(Report).filter(Report.resolved_by_id == user.id).update({Report.resolved_by_id: None}, synchronize_session=False)
    db.query(ModerationAction).filter(ModerationAction.actor_id == user.id).update(
        {ModerationAction.actor_id: None}, synchronize_session=False
    )
    db.query(ScriptMessage).filter(ScriptMessage.author_id == user.id).update(
        {ScriptMessage.author_id: None}, synchronize_session=False
    )
    db.query(Notification).filter(Notification.user_id == user.id).delete(synchronize_session=False)
    rated = [sid for (sid,) in db.query(Rating.script_id).filter(Rating.user_id == user.id).all()]
    db.query(Rating).filter(Rating.user_id == user.id).delete(synchronize_session=False)
    if rated:
        from sqlalchemy import func as _func

        locked_scripts = (
            db.query(Script)
            .filter(Script.id.in_(rated))
            .order_by(Script.id.asc())
            .with_for_update()
            .all()
        )
        for script in locked_scripts:
            total, count = db.query(_func.coalesce(_func.sum(Rating.stars), 0), _func.count(Rating.id)).filter(
                Rating.script_id == script.id
            ).one()
            script.rating_sum, script.rating_count = int(total or 0), int(count or 0)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()

    for img_path in preview_paths:
        if os.path.isfile(img_path):
            try:
                os.remove(img_path)
            except OSError:
                pass

    return {"message": "Account deleted successfully"}



RESET_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
RESET_MAX_ATTEMPTS = 5


def _reset_hash(user_id: str, code: str) -> str:
    normalised = re.sub(r"[^A-Z0-9]", "", code.upper())
    return hashlib.sha256(f"{user_id}:{normalised}".encode()).hexdigest()


def issue_reset_code(db: Session, user: User) -> str:
    """A new code for ``user`` (earlier unused ones stop working)."""
    from datetime import timedelta
    from app.config import active_config

    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()
    code = "".join(secrets.choice(RESET_ALPHABET) for _ in range(8))
    minutes = int(getattr(active_config, "PASSWORD_RESET_MINUTES", 30) or 30)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            code_hash=_reset_hash(user.id, code),
            expires_at=_naive_utc(datetime.now(timezone.utc) + timedelta(minutes=minutes)),
        )
    )
    return f"{code[:4]}-{code[4:]}"


def _find_account(db: Session, login: str) -> User | None:
    login = login.strip()
    if not login:
        return None
    return db.query(User).filter((User.username == login) | (User.email == login.lower())).first()


class ResetRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    login: str = ""


@auth_router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(payload: ResetRequest, request: Request, db: Session = Depends(get_db)):
    """E-mails a reset code. The answer is the same whether or not the account exists."""
    from app import mailer
    from app.config import active_config

    if not mailer.configured() and not (
        getattr(active_config, "DEV_MODE", False) or getattr(active_config, "TESTING", False)
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "This Hub cannot send e-mail. Ask an administrator for a reset code.",
                "code": "mail_not_configured",
            },
        )
    login = payload.login.strip()[:254]
    _enforce_rate_limits(
        [
            (f"reset-ip:{get_client_ip(request)}", 10, 900.0),
            (f"reset-id:{login.lower()}", 3, 900.0),
        ],
        detail_msg="Too many reset requests. Please try again later.",
    )
    user = _find_account(db, login)
    from app.models import SYSTEM_ROLE

    if user is not None and user.role != SYSTEM_ROLE and user.email and not user.email.endswith(".invalid"):
        from app.config import active_config as cfg

        code = issue_reset_code(db, user)
        minutes = int(getattr(cfg, "PASSWORD_RESET_MINUTES", 30) or 30)
        mailer.queue(
            db,
            user.email,
            "LemonAI Hub: kod do zmiany hasła",
            f"Cześć {user.username},\n\nTwój kod do ustawienia nowego hasła: {code}\n"
            f"Wpisz go w aplikacji LemonAI (Zaloguj się → Nie pamiętasz hasła?). Kod jest ważny {minutes} minut.\n\n"
            "Jeśli to nie Ty prosiłeś o zmianę hasła, zignoruj tę wiadomość; Twoje hasło się nie zmieni.",
        )
        db.commit()
    return {"message": "If an account with that name or e-mail exists, a code has been sent to its e-mail address."}


class ResetConfirm(BaseModel):
    model_config = ConfigDict(extra="ignore")
    login: str = ""
    code: str = ""
    new_password: str = ""


@auth_router.post("/password-reset/confirm")
def confirm_password_reset(payload: ResetConfirm, request: Request, db: Session = Depends(get_db)):
    login = payload.login.strip()[:254]
    _enforce_rate_limits(
        [
            (f"reset-confirm-ip:{get_client_ip(request)}", 20, 900.0),
            (f"reset-confirm-id:{login.lower()}", 10, 900.0),
        ],
        detail_msg="Too many attempts. Please try again later.",
    )
    if not (MIN_PASSWORD_LENGTH <= len(payload.new_password) <= MAX_PASSWORD_LENGTH):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters long"},
        )
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "The code is wrong or has expired. Ask for a new one.", "code": "invalid_reset_code"},
    )
    user = _find_account(db, login)
    if user is None:
        raise invalid
    now = _naive_utc(datetime.now(timezone.utc))
    token = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .order_by(PasswordResetToken.created_at.desc())
        .with_for_update()
        .first()
    )
    if token is None or token.expires_at < now or token.attempts >= RESET_MAX_ATTEMPTS:
        raise invalid
    if not hmac.compare_digest(token.code_hash, _reset_hash(user.id, payload.code)):
        db.query(PasswordResetToken).filter(
            PasswordResetToken.id == token.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.attempts < RESET_MAX_ATTEMPTS,
        ).update({PasswordResetToken.attempts: PasswordResetToken.attempts + 1}, synchronize_session=False)
        db.commit()
        raise invalid
    updated = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.id == token.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.attempts < RESET_MAX_ATTEMPTS,
        )
        .update(
            {
                PasswordResetToken.attempts: PasswordResetToken.attempts + 1,
                PasswordResetToken.used_at: now,
            },
            synchronize_session=False,
        )
    )
    if updated == 0:
        db.rollback()
        raise invalid
    user.set_password(payload.new_password)
    user.tokens_valid_after = now
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id, PasswordResetToken.id != token.id
    ).delete()
    from app.notify import notify

    notify(
        db, user, "password_changed", "Hasło do Twojego konta zostało zmienione",
        "Hasło ustawiono kodem resetu. Jeśli to nie Ty, natychmiast poproś administratora Hubu o pomoc.",
    )
    db.commit()
    return {"message": "Password updated. Sign in with the new password."}
