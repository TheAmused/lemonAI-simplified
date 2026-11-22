import contextlib
import logging
import os
import tempfile
import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app import create_app
from app.config import Config
from app.database import Base
from app.models import Script, User, db
from app.seed import seed_database


class MigrationTestConfig(Config):
    TESTING = True
    SECRET_KEY = "migration-secret-key-0123456789-abcdef"
    JWT_SECRET_KEY = "migration-jwt-secret-0123456789-abcdef"
    RATELIMIT_ENABLED = False


def _get_alembic_config(db_url: str) -> AlembicConfig:
    migrations_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations")
    ini_path = os.path.join(migrations_dir, "alembic.ini")
    cfg = AlembicConfig(ini_path)
    cfg.set_main_option("script_location", migrations_dir)
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


@pytest.fixture
def migration_app():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    db_url = f"sqlite:///{db_path}"

    class FileDbConfig(MigrationTestConfig):
        SQLALCHEMY_DATABASE_URI = db_url

    app = create_app(config_class=FileDbConfig, auto_seed=False, init_db=False)
    yield app, db_url

    try:
        db.session.remove()
        db.engine.dispose()
    except Exception:
        pass
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except OSError:
            pass


def test_migration_upgrade_and_downgrade_cycle(migration_app):
    app, db_url = migration_app
    cfg = _get_alembic_config(db_url)

    alembic_command.upgrade(cfg, "head")
    inspector = inspect(db.engine)
    assert inspector.has_table("users")
    assert inspector.has_table("scripts")
    assert inspector.has_table("revoked_tokens")
    assert inspector.has_table("alembic_version")
    user_cols = [c["name"] for c in inspector.get_columns("users")]
    assert "tokens_valid_after" in user_cols
    assert "pending_totp_secret" in user_cols
    assert "totp_last_step" in user_cols
    script_cols = {c["name"]: c for c in inspector.get_columns("scripts")}
    assert "installs_count" in script_cols
    assert script_cols["installs_count"]["nullable"] is False

    assert {"status", "moderation_note", "moderated_at"} <= set(script_cols)
    assert {"banned_at", "ban_reason"} <= set(user_cols)
    assert inspector.has_table("reports")
    assert inspector.has_table("moderation_actions")
    assert inspector.has_table("notifications")
    assert inspector.has_table("script_messages")
    assert inspector.has_table("password_reset_tokens")
    assert "notify_email" in user_cols

    alembic_command.downgrade(cfg, "0006_add_moderation")
    inspector = inspect(db.engine)
    assert not inspector.has_table("notifications")
    assert "notify_email" not in [c["name"] for c in inspector.get_columns("users")]
    alembic_command.upgrade(cfg, "head")

    alembic_command.downgrade(cfg, "0005_add_installs_count")
    inspector = inspect(db.engine)
    assert not inspector.has_table("reports")
    assert not inspector.has_table("moderation_actions")
    assert "status" not in [c["name"] for c in inspector.get_columns("scripts")]
    assert "banned_at" not in [c["name"] for c in inspector.get_columns("users")]
    alembic_command.upgrade(cfg, "head")
    alembic_command.downgrade(cfg, "0005_add_installs_count")

    alembic_command.downgrade(cfg, "0004_add_pending_totp_secret")
    inspector = inspect(db.engine)
    assert "installs_count" not in [c["name"] for c in inspector.get_columns("scripts")]
    assert "pending_totp_secret" in [c["name"] for c in inspector.get_columns("users")]

    alembic_command.downgrade(cfg, "0003_add_tokens_valid_after")
    inspector = inspect(db.engine)
    user_cols = [c["name"] for c in inspector.get_columns("users")]
    assert "pending_totp_secret" not in user_cols
    assert "totp_last_step" not in user_cols
    assert "tokens_valid_after" in user_cols

    alembic_command.downgrade(cfg, "0002_add_2fa")
    inspector = inspect(db.engine)
    assert "tokens_valid_after" not in [c["name"] for c in inspector.get_columns("users")]

    alembic_command.downgrade(cfg, "base")
    inspector = inspect(db.engine)
    assert not inspector.has_table("users")
    assert not inspector.has_table("scripts")
    assert not inspector.has_table("revoked_tokens")


