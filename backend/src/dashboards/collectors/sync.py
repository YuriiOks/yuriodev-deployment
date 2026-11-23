"""The database side of a collector: upsert what is open, close what is not, keep tombstones.

Ownership. A collected task is a normal `task` row whose `source` is the collector and whose
`source_ref` is the external id. The collector owns its title, its link and its open/done
status, and rewrites them on every sync. The user owns everything else (priority, notes, area,
due date, and the space it sits in): a sync never touches those, and the due date the source
offers is only used when the task is first created.

Closing. A task whose item is no longer in the fetched set is marked done (never deleted). The
fetched set is complete by contract (`Collector.fetch` raises rather than return a part), so
absence means closed, reassigned or no longer matching.

Deleting. When the user deletes a collected task, `service.delete_task` leaves a tombstone with a
fingerprint of its title and link. While the item is still open and unchanged, the sync skips it;
if the item changed (a new title or link) the tombstone is dropped and the task comes back; once
the item is gone from the source the tombstone is dropped too.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.dashboards.collectors.base import CalendarItem, ExternalItem, fingerprint
from src.dashboards.models import CollectedTombstone, Event, Task


@dataclass
class SyncCounts:
    created: int = 0
    updated: int = 0
    closed: int = 0
    reopened: int = 0
    skipped: int = 0  # items suppressed by a tombstone


async def sync_items(
    session: AsyncSession, source: str, space: str, items: list[ExternalItem], now: datetime
) -> SyncCounts:
    """Bring the tasks of `source` in line with `items`, the complete set of its open items."""
    counts = SyncCounts()
    tasks = await session.scalars(
        select(Task).where(Task.source == source, Task.source_ref.is_not(None))
    )
    by_ref = {task.source_ref: task for task in tasks.all()}
    stones = await session.scalars(
        select(CollectedTombstone).where(CollectedTombstone.source == source)
    )
    tombstones = {stone.source_ref: stone for stone in stones.all()}
    wanted = {item.external_id: item for item in items}

    for ref, item in wanted.items():
        task = by_ref.get(ref)
        if task is not None:
            _refresh(task, item, now, counts)
            continue
        stone = tombstones.get(ref)
        if stone is not None:
            if stone.fingerprint == fingerprint(item.title, item.url):
                counts.skipped += 1
                continue
            await session.delete(stone)  # the item changed since the user deleted it
        session.add(_new_task(source, space, item, now))
        counts.created += 1

    for known, task in by_ref.items():
        if known not in wanted and task.status == "open":
            task.status = "done"
            task.done_at = now
            task.updated_at = now
            counts.closed += 1
    for dropped, stone in tombstones.items():
        if dropped not in wanted:
            await session.delete(stone)

    await session.commit()
    return counts


def _refresh(task: Task, item: ExternalItem, now: datetime, counts: SyncCounts) -> None:
    """Rewrite the collector-owned fields; leave the user's alone."""
    changed = False
    if task.title != item.title:
        task.title = item.title
        changed = True
    if task.url != item.url:
        task.url = item.url
        changed = True
    if task.status != "open":
        task.status = "open"
        task.done_at = None
        counts.reopened += 1
        changed = True
    if changed:
        task.updated_at = now
        counts.updated += 1


def _new_task(source: str, space: str, item: ExternalItem, now: datetime) -> Task:
    return Task(
        id=uuid.uuid4(),
        space_id=space,
        title=item.title,
        notes=None,
        area_id=None,
        priority=False,
        due_date=item.due_date,
        status="open",
        done_at=None,
        source=source,
        source_ref=item.external_id,
        url=item.url,
        created_at=now,
        updated_at=now,
    )


class TaskCollector:
    """A collector of tasks: subclasses say where the open items come from (`fetch`), and
    this class writes them (`collect`). `fetch` returns every open item or raises: a partial
    answer would make the sync close tasks that are merely missing from it."""

    name: str  # the name in logs and settings
    source: str  # the `task.source` value of its rows
    space: str  # where new tasks go

    async def fetch(self, client: httpx.AsyncClient) -> list[ExternalItem]:
        raise NotImplementedError

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        items = await self.fetch(client)
        async with sessions() as session:
            counts = await sync_items(session, self.source, self.space, items, now)
        return {
            "fetched": len(items),
            "added": counts.created,  # not "created": that is a LogRecord field
            "updated": counts.updated,
            "closed": counts.closed,
            "skipped": counts.skipped,
        }


@dataclass
class EventCounts:
    created: int = 0
    updated: int = 0
    deleted: int = 0


async def sync_events(
    session: AsyncSession,
    space: str,
    items: list[CalendarItem],
    span: tuple[datetime, datetime],
    now: datetime,
    delete_missing: bool,
) -> EventCounts:
    """Bring the calendar events of `space` in line with `items`, what the feeds hold for `span`.

    The collector owns every field of a `calendar` event, so each sync rewrites them; events made
    by hand or over MCP have another `source` and are never read here. An event that intersects
    `span` but is no longer in the feeds is deleted, unless `delete_missing` is false (a feed
    failed: absence proves nothing). Events outside `span` stay as they are.
    """
    counts = EventCounts()
    rows = await session.scalars(
        select(Event).where(
            Event.source == "calendar", Event.space_id == space, Event.source_ref.is_not(None)
        )
    )
    by_ref = {event.source_ref: event for event in rows.all()}
    wanted = {item.external_id: item for item in items}
    for ref, item in wanted.items():
        event = by_ref.get(ref)
        if event is None:
            session.add(_new_event(space, item, now))
            counts.created += 1
        elif _refresh_event(event, item, now):
            counts.updated += 1
    if delete_missing:
        window_start, window_end = span
        for ref, event in by_ref.items():
            inside = event.starts_at < window_end and event.ends_at > window_start
            if ref not in wanted and inside:
                await session.delete(event)
                counts.deleted += 1
    await session.commit()
    return counts


def _refresh_event(event: Event, item: CalendarItem, now: datetime) -> bool:
    changed = (
        event.title != item.title
        or event.starts_at != item.starts_at
        or event.ends_at != item.ends_at
        or event.busy_only != item.busy_only
    )
    if changed:
        event.title = item.title
        event.starts_at = item.starts_at
        event.ends_at = item.ends_at
        event.busy_only = item.busy_only
        event.updated_at = now
    return changed


def _new_event(space: str, item: CalendarItem, now: datetime) -> Event:
    return Event(
        id=uuid.uuid4(),
        space_id=space,
        title=item.title,
        starts_at=item.starts_at,
        ends_at=item.ends_at,
        busy_only=item.busy_only,
        source="calendar",
        source_ref=item.external_id,
        created_at=now,
        updated_at=now,
    )
