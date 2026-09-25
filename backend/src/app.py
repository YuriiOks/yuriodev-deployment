"""Application factory: assembles settings, logging, middleware, error handlers and routes."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import Settings, get_settings
from src.core.errors import install_exception_handlers
from src.core.logging import configure_logging
from src.core.middleware import RequestContextMiddleware
from src.routes import health

logger = logging.getLogger("yuriodev.app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = cast(Settings, app.state.settings)
    logger.info(
        "app started",
        extra={
            "event": "app.start",
            "environment": settings.environment,
            "revision": settings.revision,
        },
    )
    yield
    logger.info("app stopped", extra={"event": "app.stop"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)

    docs = settings.api_docs_enabled
    app = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        # Under /api/ because the proxy only forwards /api/ to the backend.
        openapi_url="/api/openapi.json" if docs else None,
        docs_url="/api/docs" if docs else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "HEAD", "OPTIONS"],
            allow_headers=[],  # the CORS-safelisted request headers are always allowed
        )
    # Added last, so it wraps everything else: CORS preflights get an id and a log line too.
    app.add_middleware(RequestContextMiddleware)

    install_exception_handlers(app)
    app.include_router(health.router)
    return app
