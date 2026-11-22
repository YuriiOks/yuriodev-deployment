"""Queries and rules of the dashboards data API.

Every function takes an open AsyncSession, and the current time where it needs one (the app's
clock, so tests can fix it). A task belongs to exactly one space and every task query filters on
it: nothing here ever returns tasks of two spaces in one list (`today` without a space groups
them per space). Database trouble becomes 503 `dashboards_unavailable`; only the error class is
logged, because a driver message can quote the SQL parameters, that is, titles and notes.
"""

import logging
import uuid
from collections.abc import Callable, Coroutine, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import case, false, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.catalog import MAX_RANGE_DAYS, SPACE_IDS, TaskStatus, TaskStatusFilter
from src.dashboards.models import Area, Event, Space, Task
from src.dashboards.runtime import unavailable
from src.dashboards.schemas import (
    EventCreate,
    EventOut,
    EventPatch,
    NextEvent,
    SpaceSummary,
    TaskCreate,
    TaskOut,
    TaskPatch,
    TodayOut,
    TodaySpace,
)

logger = logging.getLogger("yuriodev.dashboards")


def guarded[**P, R](
    fn: Callable[P, Coroutine[Any, Any, R]],
) -> Callable[P, Coroutine[Any, Any, R]]:
    """Turn any database or connection error into 503 `dashboards_unavailable`."""

    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await fn(*args, **kwargs)
        except (SQLAlchemyError, OSError) as exc:
            logger.warning(
                "dashboards database error",
                extra={
                    "event": "dashboards.db_error",
                    "operation": getattr(fn, "__name__", "unknown"),
                    "error": type(exc).__name__,
                },
            )
            raise unavailable() from None

    return wrapper


def _not_found(what: str) -> AppError:
    return AppError(404, "not_found", f"{what} not found")


def _invalid(message: str) -> AppError:
    return AppError(422, "validation_error", message)


def check_space(space: str) -> None:
    if space not in SPACE_IDS:
        raise _not_found("Space")