def test_upgrade_and_seed_integration(migration_app):
    app, db_url = migration_app
    cfg = _get_alembic_config(db_url)
    alembic_command.upgrade(cfg, "head")
    seed_database()

    official_user = User.query.filter_by(username="lemonai-official").first()
    assert official_user is not None
    scripts = Script.query.filter_by(is_curated=True).all()
    assert len(scripts) >= 4


def test_pre_existing_unversioned_database_stamp_and_upgrade(migration_app):
    from app.cli import initialise_database

    app, db_url = migration_app
    db.create_all()
    inspector = inspect(db.engine)
    assert inspector.has_table("users")
    assert not inspector.has_table("alembic_version")

    initialise_database(seed=False)

    inspector = inspect(db.engine)
    assert inspector.has_table("users")
    assert inspector.has_table("alembic_version")

    u = User(username="legacy_user", email="legacy@lemonai.test", role="user")
    u.set_password("legacy-password-12345")
    db.session.add(u)
    db.session.commit()
    assert User.query.filter_by(username="legacy_user").first() is not None


def test_sqlite_in_memory_url_variants_bypass_migrations():
    from app.cli import initialise_database

    for uri in ("sqlite://", "sqlite:///:memory:"):
        class InMemoryConfig(MigrationTestConfig):
            SQLALCHEMY_DATABASE_URI = uri

        app = create_app(config_class=InMemoryConfig, auto_seed=False, init_db=False)
        initialise_database(seed=False)
        inspector = inspect(db.engine)
        assert inspector.has_table("users")
        assert not inspector.has_table("alembic_version")
        db.session.remove()
        db.engine.dispose()


class _CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextlib.contextmanager
def _preserved_logging_state(*extra_logger_names: str):
    """Snapshot and restore global logging state around Alembic fileConfig tests."""
    root_logger = logging.getLogger()
    orig_root_level = root_logger.level
    orig_root_handlers = list(root_logger.handlers)
    alembic_loggers = ("sqlalchemy.engine", "alembic", "alembic.env")
    orig_logger_state: dict[str, tuple[int, list[logging.Handler], bool, bool]] = {}
    for name in dict.fromkeys((*alembic_loggers, *extra_logger_names)):
        lg = logging.getLogger(name)
        orig_logger_state[name] = (lg.level, list(lg.handlers), lg.disabled, lg.propagate)

    orig_disabled = {
        name: obj.disabled
        for name, obj in logging.Logger.manager.loggerDict.items()
        if isinstance(obj, logging.Logger)
    }

    try:
        yield root_logger
    finally:
        for h in list(root_logger.handlers):
            if h not in orig_root_handlers:
                h.close()
        root_logger.setLevel(orig_root_level)
        root_logger.handlers[:] = orig_root_handlers

        for name, obj in logging.Logger.manager.loggerDict.items():
            if isinstance(obj, logging.Logger) and name in orig_disabled:
                obj.disabled = orig_disabled[name]

        for name, (level, handlers, disabled, propagate) in orig_logger_state.items():
            lg = logging.getLogger(name)
            for h in list(lg.handlers):
                if h not in handlers:
                    h.close()
            lg.setLevel(level)
            lg.handlers[:] = handlers
            lg.disabled = disabled
            lg.propagate = propagate


def test_alembic_file_config_preserves_existing_server_loggers(migration_app):
    from app.cli import initialise_database

    target_names = ("uvicorn.access", "uvicorn.error", "lemonai.hub")

    with _preserved_logging_state(*target_names) as root_logger:
        root_logger.handlers.clear()
        capture_handlers: dict[str, _CaptureHandler] = {}
        for name in target_names:
            lg = logging.getLogger(name)
            lg.disabled = False
            lg.setLevel(logging.INFO)
            handler = _CaptureHandler()
            lg.addHandler(handler)
            capture_handlers[name] = handler

        initialise_database(seed=False)
        assert inspect(db.engine).has_table("alembic_version")

        for name in target_names:
            lg = logging.getLogger(name)
            assert lg.disabled is False, f"Logger {name!r} was disabled by Alembic fileConfig"
            lg.info(f"ping:{name}")
            assert f"ping:{name}" in capture_handlers[name].messages


