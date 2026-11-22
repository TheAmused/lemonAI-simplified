import logging
import os
from typing import Type

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cli import initialise_database
from app.config import Config, validate_secrets
from app.database import init_db_engine
from app.routes.admin import admin_router
from app.routes.auth import auth_router
from app.routes.notifications import notifications_router
from app.routes.releases import releases_router
from app.routes.scripts import scripts_router

logger = logging.getLogger("lemonai.hub")


class _PayloadTooLarge(BaseException):
    """Internal signal raised when a streaming request exceeds MAX_CONTENT_LENGTH."""


class MaxBodySizeMiddleware:
    """Pure ASGI middleware enforcing MAX_CONTENT_LENGTH before body parsing or auth."""

    def __init__(self, app, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or self.max_bytes <= 0:
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                raw = value.strip()
                content_length = int(raw) if raw.isdigit() else None
                if content_length is not None and content_length > self.max_bytes:
                    await self._send_413(scope, receive, send)
                    return

        bytes_received = 0
        response_started = False

        async def limited_receive():
            nonlocal bytes_received
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                if body:
                    bytes_received += len(body)
                    if bytes_received > self.max_bytes:
                        raise _PayloadTooLarge()
            return message

        async def wrapped_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, wrapped_send)
        except* _PayloadTooLarge:
            if response_started:
                raise RuntimeError(
                    "Request body exceeded MAX_CONTENT_LENGTH after response started"
                ) from None
            await self._send_413(scope, receive, send)

    @staticmethod
    async def _send_413(scope, receive, send) -> None:
        response = JSONResponse(
            status_code=413,
            content={"error": "Request body too large"},
        )
        await response(scope, receive, send)


def create_app(
    config_class: Type[Config] = Config,
    auto_seed: bool = True,
    init_db: bool = True,
) -> FastAPI:
    """Application factory for LemonAI Model Hub."""
    config = config_class() if isinstance(config_class, type) else config_class
    validate_secrets(config)
    from app.config import set_active_config
    set_active_config(config)

    engine, _ = init_db_engine(config.SQLALCHEMY_DATABASE_URI)

    is_dev = bool(getattr(config, "DEV_MODE", False))
    app = FastAPI(
        title="LemonAI Model Hub API",
        version="2.0.0",
        docs_url="/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/openapi.json" if is_dev else None,
    )

    app.state.config = config
    app.state.upload_folder = config.UPLOAD_FOLDER
    app.state.schema_dir = config.SCHEMA_DIR

    from contextlib import contextmanager

    @contextmanager
    def _app_context():
        yield app

    app.app_context = _app_context
    app.config = {
        k: getattr(config, k)
        for k in dir(config)
        if not k.startswith("_")
    }

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        msg = errors[0].get("msg") if errors else "Validation error"
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": msg, "details": errors},
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.exception("unhandled error")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Internal server error"},
        )

    max_content_length = int(getattr(config, "MAX_CONTENT_LENGTH", 0) or 0)
    if max_content_length > 0:
        app.add_middleware(MaxBodySizeMiddleware, max_bytes=max_content_length)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    os.makedirs(os.path.join(config.UPLOAD_FOLDER, "images"), exist_ok=True)

    app.include_router(auth_router)
    app.include_router(scripts_router)
    app.include_router(admin_router)
    app.include_router(notifications_router)
    app.include_router(releases_router)

    if init_db:
        admin_cfg = (
            getattr(config, "ADMIN_USERNAME", None),
            getattr(config, "ADMIN_EMAIL", None),
            getattr(config, "ADMIN_PASSWORD", None),
        )
        initialise_database(
            engine=engine,
            seed=auto_seed,
            upload_folder=config.UPLOAD_FOLDER,
            schema_dir_cfg=config.SCHEMA_DIR,
            admin_config=admin_cfg,
        )

    return app
