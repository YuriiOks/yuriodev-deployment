"""Application factory: assembles settings, logging, middleware, error handlers and routes."""

import asyncio
import contextlib
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
from src.feed.service import FeedService
from src.routes import health, posts

logger = logging.getLogger("yuriodev.app")

OPENAPI_URL = "/api/openapi.json"
DOCS_URL = "/api/docs"
# An exact swagger-ui-dist release, not FastAPI's floating `@5`: the docs page runs this
# third-party script on the origin it is served from.
SWAGGER_UI_DIST = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup never waits on the network: the feed poller runs as a background task, so
    /health answers at once whatever the upstream does."""
    settings = cast(Settings, app.state.settings)
    async with contextlib.AsyncExitStack() as stack:
        http = None
        if settings.social_feed_enabled and settings.social_feed_provider == "typefully":
            from src.core.http import build_http_client  # httpx is only imported when polling

            http = await stack.enter_async_context(build_http_client(settings))
        app.state.http = http

        feed = FeedService.from_settings(settings, http)
        feed.load_snapshot()
        if feed.is_static:
            try:
                await feed.refresh_once()  # bundled fixture: local disk, milliseconds
            except Exception:
                logger.exception("feed fixture failed to load", extra={"event": "feed.crash"})
        app.state.feed = feed

        task: asyncio.Task[None] | None = None
        if feed.polls:
            task = asyncio.create_task(feed.run_forever(), name="feed-refresh")
            task.add_done_callback(_log_task_exit)
        logger.info(
            "app started",
            extra={
                "event": "app.start",
                "environment": settings.environment,
                "revision": settings.revision,
                "feed": feed.describe(),
            },
        )
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task  # a task that died was already logged by _log_task_exit
            logger.info("app stopped", extra={"event": "app.stop"})


def _log_task_exit(task: "asyncio.Task[None]") -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error(
            "background task died",
            exc_info=task.exception(),
            extra={"event": "task.died", "task": task.get_name()},
        )


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
    app.include_router(posts.router)
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