def test_alembic_skips_file_config_when_root_handlers_exist(migration_app):
    from app.cli import initialise_database

    with _preserved_logging_state("lemonai.hub") as root_logger:
        root_handler = _CaptureHandler()
        root_logger.handlers[:] = [root_handler]
        root_logger.setLevel(logging.INFO)

        hub_logger = logging.getLogger("lemonai.hub")
        hub_logger.disabled = False
        hub_logger.setLevel(logging.INFO)
        hub_logger.propagate = True
        hub_logger.handlers.clear()

        initialise_database(seed=False)
        assert inspect(db.engine).has_table("alembic_version")

        assert root_logger.handlers == [root_handler]
        assert root_logger.level == logging.INFO
        assert hub_logger.disabled is False

        hub_logger.info("hub-startup-ok")
        assert "hub-startup-ok" in root_handler.messages


def test_initialise_database_fails_fast_on_alembic_error(migration_app, monkeypatch):
    from app.cli import initialise_database

    _, _ = migration_app
    create_all_called = False
    orig_create_all = Base.metadata.create_all

    def _spy_create_all(*args, **kwargs):
        nonlocal create_all_called
        create_all_called = True
        return orig_create_all(*args, **kwargs)

    def _failing_upgrade(*args, **kwargs):
        raise RuntimeError("simulated alembic failure")

    monkeypatch.setattr(Base.metadata, "create_all", _spy_create_all)
    monkeypatch.setattr(alembic_command, "upgrade", _failing_upgrade)

    with pytest.raises(RuntimeError, match="Alembic migration failed") as exc_info:
        initialise_database(seed=False)

    assert isinstance(exc_info.value.__cause__, RuntimeError)
    assert "simulated alembic failure" in str(exc_info.value.__cause__)
    assert create_all_called is False
    inspector = inspect(db.engine)
    assert not inspector.has_table("users")
    assert not inspector.has_table("alembic_version")


@pytest.mark.parametrize(
    ("start_revision", "expected_absent_cols"),
    [
        (
            "0001_initial_schema",
            {
                "two_factor_enabled",
                "totp_secret",
                "backup_codes",
                "tokens_valid_after",
                "pending_totp_secret",
                "totp_last_step",
            },
        ),
        ("0002_add_2fa", {"tokens_valid_after", "pending_totp_secret", "totp_last_step"}),
        ("0003_add_tokens_valid_after", {"pending_totp_secret", "totp_last_step"}),
        ("0004_add_pending_totp_secret", set()),
        ("0005_add_installs_count", set()),
    ],
)
def test_pre_alembic_schema_stamps_matched_revision_and_upgrades_to_head(
    migration_app, monkeypatch, start_revision, expected_absent_cols
):
    from app.cli import initialise_database

    _, db_url = migration_app
    cfg = _get_alembic_config(db_url)
    expected_head = ScriptDirectory.from_config(cfg).get_current_head()
    alembic_command.upgrade(cfg, start_revision)

    with db.engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))

    pre_cols = {c["name"] for c in inspect(db.engine).get_columns("users")}
    assert pre_cols.isdisjoint(expected_absent_cols)
    if start_revision != "0005_add_installs_count":
        pre_script_cols = {c["name"] for c in inspect(db.engine).get_columns("scripts")}
        assert "installs_count" not in pre_script_cols
    assert not inspect(db.engine).has_table("alembic_version")

    stamped_revisions: list[str] = []
    orig_stamp = alembic_command.stamp

    def _spy_stamp(config, revision, *args, **kwargs):
        stamped_revisions.append(revision)
        return orig_stamp(config, revision, *args, **kwargs)

    monkeypatch.setattr(alembic_command, "stamp", _spy_stamp)
    initialise_database(seed=False)

    assert stamped_revisions == [start_revision]

    inspector = inspect(db.engine)
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    assert {"two_factor_enabled", "tokens_valid_after", "pending_totp_secret", "totp_last_step"} <= user_cols
    script_cols = {c["name"] for c in inspector.get_columns("scripts")}
    assert "installs_count" in script_cols
    assert inspector.has_table("alembic_version")

    with db.engine.connect() as conn:
        version_num = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version_num == expected_head


