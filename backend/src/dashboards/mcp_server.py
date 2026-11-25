"""The MCP endpoint of the dashboards API: fifteen tools over POST /api/mcp (streamable HTTP).

Built on the official SDK's `MCPServer`, run stateless with plain JSON answers: every POST is
one self-contained request, there is no session to lose on a restart, and nothing holds a stream
open (GET is not served). The SDK's session manager is started by the app lifespan
(`server.session_manager.run()`); `McpEndpoint` hands requests to it. Authentication is the
gate's job (`src/dashboards/gate.py`); the SDK's own Host-header check is off because the Host
differs per environment and the gate already refuses unauthenticated callers.

Tools return compact JSON text. Failures are `ToolError`s with a fixed sentence: the SDK logs a
tool error's message, and nothing a client sent (titles, notes) may reach the log, so no message
carries input. An unexpected exception is logged by class name only.
"""

import contextlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

from src.core.clock import Clock
from src.core.errors import AppError, error_response
from src.dashboards import projects as project_service
from src.dashboards import service, streak
from src.dashboards import today as page_today
from src.dashboards.catalog import SPACE_IDS, TaskStatus, TaskStatusFilter
from src.dashboards.finance import mcp as finance_mcp
from src.dashboards.runtime import DashboardsRuntime, session_scope, unavailable
from src.dashboards.schemas import (
    EventCreate,
    EventOut,
    ProjectCreate,
    ProjectTaskOut,
    TaskCreate,
    TaskOut,
    TaskPatch,
)

logger = logging.getLogger("yuriodev.dashboards")

INVALID_ARGUMENTS = (
    "Invalid arguments: titles are 1 to 300 characters, dates are YYYY-MM-DD and times are "
    "ISO 8601 with a UTC offset"
)
INSTRUCTIONS = (
    "Tasks and calendar events in three spaces: personal, work-1 and work-2. A task belongs to "
    "exactly one space; every tool that lists or adds tasks takes the space. Dates are "
    "YYYY-MM-DD, times are ISO 8601 with a UTC offset. Personal tasks may carry an area slug "
    "(money, work-income, court-paperwork, health-sport, romantic, friends, family, travel, "
    "home, hobbies-growth)." + finance_mcp.INSTRUCTIONS
)

type RuntimeGetter = Callable[[], DashboardsRuntime | None]


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _task(task: object) -> dict[str, Any]:
    return TaskOut.model_validate(task).model_dump(mode="json")


def _space_or_project(error: AppError) -> AppError:
    """A `space` argument that is no space is read as a project id: say so when it is neither."""
    if error.status == 404 and error.message == "Project not found":
        return AppError(404, "not_found", "Space or project not found")
    return error


def _ptask(task: ProjectTaskOut) -> dict[str, Any]:
    return task.model_dump(mode="json")


def _event(event: object) -> dict[str, Any]:
    return EventOut.model_validate(event).model_dump(mode="json")


def _validated[M: BaseModel](model: type[M], fields: dict[str, Any]) -> M:
    try:
        return model.model_validate(fields)
    except ValidationError:
        raise ToolError(INVALID_ARGUMENTS) from None


