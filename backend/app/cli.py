import os

import click
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy.orm import Session

from app.config import Config
from app.database import Base, db_session, get_current_engine, init_db_engine, init_lock
from app.models import ADMIN_ROLE, User
from app.seed import seed_database

_CORE_SCHEMA_TABLES: frozenset[str] = frozenset({"users", "scripts", "revoked_tokens"})
_BASELINE_USER_COLS: frozenset[str] = frozenset({"username", "email", "password_hash"})
_BASELINE_SCRIPT_COLS: frozenset[str] = frozenset({"name", "slug", "downloads_count"})
_REVISION_COLUMN_CHECKPOINTS: tuple[tuple[frozenset[str], str], ...] = (
    (frozenset({"two_factor_enabled", "totp_secret", "backup_codes"}), "0001_initial_schema"),
    (frozenset({"tokens_valid_after"}), "0002_add_2fa"),
    (frozenset({"pending_totp_secret", "totp_last_step"}), "0003_add_tokens_valid_after"),
)


def _infer_pre_alembic_revision(inspector: Inspector, tables: set[str]) -> str:
    """Infer the Alembic revision matching an existing unversioned schema."""
    if "users" not in tables:
        raise RuntimeError(
            "Existing database has tables without 'users'; cannot safely infer pre-Alembic revision."
        )
    missing_core = sorted(_CORE_SCHEMA_TABLES - tables)
    if missing_core:
        raise RuntimeError(
            f"Existing database is missing core tables {missing_core}; "
            "cannot safely infer pre-Alembic revision."
        )

    user_cols = {col["name"] for col in inspector.get_columns("users")}
    missing_baseline = sorted(_BASELINE_USER_COLS - user_cols)
    if missing_baseline:
        raise RuntimeError(
            f"Existing 'users' table is missing baseline columns {missing_baseline}; "
            "cannot safely infer pre-Alembic revision."
        )

    for checkpoint_cols, prior_revision in _REVISION_COLUMN_CHECKPOINTS:
        present = checkpoint_cols & user_cols
        if not present:
            return prior_revision
        if present != checkpoint_cols:
            missing = sorted(checkpoint_cols - user_cols)
            raise RuntimeError(
                f"Existing 'users' table has partial migration state (missing {missing}); "
                "cannot safely infer pre-Alembic revision."
            )

    script_cols = {col["name"] for col in inspector.get_columns("scripts")}
    missing_script_baseline = sorted(_BASELINE_SCRIPT_COLS - script_cols)
    if missing_script_baseline:
        raise RuntimeError(
            f"Existing 'scripts' table is missing baseline columns {missing_script_baseline}; "
            "cannot safely infer pre-Alembic revision."
        )
    if "installs_count" not in script_cols:
        return "0004_add_pending_totp_secret"
    moderation_cols = {"status", "moderation_note", "moderated_at"} & script_cols
    if not moderation_cols:
        return "0005_add_installs_count"
    if moderation_cols != {"status", "moderation_note", "moderated_at"} or not {"reports", "moderation_actions"} <= tables:
        raise RuntimeError(
            "Existing database has partial moderation state; cannot safely infer pre-Alembic revision."
        )
    if "notify_email" not in user_cols:
        return "0006_add_moderation"
    if not {"password_reset_tokens", "notifications", "script_messages", "ratings", "app_releases"} <= tables:
        raise RuntimeError(
            "Existing database has partial notification state; cannot safely infer pre-Alembic revision."
        )
    if "is_adult" not in script_cols:
        return "0007_add_recovery_notifications"
    return "0008_add_script_is_adult"


def initialise_database(
    engine: Engine | None = None,
    seed: bool = True,
    upload_folder: str | None = None,
    schema_dir_cfg: str | None = None,
    admin_config: tuple[str | None, str | None, str | None] | None = None,
) -> None:
    eng = engine or get_current_engine()
    with init_lock(eng):
        migrations_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations")
        is_memory_sqlite = (
            eng.dialect.name == "sqlite"
            and (eng.url.database in (None, "", ":memory:"))
        )

        if os.path.isdir(migrations_dir) and not is_memory_sqlite:
            inspector = inspect(eng)
            tables = set(inspector.get_table_names())
            has_alembic = "alembic_version" in tables
            has_tables = bool(tables - {"alembic_version"})
            pre_alembic_rev = (
                _infer_pre_alembic_revision(inspector, tables)
                if has_tables and not has_alembic
                else None
            )

            try:
                from alembic.config import Config as AlembicConfig
                from alembic import command as alembic_command

                alembic_cfg = AlembicConfig(os.path.join(migrations_dir, "alembic.ini"))
                alembic_cfg.set_main_option("script_location", migrations_dir)
                alembic_cfg.set_main_option("sqlalchemy.url", str(eng.url).replace("%", "%%"))

                if pre_alembic_rev is not None:
                    alembic_command.stamp(alembic_cfg, pre_alembic_rev)
                alembic_command.upgrade(alembic_cfg, "head")
            except Exception as exc:
                raise RuntimeError(
                    f"Alembic migration failed and the application cannot start safely: {exc}"
                ) from exc
        else:
            Base.metadata.create_all(bind=eng)

        with db_session() as session:
            if seed:
                seed_database(session=session, upload_folder=upload_folder, schema_dir_cfg=schema_dir_cfg)
            if admin_config:
                username, email, password = admin_config
                if username and email and password:
                    create_admin(username, email, password, session=session)


def create_admin(
    username: str,
    email: str,
    password: str,
    session: Session | None = None,
) -> User:
    if len(password) < 12:
        raise click.ClickException("The admin password must be at least 12 characters long.")

    def _create(sess: Session) -> User:
        email_lower = email.strip().lower()
        existing = sess.query(User).filter_by(username=username).first()
        if existing:
            if existing.role != ADMIN_ROLE:
                raise click.ClickException(
                    f"Username '{username}' already belongs to a non-admin account (role='{existing.role}')."
                )
            return existing
        email_owner = sess.query(User).filter_by(email=email_lower).first()
        if email_owner:
            raise click.ClickException(
                f"Email '{email_lower}' is already in use by another account ('{email_owner.username}')."
            )
        admin = User(username=username, email=email_lower, role=ADMIN_ROLE)
        admin.set_password(password)
        sess.add(admin)
        sess.commit()
        return admin

    if session is not None:
        return _create(session)
    with db_session() as sess:
        return _create(sess)


@click.group()
def cli() -> None:
    """LemonAI Model Hub CLI."""
    pass


@cli.command("init-db")
@click.option("--seed/--no-seed", default=True, help="Seed curated manifests")
def init_db_cmd(seed: bool) -> None:
    """Initialize database schema and seed catalogue."""
    init_db_engine(Config.SQLALCHEMY_DATABASE_URI)
    initialise_database(
        seed=seed,
        upload_folder=Config.UPLOAD_FOLDER,
        schema_dir_cfg=Config.SCHEMA_DIR,
        admin_config=(Config.ADMIN_USERNAME, Config.ADMIN_EMAIL, Config.ADMIN_PASSWORD),
    )
    click.echo("Database initialised.")


@cli.command("create-admin")
@click.option("--username", prompt=True)
@click.option("--email", prompt=True)
@click.password_option()
def create_admin_cmd(username: str, email: str, password: str) -> None:
    """Create an administrator account."""
    init_db_engine(Config.SQLALCHEMY_DATABASE_URI)
    create_admin(username, email, password)
    click.echo(f"Admin user '{username}' created.")


if __name__ == "__main__":
    cli()