@pytest.mark.parametrize(
    ("ddl_statements", "expected_message"),
    [
        (
            ["CREATE TABLE orphan_table (id INTEGER PRIMARY KEY)"],
            "tables without 'users'",
        ),
        (
            ["CREATE TABLE users (id TEXT PRIMARY KEY)"],
            "missing core tables",
        ),
        (
            [
                "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)",
                "CREATE TABLE scripts (id TEXT PRIMARY KEY)",
                "CREATE TABLE revoked_tokens (jti TEXT PRIMARY KEY)",
            ],
            "missing baseline columns",
        ),
        (
            [
                (
                    "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, "
                    "email TEXT, password_hash TEXT, two_factor_enabled BOOLEAN)"
                ),
                "CREATE TABLE scripts (id TEXT PRIMARY KEY)",
                "CREATE TABLE revoked_tokens (jti TEXT PRIMARY KEY)",
            ],
            "partial migration state",
        ),
        (
            [
                (
                    "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, "
                    "email TEXT, password_hash TEXT, two_factor_enabled BOOLEAN, "
                    "totp_secret TEXT, backup_codes TEXT, tokens_valid_after DATETIME, "
                    "pending_totp_secret TEXT, totp_last_step INTEGER)"
                ),
                "CREATE TABLE scripts (id TEXT PRIMARY KEY, name TEXT)",
                "CREATE TABLE revoked_tokens (jti TEXT PRIMARY KEY)",
            ],
            "'scripts' table is missing baseline columns",
        ),
    ],
)
def test_pre_alembic_unrecognised_partial_schema_fails_fast(
    migration_app, ddl_statements, expected_message
):
    from app.cli import initialise_database

    _, _ = migration_app
    with db.engine.begin() as conn:
        for ddl in ddl_statements:
            conn.execute(text(ddl))

    with pytest.raises(RuntimeError, match=expected_message) as exc_info:
        initialise_database(seed=False)

    assert "Alembic migration failed" not in str(exc_info.value)
    assert not inspect(db.engine).has_table("alembic_version")


def test_make_app_pg_teardown_drops_alembic_version():
    from sqlalchemy import create_engine

    import app.config as app_config
    import app.database as app_database
    from app.database import get_scoped_session
    from tests.conftest import app_factory_context

    orig_active_config = app_config.active_config
    orig_engine = app_database._engine
    orig_session_factory = app_database._SessionFactory
    orig_scoped_session = app_database._ScopedSession

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "pg_sim.db").replace("\\", "/")
        db_url = f"sqlite:///{db_path}"

        try:
            for _cycle in range(2):
                with app_factory_context(is_pg_url=db_url) as maker:
                    maker(SQLALCHEMY_DATABASE_URI=db_url)

                    pre_check = create_engine(db_url)
                    try:
                        pre_insp = inspect(pre_check)
                        assert pre_insp.has_table("alembic_version")
                        assert pre_insp.has_table("users")
                    finally:
                        pre_check.dispose()

                post_check = create_engine(db_url)
                try:
                    post_insp = inspect(post_check)
                    assert not post_insp.has_table("alembic_version")
                    assert not post_insp.has_table("users")
                finally:
                    post_check.dispose()
        finally:
            try:
                get_scoped_session().remove()
            except RuntimeError:
                pass
            app_database._engine = orig_engine
            app_database._SessionFactory = orig_session_factory
            app_database._ScopedSession = orig_scoped_session
            app_config.set_active_config(orig_active_config)

