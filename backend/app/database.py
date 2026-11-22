from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, scoped_session, sessionmaker
from sqlalchemy.pool import StaticPool

_INIT_LOCK_KEY = 0x4C454D4F4E41


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None
_ScopedSession: scoped_session[Session] | None = None


def init_db_engine(uri: str) -> tuple[Engine, sessionmaker[Session]]:
    global _engine, _SessionFactory, _ScopedSession
    connect_args: dict[str, Any] = {}
    engine_kwargs: dict[str, Any] = {"future": True}

    if uri.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if ":memory:" in uri or uri in ("sqlite://", "sqlite:///"):
            engine_kwargs["poolclass"] = StaticPool
    else:
        engine_kwargs["pool_pre_ping"] = True
        engine_kwargs["pool_recycle"] = 1800

    engine_kwargs["connect_args"] = connect_args

    _engine = create_engine(uri, **engine_kwargs)
    if uri.startswith("sqlite"):
        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=5000")
            finally:
                cursor.close()

    try:
        from app.models import reset_revoked_prune_timer
        reset_revoked_prune_timer()
    except Exception:
        pass

    _SessionFactory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    _ScopedSession = scoped_session(_SessionFactory)
    return _engine, _SessionFactory


def get_current_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database engine has not been initialized. Call init_db_engine() first.")
    return _engine


def get_current_session_factory() -> sessionmaker[Session]:
    if _SessionFactory is None:
        raise RuntimeError("Database session factory has not been initialized. Call init_db_engine() first.")
    return _SessionFactory


def get_scoped_session() -> scoped_session[Session]:
    if _ScopedSession is None:
        raise RuntimeError("Database session factory has not been initialized. Call init_db_engine() first.")
    return _ScopedSession


def get_db() -> Iterator[Session]:
    """FastAPI dependency — yields one fresh Session per HTTP request.

    FastAPI caches this dependency for the lifetime of one request, so the
    auth dependency and the endpoint handler always share the same Session
    object regardless of which threadpool slot handles each call.
    scoped_session is intentionally NOT used here: it keys on thread identity
    and FastAPI does not guarantee the same thread across dependency calls.
    """
    factory = get_current_session_factory()
    session: Session = factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def db_session() -> Iterator[Session]:
    """Context manager for background tasks, CLI commands, and seeds."""
    session = get_scoped_session()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        if _ScopedSession is not None:
            _ScopedSession.remove()


@contextmanager
def init_lock(engine: Engine) -> Iterator[None]:
    """Serialises initialisation across processes/replicas (PostgreSQL advisory lock)."""
    if engine.dialect.name != "postgresql":
        yield
        return
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _INIT_LOCK_KEY})
        try:
            yield
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _INIT_LOCK_KEY})
            conn.commit()


class _DbProxy:
    @property
    def session(self) -> scoped_session[Session]:
        return get_scoped_session()

    @property
    def engine(self) -> Engine:
        return get_current_engine()

    @property
    def metadata(self):
        return Base.metadata

    def create_all(self, bind=None):
        Base.metadata.create_all(bind=bind or get_current_engine())

    def drop_all(self, bind=None):
        Base.metadata.drop_all(bind=bind or get_current_engine())


db = _DbProxy()
