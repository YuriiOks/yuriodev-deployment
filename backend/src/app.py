"""Application factory: assembles settings, logging, middleware, error handlers and routes."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.routing import Route

from src.core.clock import Clock, utc_now
from src.core.config import Settings, get_settings
from src.core.errors import install_exception_handlers
from src.core.http import resolve_host
from src.core.logging import configure_logging
from src.core.middleware import RequestContextMiddleware
from src.dashboards.assistant.service import Assistant
from src.dashboards.collectors.manager import (
    FINANCE_LOCK_KEY,
    CollectorManager,
    build_collectors,
    build_finance_collectors,
)
from src.dashboards.finance.icons import IconWorker
from src.dashboards.finance.maintenance import (
    PAIRING_PROVIDERS,
    pair_own_transfers,
    recompute_categories,
)
from src.dashboards.gate import MCP_PATH, DashboardsGate
from src.dashboards.mcp_server import McpEndpoint, build_mcp_server
from src.dashboards.projects import upgrade_projects
from src.dashboards.runtime import DashboardsRuntime
from src.feed.service import FeedService
from src.routes import (
    assistant,
    dashboards,
    finance,
    finance_manual,
    finance_recurring,
    health,
    posts,
    projects,
)

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

        tasks: list[asyncio.Task[None]] = []
        if feed.polls:
            tasks.append(asyncio.create_task(feed.run_forever(), name="feed-refresh"))
        tasks.extend(await _start_dashboards(app, settings, stack))
        for task in tasks:
            task.add_done_callback(_log_task_exit)
        logger.info(
            "app started",
            extra={
                "event": "app.start",
                "environment": settings.environment,
                "revision": settings.revision,
                "ref": settings.build_ref,
                "feed": feed.describe(),
            },
        )
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task  # a task that died was already logged by _log_task_exit
            logger.info("app stopped", extra={"event": "app.stop"})


async def after_migrate(sessions: async_sessionmaker[AsyncSession]) -> None:
    """What runs once the schema is at head: the projects' schemas, the categories still missing."""
    await upgrade_projects(sessions)
    await recompute_categories(sessions)
    for provider in PAIRING_PROVIDERS:
        await pair_own_transfers(sessions, provider)


async def _start_dashboards(
    app: FastAPI, settings: Settings, stack: contextlib.AsyncExitStack
) -> list[asyncio.Task[None]]:
    """Set up the dashboards database seam when DATABASE_URL is set: the engine, the MCP session
    manager and a background task that migrates the schema. Never waits on the database.

    A URL the driver rejects is logged once (the class only: a message could hold the password)
    and leaves the API answering 503 `dashboards_unavailable`."""
    app.state.dashboards = None
    app.state.collectors = None
    app.state.finance_collectors = None
    app.state.finance_http = None
    if settings.database_url is None:
        return []
    try:
        url = settings.database_url.get_secret_value()
        runtime = DashboardsRuntime(url, after_migrate=after_migrate)
    except Exception as exc:
        extra = {"event": "dashboards.misconfigured", "error": type(exc).__name__}
        logger.error("dashboards database url rejected", extra=extra)
        return []
    stack.push_async_callback(runtime.close)
    app.state.dashboards = runtime
    # The SDK's session manager must run for the app's whole life; its tasks end with the stack.
    await stack.enter_async_context(app.state.mcp.session_manager.run())
    tasks = [asyncio.create_task(runtime.migrate_until_ready(), name="dashboards-migrate")]
    if app.state.icon_autostart:
        tasks.append(asyncio.create_task(app.state.icons.run_forever(), name="dashboards-icons"))
    if settings.collectors_enabled or settings.finance_enabled:
        from src.core.http import build_http_client  # httpx is only imported when collecting

        # `collector_transport` is a test seam (httpx.MockTransport); None means the network.
        transport = app.state.collector_transport
        client = await stack.enter_async_context(build_http_client(settings, transport))
        if settings.collectors_enabled:
            interval = settings.dashboards_collect_interval_seconds
            collectors = build_collectors(settings, app.state.zone)
            manager = CollectorManager(
                runtime, collectors, client, app.state.clock, interval=interval
            )
            app.state.collectors = manager
            tasks.append(asyncio.create_task(manager.run_forever(), name="dashboards-collectors"))
        if settings.finance_enabled:
            # Its own loop, interval and lock: bank limits are per minute, tasks are per 5.
            finance = CollectorManager(
                runtime,
                build_finance_collectors(
                    settings, runtime.sessions, app.state.clock, app.state.finance_sleep
                ),
                client,
                app.state.clock,
                interval=settings.finance_poll_interval_seconds,
                lock_key=FINANCE_LOCK_KEY,
            )
            app.state.finance_collectors = finance
            app.state.finance_http = client  # the Monzo consent routes call out with it
            tasks.append(asyncio.create_task(finance.run_forever(), name="finance-collectors"))
    return tasks


def _log_task_exit(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error(
            "background task died",
            exc_info=task.exception(),
            extra={"event": "task.died", "task": task.get_name()},
        )


def create_app(settings: Settings | None = None, *, clock: Clock | None = None) -> FastAPI:
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
    app.state.clock = clock or utc_now
    app.state.zone = ZoneInfo(settings.dashboards_timezone)
    app.state.dashboards = None  # the database seam, set by the lifespan
    app.state.mcp = None
    app.state.collectors = None  # the collector loop, set by the lifespan
    app.state.finance_collectors = None  # the finance loop, set by the lifespan
    app.state.finance_http = None  # its HTTP client, for the consent routes
    app.state.collector_transport = None
    # The one task that fetches payment icons, with its test seams (a fake transport, a fake
    # resolver, no autostart: the tests drain it by hand).
    app.state.icon_transport = None
    app.state.icon_resolver = resolve_host
    app.state.icon_autostart = True
    # The assistant (off without ANTHROPIC_API_KEY); `assistant_transport` is the test seam.
    app.state.assistant_transport = None
    app.state.assistant = Assistant(
        settings,
        lambda: app.state.dashboards,
        app.state.clock,
        app.state.zone,
        lambda: app.state.assistant_transport,
    )
    app.state.icons = IconWorker(
        settings,
        lambda: app.state.dashboards.sessions,
        lambda: app.state.icon_transport,
        lambda: app.state.icon_resolver,
        app.state.clock,
    )
    app.state.finance_sleep = asyncio.sleep  # a test seam: the pauses between provider requests

    # Added first, so innermost: a CORS preflight is answered before it, and its own 401/503
    # still get a request id and an access line from RequestContextMiddleware.
    app.add_middleware(DashboardsGate, settings=settings)
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
    app.include_router(dashboards.router)
    app.include_router(projects.router)
    app.include_router(finance.router)
    app.include_router(finance_recurring.router)
    app.include_router(finance_manual.router)
    app.include_router(assistant.router)
    if settings.dashboards_enabled:
        _add_mcp(app)
    if docs:
        _add_docs_route(app, settings.api_title)
    return app


def _add_mcp(app: FastAPI) -> None:
    """POST /api/mcp (only when the API is on; the gate answers 503 for it otherwise)."""

    def runtime() -> DashboardsRuntime | None:
        return cast(DashboardsRuntime | None, app.state.dashboards)

    currency = app.state.settings.finance_display_currency
    owner = app.state.settings.owner_name
    server = build_mcp_server(runtime, app.state.clock, app.state.zone, currency, owner)
    app.state.mcp = server
    endpoint = McpEndpoint(server.session_manager, runtime)
    app.router.routes.append(Route(MCP_PATH, endpoint, methods=["POST"]))


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