def _parse_id(raw: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise _not_found(what) from None


def _space_rank(space_id: str) -> int:
    return SPACE_IDS.index(space_id) if space_id in SPACE_IDS else len(SPACE_IDS)


def _task_order() -> tuple[Any, ...]:
    """Open tasks first (priority, then due date with no date last, then oldest first), then
    done tasks, most recently finished first."""
    is_open = Task.status == "open"
    return (
        (Task.status == "done").asc(),
        case((is_open, Task.priority), else_=false()).desc(),
        case((is_open, Task.due_date)).asc().nulls_last(),
        case((is_open, Task.created_at)).asc(),
        Task.done_at.desc().nulls_last(),
        Task.created_at.asc(),
        Task.id.asc(),
    )


async def _check_area(session: AsyncSession, space: str, area_id: str | None) -> None:
    """An area must exist and belong to the task's space (areas are personal-space only)."""
    if area_id is None:
        return
    area = await session.get(Area, area_id)
    if area is None or area.space_id != space:
        raise _invalid("Unknown area for this space")


# bootstrap ------------------------------------------------------------------------------------


@guarded
async def list_spaces(session: AsyncSession) -> list[str]:
    ids = (await session.scalars(select(Space.id))).all()
    return sorted(ids, key=_space_rank)


@guarded
async def list_areas(session: AsyncSession) -> Sequence[Area]:
    return (await session.scalars(select(Area).order_by(Area.sort, Area.id))).all()


@guarded
async def summary(session: AsyncSession, now: datetime) -> list[SpaceSummary]:
    day = now.date()
    is_open = Task.status == "open"
    open_count = func.count().filter(is_open)
    priority_count = func.count().filter(is_open, Task.priority)
    overdue_count = func.count().filter(is_open, Task.due_date < day)
    totals = select(Task.space_id, open_count, priority_count, overdue_count)
    counts = await session.execute(totals.group_by(Task.space_id))
    by_space = {row[0]: (row[1], row[2], row[3]) for row in counts.all()}
    upcoming = (
        select(Event)
        .ext(distinct_on(Event.space_id))
        .where(Event.starts_at >= now)
        .order_by(Event.space_id, Event.starts_at, Event.id)
    )
    next_by_space = {event.space_id: event for event in (await session.scalars(upcoming)).all()}
    out: list[SpaceSummary] = []
    for space_id in SPACE_IDS:
        total, urgent, late = by_space.get(space_id, (0, 0, 0))
        event = next_by_space.get(space_id)
        nxt = None if event is None else NextEvent.model_validate(event)
        row = SpaceSummary(id=space_id, open=total, priority=urgent, overdue=late, next_event=nxt)
        out.append(row)
    return out


# tasks ----------------------------------------------------------------------------------------


@guarded
async def list_tasks(
    session: AsyncSession, space: str, status: TaskStatusFilter = "open"
) -> Sequence[Task]:
    check_space(space)
    query = select(Task).where(Task.space_id == space)
    if status != "all":
        query = query.where(Task.status == status)
    return (await session.scalars(query.order_by(*_task_order()))).all()


@guarded
async def create_task(
    session: AsyncSession, space: str, data: TaskCreate, source: str, now: datetime
) -> Task:
    check_space(space)
    await _check_area(session, space, data.area_id)
    task = Task(
        id=uuid.uuid4(),
        space_id=space,
        title=data.title,
        notes=data.notes,
        area_id=data.area_id,
        priority=data.priority,
        due_date=data.due_date,
        status="open",
        done_at=None,
        source=source,
        source_ref=None,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    await session.commit()
    return task


def _set_status(task: Task, status: TaskStatus, now: datetime) -> None:
    """`done_at` follows `status`: set when a task becomes done (kept if it already was),
    cleared when it is reopened."""
    if status == "done":
        if task.status != "done" or task.done_at is None:
            task.done_at = now
        task.status = "done"
    else:
        task.status = "open"
        task.done_at = None


@guarded
async def update_task(session: AsyncSession, task_id: str, patch: TaskPatch, now: datetime) -> Task:
    task = await session.get(Task, _parse_id(task_id, "Task"))
    if task is None:
        raise _not_found("Task")
    fields = patch.model_fields_set
    if "area_id" in fields:
        await _check_area(session, task.space_id, patch.area_id)
        task.area_id = patch.area_id
    if "title" in fields and patch.title is not None:
        task.title = patch.title
    if "notes" in fields:
        task.notes = patch.notes
    if "priority" in fields and patch.priority is not None:
        task.priority = patch.priority
    if "due_date" in fields:
        task.due_date = patch.due_date
    if "status" in fields and patch.status is not None:
        _set_status(task, patch.status, now)
    task.updated_at = now
    await session.commit()
    return task


@guarded
async def delete_task(session: AsyncSession, task_id: str) -> None:
    task = await session.get(Task, _parse_id(task_id, "Task"))
    if task is None:
        raise _not_found("Task")
    await session.delete(task)
    await session.commit()


# events ---------------------------------------------------------------------------------------


def validate_range(start: date, end: date) -> tuple[datetime, datetime]:
    """The UTC window [start 00:00, end + 1 day 00:00) of an inclusive date range of at most
    62 days."""
    if end < start or (end - start).days + 1 > MAX_RANGE_DAYS:
        raise _invalid("Invalid date range")
    return (
        datetime.combine(start, time.min, tzinfo=UTC),
        datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC),
    )


@guarded
async def list_events(session: AsyncSession, start: date, end: date) -> Sequence[Event]:
    """Events of all spaces that intersect the range (the one query that spans spaces)."""
    window_start, window_end = validate_range(start, end)
    query = (
        select(Event)
        .where(Event.starts_at < window_end, Event.ends_at > window_start)
        .order_by(Event.starts_at, Event.ends_at, Event.id)
    )
    return (await session.scalars(query)).all()


@guarded
async def create_event(
    session: AsyncSession, space: str, data: EventCreate, source: str, now: datetime
) -> Event:
    check_space(space)
    event = Event(
        id=uuid.uuid4(),
        space_id=space,
        title=data.title,
        starts_at=data.starts_at.astimezone(UTC),
        ends_at=data.ends_at.astimezone(UTC),
        busy_only=data.busy_only,
        source=source,
        created_at=now,
        updated_at=now,
    )
    session.add(event)
    await session.commit()
    return event


@guarded
async def update_event(
    session: AsyncSession, event_id: str, patch: EventPatch, now: datetime
) -> Event:
    event = await session.get(Event, _parse_id(event_id, "Event"))
    if event is None:
        raise _not_found("Event")
    starts_at = patch.starts_at or event.starts_at
    ends_at = patch.ends_at or event.ends_at
    if ends_at <= starts_at:
        raise _invalid("ends_at must be after starts_at")
    if patch.title is not None:
        event.title = patch.title
    if patch.busy_only is not None:
        event.busy_only = patch.busy_only
    event.starts_at = starts_at.astimezone(UTC)
    event.ends_at = ends_at.astimezone(UTC)
    event.updated_at = now
    await session.commit()
    return event


@guarded
async def delete_event(session: AsyncSession, event_id: str) -> None:
    event = await session.get(Event, _parse_id(event_id, "Event"))
    if event is None:
        raise _not_found("Event")
    await session.delete(event)
    await session.commit()


# today ----------------------------------------------------------------------------------------


@guarded
async def today(session: AsyncSession, space: str | None, now: datetime) -> TodayOut:
    """Open priority tasks and open tasks due today or earlier, plus today's events, per space
    (one space, or all of them when `space` is None)."""
    if space is not None:
        check_space(space)
    spaces: tuple[str, ...] = SPACE_IDS if space is None else (space,)
    day = now.date()
    window_start, window_end = validate_range(day, day)
    task_query = select(Task).where(
        Task.space_id.in_(spaces),
        Task.status == "open",
        or_(Task.priority.is_(True), Task.due_date <= day),
    )
    event_query = select(Event).where(
        Event.space_id.in_(spaces),
        Event.starts_at < window_end,
        Event.ends_at > window_start,
    )
    tasks = (await session.scalars(task_query.order_by(*_task_order()))).all()
    events = (await session.scalars(event_query.order_by(Event.starts_at, Event.id))).all()
    groups: list[TodaySpace] = []
    for space_id in spaces:
        mine = [TaskOut.model_validate(t) for t in tasks if t.space_id == space_id]
        todays = [EventOut.model_validate(e) for e in events if e.space_id == space_id]
        groups.append(TodaySpace(space=space_id, tasks=mine, events=todays))
    return TodayOut(date=day, spaces=groups)
