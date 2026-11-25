"""REST routes of the dashboards data API, under /api/dashboards/v1.

By the time a handler runs the gate (`src/dashboards/gate.py`) has switched the API off when
there is no database, authenticated the caller and set `Cache-Control: no-store`. Unknown spaces
and ids are 404, bad input is 422 (both in the app's error shape), a database that is not ready
or not reachable is 503.
"""

import contextlib
from collections.abc import AsyncIterator
from datetime import date
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.clock import Clock
from src.core.config import Settings
from src.core.errors import AppError
from src.dashboards import projects as project_service
from src.dashboards import service, streak, today
from src.dashboards.catalog import DEFAULT_SPACE_NAMES, TaskStatusFilter
from src.dashboards.runtime import get_runtime, session_scope
from src.dashboards.schemas import (
    AreaOut,
    BootstrapOut,
    EventCreate,
    EventOut,
    EventPatch,
    EventsOut,
    SpaceRef,
    SummaryOut,
    TaskCreate,
    TaskOut,
    TaskPatch,
    TasksOut,
)
from src.deps import get_clock, get_settings_dep, get_zone

router = APIRouter(prefix="/api/dashboards/v1", tags=["dashboards"])


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """A session on the migrated database, or 503 `dashboards_unavailable`."""
    async with session_scope(get_runtime(request)) as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
ZoneDep = Annotated[ZoneInfo, Depends(get_zone)]


@router.get("/bootstrap")
async def bootstrap(request: Request, settings: SettingsDep, clock: ClockDep) -> BootstrapOut:
    """What the page needs first: is the API on, the spaces and the life areas. Answers
    `enabled: false` (no authentication needed) when there is no database."""
    now = clock()
    if not settings.dashboards_enabled:
        return BootstrapOut(enabled=False, spaces=[], projects=[], areas=[], server_time=now)
    async with session_scope(get_runtime(request)) as session:
        spaces = await service.list_spaces(session)
        areas = await service.list_areas(session)
        projects = await project_service.active_projects(session)
    names = {**DEFAULT_SPACE_NAMES, **settings.space_names}
    icons = settings.space_icons
    return BootstrapOut(
        enabled=True,
        projects=projects,
        spaces=[SpaceRef(id=s, name=names.get(s, s), icon=icons.get(s)) for s in spaces],
        areas=[AreaOut.model_validate(area) for area in areas],
        server_time=now,
    )


@router.get("/today")
async def today_page(
    session: SessionDep,
    clock: ClockDep,
    zone: ZoneDep,
    settings: SettingsDep,
    scope: Annotated[today.Scope, Query()],
) -> today.TodayPageOut:
    """Everything the Today view of one page shows (`personal`, `work-1`, `work-2` or `money`) as
    data and codes: a headline's facts, a queue of at most three decisions, what is coming, two
    stats, one breakdown with an insight, today's rows. See `src/dashboards/today.py`."""
    return await today.build(
        session,
        scope,
        clock(),
        zone,
        settings.finance_display_currency,
        assistant_enabled=settings.assistant_enabled(scope),
    )


@router.get("/summary")
async def summary(session: SessionDep, clock: ClockDep, zone: ZoneDep) -> SummaryOut:
    return SummaryOut(spaces=await service.summary(session, clock(), zone))


@router.get("/spaces/{space}/tasks")
async def list_tasks(
    space: str, session: SessionDep, status: Annotated[TaskStatusFilter, Query()] = "open"
) -> TasksOut:
    tasks = await service.list_tasks(session, space, status)
    return TasksOut(tasks=[TaskOut.model_validate(task) for task in tasks])


@router.post("/spaces/{space}/tasks", status_code=201)
async def create_task(
    space: str, body: TaskCreate, session: SessionDep, clock: ClockDep
) -> TaskOut:
    task = await service.create_task(session, space, body, "web", clock())
    return TaskOut.model_validate(task)


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str, body: TaskPatch, session: SessionDep, clock: ClockDep, zone: ZoneDep
) -> TaskOut:
    task = await service.update_task(session, task_id, body, clock())
    out = TaskOut.model_validate(task)
    if body.status == "done":  # a completed task may have emptied the page's queue
        with contextlib.suppress(AppError):
            await streak.note(session, task.space_id, clock(), zone)
    return out


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, session: SessionDep) -> Response:
    await service.delete_task(session, task_id)
    return Response(status_code=204)


@router.get("/events")
async def list_events(
    session: SessionDep,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
    zone: ZoneDep,
) -> EventsOut:
    """Events of all spaces that intersect the date range (both days included, in the configured
    time zone, at most 62 days)."""
    events = await service.list_events(session, start, end, zone)
    return EventsOut(events=[EventOut.model_validate(event) for event in events])


@router.post("/spaces/{space}/events", status_code=201)
async def create_event(
    space: str, body: EventCreate, session: SessionDep, clock: ClockDep
) -> EventOut:
    event = await service.create_event(session, space, body, "web", clock())
    return EventOut.model_validate(event)


@router.patch("/events/{event_id}")
async def update_event(
    event_id: str, body: EventPatch, session: SessionDep, clock: ClockDep
) -> EventOut:
    event = await service.update_event(session, event_id, body, clock())
    return EventOut.model_validate(event)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(event_id: str, session: SessionDep) -> Response:
    await service.delete_event(session, event_id)
    return Response(status_code=204)
