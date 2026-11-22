import os
from datetime import timedelta
from typing import Optional

MIN_SECRET_BYTES = 32

KNOWN_INSECURE_SECRETS = frozenset(
    {
        "lemonai_flask_secret_key_2026",
        "lemonai_jwt_secret_dev_2026",
        "changeme",
        "secret",
    }
)

DEFAULT_CORS_ORIGINS = "http://tauri.localhost,tauri://localhost,http://localhost:1420"


class ConfigError(RuntimeError):
    """The application is mis-configured and must not start."""


def _csv(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _database_uri() -> str:
    raw: Optional[str] = os.getenv("DATABASE_URL")
    if not raw:
        return "sqlite:///lemonai_hub.db"
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return raw.replace(prefix, "postgresql+psycopg://", 1)
    return raw


class Config:
    SECRET_KEY: Optional[str] = os.getenv("SECRET_KEY")
    JWT_SECRET_KEY: Optional[str] = os.getenv("JWT_SECRET_KEY")
    JWT_ACCESS_TOKEN_EXPIRES: timedelta = timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "15")))
    JWT_REFRESH_TOKEN_EXPIRES: timedelta = timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "14")))

    CORS_ORIGINS: list[str] = _csv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)

    SQLALCHEMY_DATABASE_URI: str = _database_uri()

    UPLOAD_FOLDER: str = os.getenv(
        "UPLOAD_FOLDER",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads")),
    )
    MAX_CONTENT_LENGTH: int = 10 * 1024 * 1024

    ADMIN_USERNAME: Optional[str] = os.getenv("ADMIN_USERNAME")
    ADMIN_EMAIL: Optional[str] = os.getenv("ADMIN_EMAIL")
    ADMIN_PASSWORD: Optional[str] = os.getenv("ADMIN_PASSWORD")

    TRUSTED_PROXY_HOPS: int = int(os.getenv("TRUSTED_PROXY_HOPS", "0"))
    RATELIMIT_STORAGE_URI: str = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_ENABLED: bool = os.getenv("RATELIMIT_ENABLED", "1") != "0"

    SCHEMA_DIR: Optional[str] = os.getenv("LEMON_SCHEMA_DIR")

    HUB_REQUIRE_APPROVAL: bool = os.getenv("HUB_REQUIRE_APPROVAL", "0") == "1"
    REPORT_HOLD_THRESHOLD: int = int(os.getenv("REPORT_HOLD_THRESHOLD", "3"))

    SMTP_HOST: Optional[str] = os.getenv("SMTP_HOST") or None
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: Optional[str] = os.getenv("SMTP_USERNAME") or None
    SMTP_PASSWORD: Optional[str] = os.getenv("SMTP_PASSWORD") or None
    SMTP_SECURITY: str = os.getenv("SMTP_SECURITY", "starttls")
    MAIL_FROM: Optional[str] = os.getenv("MAIL_FROM") or None
    PASSWORD_RESET_MINUTES: int = int(os.getenv("PASSWORD_RESET_MINUTES", "30"))
    DEV_MODE: bool = (
        os.getenv("ENV", "").lower() not in ("production", "prod")
        and os.getenv("LEMON_ENV", "").lower() not in ("production", "prod")
        and (
            os.getenv("LEMON_ENV", "production").lower() in ("development", "dev", "test")
            or os.getenv("TESTING", "0") == "1"
        )
    )
    DEMO_ACCOUNTS_ENABLED: bool = DEV_MODE and (os.getenv("DEMO_ACCOUNTS_ENABLED", "1") == "1")


active_config: Config = Config()


def set_active_config(cfg: Config) -> None:
    global active_config
    active_config = cfg


def validate_secrets(config: dict | object) -> None:
    """Refuses to start without strong secrets supplied by the environment."""
    for key in ("SECRET_KEY", "JWT_SECRET_KEY"):
        value = config.get(key) if isinstance(config, dict) else getattr(config, key, None)
        if not value:
            raise ConfigError(
                f"{key} is not set. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if value in KNOWN_INSECURE_SECRETS:
            raise ConfigError(f"{key} is a well-known public value; generate a new secret.")
        if len(value.encode("utf-8")) < MIN_SECRET_BYTES:
            raise ConfigError(f"{key} must be at least {MIN_SECRET_BYTES} bytes long.")
