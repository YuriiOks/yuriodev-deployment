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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dashboards.collectors.base import ExternalItem, fingerprint
from src.dashboards.models import CollectedTombstone, Task


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
