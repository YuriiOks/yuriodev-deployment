"""Application factory: assembles settings, logging, middleware, error handlers and routes."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse

from src.core.config import Settings, get_settings
from src.core.errors import install_exception_handlers
from src.core.logging import configure_logging
from src.core.middleware import RequestContextMiddleware
from src.routes import health

logger = logging.getLogger("yuriodev.app")

OPENAPI_URL = "/api/openapi.json"
DOCS_URL = "/api/docs"
# An exact swagger-ui-dist release, not FastAPI's floating `@5`: the docs page runs this
# third-party script on the origin it is served from.
SWAGGER_UI_DIST = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0"


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
        openapi_url=OPENAPI_URL if docs else None,
        docs_url=None,  # served below, with pinned assets
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
    if docs:
        _add_docs_route(app, settings.api_title)
    return app


def _add_docs_route(app: FastAPI, title: str) -> None:
    async def swagger_ui() -> HTMLResponse:
        return get_swagger_ui_html(
            openapi_url=OPENAPI_URL,
            title=f"{title} - Swagger UI",
            swagger_js_url=f"{SWAGGER_UI_DIST}/swagger-ui-bundle.js",
            swagger_css_url=f"{SWAGGER_UI_DIST}/swagger-ui.css",
            swagger_favicon_url=f"{SWAGGER_UI_DIST}/favicon-32x32.png",
        )

    app.add_api_route(DOCS_URL, swagger_ui, methods=["GET"], include_in_schema=False)