def build_mcp_server(
    get_runtime: RuntimeGetter,
    clock: Clock,
    zone: ZoneInfo,
    display_currency: str = "GBP",
    owner_name: str | None = None,
) -> MCPServer[Any]:
    """The server with its fifteen tools, and its streamable-HTTP session manager created
    (stateless, JSON answers). `get_runtime` is read per call: the runtime only exists once the
    app runs."""
    server: MCPServer[Any] = MCPServer("yuriodev-dashboards", instructions=INSTRUCTIONS)

    async def _change(
        session: AsyncSession, project: str | None, task_id: str, patch: TaskPatch, now: datetime
    ) -> str:
        if project is not None:
            update = project_service.update_project_task
            return _json(_ptask(await update(session, project, task_id, patch, now)))
        task = await service.update_task(session, task_id, patch, now)
        out = _json(_task(task))
        if patch.status == "done":  # a completed task may have emptied the page's queue
            with contextlib.suppress(AppError):
                await streak.note(session, task.space_id, now, zone)
        return out

    @asynccontextmanager
    async def scope(tool: str) -> AsyncIterator[tuple[AsyncSession, datetime]]:
        """A session and the current time, with every failure turned into a ToolError."""
        try:
            async with session_scope(get_runtime()) as session:
                yield session, clock()
        except AppError as exc:
            raise ToolError(exc.message) from None
        except ToolError:
            raise
        except Exception as exc:
            extra = {"event": "dashboards.tool_error", "tool": tool, "error": type(exc).__name__}
            logger.error("dashboards tool failed", extra=extra)
            raise ToolError("Internal error") from None

    @server.tool(structured_output=False)
    async def list_tasks(space: str, status: TaskStatusFilter = "open") -> str:
        """List the tasks of one space (personal, work-1 or work-2) or of a project (pass its id
        as space). status is open (default), done or all. Open tasks come first: priority, then
        due date, then oldest."""
        async with scope("list_tasks") as (session, _):
            if space not in SPACE_IDS:
                try:
                    found = await project_service.list_project_tasks(session, space, status)
                except AppError as exc:
                    raise _space_or_project(exc) from None
                return _json({"project": space, "tasks": [_ptask(t) for t in found]})
            tasks = await service.list_tasks(session, space, status)
            return _json({"space": space, "tasks": [_task(t) for t in tasks]})

    @server.tool(structured_output=False)
    async def add_task(
        space: str,
        title: str,
        notes: str | None = None,
        area: str | None = None,
        priority: bool = False,
        due_date: str | None = None,
    ) -> str:
        """Add an open task to a space, or to a project (pass its id as space; projects have no
        areas). area is a life-area slug (personal space only); due_date is YYYY-MM-DD."""
        fields = {
            "title": title,
            "notes": notes,
            "area_id": area,
            "priority": priority,
            "due_date": due_date,
        }
        data = _validated(TaskCreate, fields)
        async with scope("add_task") as (session, now):
            if space not in SPACE_IDS:
                create = project_service.create_project_task
                try:
                    made = await create(session, space, data, "mcp", now)
                except AppError as exc:
                    raise _space_or_project(exc) from None
                return _json(_ptask(made))
            task = await service.create_task(session, space, data, "mcp", now)
            return _json(_task(task))

    @server.tool(structured_output=False)
    async def update_task(
        id: str,
        title: str | None = None,
        notes: str | None = None,
        area: str | None = None,
        priority: bool | None = None,
        due_date: str | None = None,
        status: TaskStatus | None = None,
        project: str | None = None,
    ) -> str:
        """Change a task. Only the arguments you pass change; an empty string clears notes,
        area or due_date. status is open or done. For a task of a project pass project (its id):
        a task id alone does not say which project it is in."""
        passed: dict[str, Any] = {}
        if title is not None:
            passed["title"] = title
        if notes is not None:
            passed["notes"] = notes or None
        if area is not None:
            passed["area_id"] = area or None
        if priority is not None:
            passed["priority"] = priority
        if due_date is not None:
            passed["due_date"] = due_date or None
        if status is not None:
            passed["status"] = status
        patch = _validated(TaskPatch, passed)
        async with scope("update_task") as (session, now):
            return await _change(session, project, id, patch, now)

    @server.tool(structured_output=False)
    async def complete_task(id: str, project: str | None = None) -> str:
        """Mark a task done (sets done_at). Pass project (its id) for a task of a project."""
        async with scope("complete_task") as (session, now):
            return await _change(session, project, id, TaskPatch(status="done"), now)

    @server.tool(structured_output=False)
    async def reopen_task(id: str, project: str | None = None) -> str:
        """Mark a done task open again (clears done_at). Pass project (its id) for a project's."""
        async with scope("reopen_task") as (session, now):
            return await _change(session, project, id, TaskPatch(status="open"), now)

    @server.tool(structured_output=False)
    async def delete_task(id: str, project: str | None = None) -> str:
        """Delete a task for good. Pass project (its id) for a task of a project."""
        async with scope("delete_task") as (session, _):
            if project is not None:
                await project_service.delete_project_task(session, project, id)
            else:
                await service.delete_task(session, id)
            return _json({"deleted": id})

    @server.tool(structured_output=False)
    async def today(space: str | None = None, scope_name: str | None = None) -> str:
        """What needs attention now: open priority tasks plus open tasks due today or overdue,
        and today's events (day in the configured time zone). One space, or all three, each
        listed separately. A project's id as space gives that project's tasks (no events).
        With `scope_name` (personal, work-1, work-2 or money) instead: the page's whole Today
        view as data (headline facts, the queue of up to three decisions, what is coming soon,
        two stats, a breakdown with an insight, today's rows)."""
        async with scope("today") as (session, now):
            if scope_name is not None:
                page = await page_today.build(
                    session, scope_name, now, zone, display_currency, owner_name=owner_name
                )
                return _json(page.model_dump(mode="json"))
            if space is not None and space not in SPACE_IDS:
                day = now.astimezone(zone).date()
                try:
                    due = await project_service.due_project_tasks(session, space, day)
                except AppError as exc:
                    raise _space_or_project(exc) from None
                group = {"space": space, "tasks": [_ptask(t) for t in due], "events": []}
                return _json({"date": day.isoformat(), "spaces": [group]})
            view = await service.today(session, space, now, zone)
            return _json(view.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def list_projects() -> str:
        """List the projects (user-created dashboards beside the three spaces), archived ones
        flagged, with the counts of their open tasks."""
        async with scope("list_projects") as (session, now):
            found = await project_service.list_projects(session, now.astimezone(zone).date())
            return _json({"projects": [p.model_dump(mode="json") for p in found]})

    @server.tool(structured_output=False)
    async def add_project(name: str, icon: str | None = None) -> str:
        """Create a project (1 to 40 characters). Its id is made from the name; use it as the
        space argument of the task tools. icon is an optional key of a drawing the page knows
        (lower-case letters, digits and hyphens, at most 24 characters). Fails when a project
        with that id exists."""
        data = _validated(ProjectCreate, {"name": name, "icon": icon})
        async with scope("add_project") as (session, now):
            made = await project_service.create_project(session, data.name, now, data.icon)
            return _json(made.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def list_events(from_date: date, to_date: date) -> str:
        """List the calendar events of all spaces that intersect the date range (YYYY-MM-DD,
        both days included, at most 62 days)."""
        async with scope("list_events") as (session, _):
            events = await service.list_events(session, from_date, to_date, zone)
            return _json({"events": [_event(e) for e in events]})

    @server.tool(structured_output=False)
    async def add_event(
        space: str, title: str, starts_at: str, ends_at: str, busy_only: bool = False
    ) -> str:
        """Add a calendar event to a space. starts_at and ends_at are ISO 8601 with a UTC
        offset (for example 2026-11-23T09:00:00+00:00); ends_at must be after starts_at.
        busy_only shows it in the other spaces as Focus time, without details."""
        fields = {
            "title": title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "busy_only": busy_only,
        }
        data = _validated(EventCreate, fields)
        async with scope("add_event") as (session, now):
            event = await service.create_event(session, space, data, "mcp", now)
            return _json(_event(event))

    @server.tool(structured_output=False)
    async def delete_event(id: str) -> str:
        """Delete a calendar event for good."""
        async with scope("delete_event") as (session, _):
            await service.delete_event(session, id)
            return _json({"deleted": id})

    finance_mcp.register(server, scope, zone, display_currency)

    # The SDK builds its session manager together with the Starlette app. Only the manager is
    # used (`McpEndpoint`), so the app itself is dropped.
    server.streamable_http_app(
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    return server


class McpEndpoint:
    """ASGI endpoint of POST /api/mcp: the session manager, once the database is ready."""

    def __init__(self, manager: StreamableHTTPSessionManager, get_runtime: RuntimeGetter) -> None:
        self._manager = manager
        self._get_runtime = get_runtime

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        runtime = self._get_runtime()
        if runtime is None or not runtime.ready.is_set():
            exc = unavailable()
            response = error_response(exc.status, exc.code, exc.message)
            await response(scope, receive, send)
            return
        await self._manager.handle_request(scope, receive, send)
