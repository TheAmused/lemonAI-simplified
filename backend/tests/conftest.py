from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile
from typing import Any

import pytest
from sqlalchemy import text
from starlette.testclient import TestClient

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app import create_app
from app.config import Config
from app.database import Base, get_current_engine, get_scoped_session

_PG_URL = os.getenv("TEST_DATABASE_URL")
_DB_URI = (
    _PG_URL.replace("postgresql://", "postgresql+psycopg://", 1) if _PG_URL else "sqlite:///:memory:"
)

ADMIN_PASSWORD = "an-admin-passphrase-for-tests"


class TestConfig(Config):
    TESTING = True
    DEV_MODE = False
    DEMO_ACCOUNTS_ENABLED = False
    SQLALCHEMY_DATABASE_URI = _DB_URI
    SECRET_KEY = "test-flask-secret-key-0123456789-abcdefghij"
    JWT_SECRET_KEY = "test-jwt-secret-key-0123456789-abcdefghij"
    RATELIMIT_ENABLED = False
    ADMIN_USERNAME = "test_admin"
    ADMIN_EMAIL = "admin@lemonai.test"
    ADMIN_PASSWORD = ADMIN_PASSWORD


class CompatibleResponse:
    def __init__(self, raw_resp):
        self._raw = raw_resp

    def __getattr__(self, name: str) -> Any:
        return getattr(self._raw, name)

    def get_json(self) -> Any:
        try:
            return self._raw.json()
        except Exception:
            return None

    def get_data(self, as_text: bool = False) -> str | bytes:
        if as_text:
            return self._raw.text
        return self._raw.content


def create_test_client(
    app: Any, *, compatible: bool = False
) -> TestClient | "CompatibleTestClient":
    """Create a Starlette TestClient (or CompatibleTestClient) with shared test defaults."""
    tc = TestClient(
        app,
        base_url="http://127.0.0.1:5000",
        raise_server_exceptions=False,
    )
    if compatible:
        return CompatibleTestClient(tc)
    return tc


class CompatibleTestClient:
    def __init__(self, client_or_app: Any):
        if isinstance(client_or_app, TestClient):
            self._client = client_or_app
        else:
            self._client = create_test_client(client_or_app)

    def __enter__(self) -> "CompatibleTestClient":
        self._client.__enter__()
        return self

    def __exit__(self, *args) -> None:
        self._client.__exit__(*args)

    def close(self) -> None:
        self._client.close()

    def get(self, url: str, **kwargs) -> CompatibleResponse:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> CompatibleResponse:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs) -> CompatibleResponse:
        return self.request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs) -> CompatibleResponse:
        return self.request("DELETE", url, **kwargs)

    def request(self, method: str, url: str, **kwargs) -> CompatibleResponse:
        kwargs.pop("content_type", None)
        environ_base = kwargs.pop("environ_base", {})
        if "REMOTE_ADDR" in environ_base:
            headers = kwargs.setdefault("headers", {})
            headers["X-Test-Remote-Addr"] = environ_base["REMOTE_ADDR"]

        data = kwargs.get("data")
        files = kwargs.get("files", {})

        if isinstance(data, dict):
            form_fields = {}
            for k, v in data.items():
                if isinstance(v, tuple):
                    if len(v) == 2 and isinstance(v[0], (io.IOBase, bytes)) and isinstance(v[1], str):
                        files[k] = (v[1], v[0])
                    else:
                        files[k] = v
                else:
                    form_fields[k] = v
            kwargs["data"] = form_fields
            if files:
                kwargs["files"] = files

        resp = self._client.request(method, url, **kwargs)
        return CompatibleResponse(resp)


_SENTINEL = object()


def teardown_test_engines(engines: list[Any], is_pg_url: Any) -> None:
    """Dispose tracked test engines and, for PostgreSQL runs, drop all tables including alembic_version."""
    try:
        get_scoped_session().remove()
    except RuntimeError:
        pass

    first_error: BaseException | None = None
    for eng in engines:
        try:
            if is_pg_url:
                Base.metadata.drop_all(bind=eng)
                with eng.begin() as conn:
                    conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        except BaseException as exc:
            if first_error is None:
                first_error = exc
        finally:
            try:
                eng.dispose()
            except BaseException as exc:
                if first_error is None:
                    first_error = exc
    if first_error is not None:
        raise first_error


@contextlib.contextmanager
def app_factory_context(is_pg_url: Any = _SENTINEL):
    """Context-managed factory for apps with isolated upload dirs and failure-safe engine teardown."""
    dirs: list[tempfile.TemporaryDirectory] = []
    engines: list[Any] = []

    def _make(**overrides):
        tmp = tempfile.TemporaryDirectory()
        dirs.append(tmp)
        attrs = {"UPLOAD_FOLDER": tmp.name, **overrides}
        config = type("CustomConfig", (TestConfig,), attrs)
        prev_engine = None
        try:
            prev_engine = get_current_engine()
        except RuntimeError:
            pass
        try:
            application = create_app(config_class=config)
        finally:
            try:
                eng = get_current_engine()
            except RuntimeError:
                eng = None
            if eng is not None and eng is not prev_engine and all(e is not eng for e in engines):
                engines.append(eng)
        return application

    try:
        yield _make
    finally:
        pg_flag = _PG_URL if is_pg_url is _SENTINEL else is_pg_url
        try:
            teardown_test_engines(engines, pg_flag)
        finally:
            for tmp in dirs:
                try:
                    tmp.cleanup()
                except OSError:
                    pass


@pytest.fixture
def make_app():
    """Factory for apps with their own upload directory; cleaned up after the test."""
    with app_factory_context() as _make:
        yield _make


@pytest.fixture
def app(make_app):
    application = make_app()
    yield application


@pytest.fixture
def client(app):
    with CompatibleTestClient(app) as c:
        yield c
