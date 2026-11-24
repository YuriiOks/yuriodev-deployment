"""The streak of cleared queues: for each page and local day, was the queue emptied?

A row of `queue_day` per scope and day is written whenever a page's queue is computed (`/today`)
and whenever something is completed or decided (`note`). It records only what was seen: no past
day is ever filled in afterwards. The state of a day:

- `cleared`: the queue was empty at some look after having been not empty, or it was empty at
  every look;
- `open`: it was not empty at the last look and never emptied;
- `future`: the day has not come;
- `no_data`: nobody looked that day (and nothing was completed), so nothing is claimed.

`count` is the run of `cleared` days ending today (when today is not cleared yet, the run that
ends yesterday): the number the page shows.
"""

from datetime import date, datetime, timedelta, tzinfo
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, false, or_, select, true
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.dashboards.models import QueueDay

DayState = Literal["cleared", "open", "future", "no_data"]
LOOKBACK_DAYS = 120
_RESPONSE = ConfigDict(extra="forbid", frozen=True)


class StreakDay(BaseModel):
    model_config = _RESPONSE

    date: date
    state: DayState


class Streak(BaseModel):
    model_config = _RESPONSE

    days: list[StreakDay]  # this week, Monday to Sunday
    count: int


async def record(session: AsyncSession, scope: str, day: date, total: int, now: datetime) -> None:
    """One look at a queue of `total` items on `day`. Idempotent and cheap: one upsert."""
    empty = total == 0
    row = insert(QueueDay).values(
        scope=scope,
        day=day,
        opened=not empty,
        cleared_after_open=False,
        empty_now=empty,
        updated_at=now,
    )
    await session.execute(
        row.on_conflict_do_update(
            index_elements=[QueueDay.scope, QueueDay.day],
            set_={
                "opened": or_(QueueDay.opened, false() if empty else true()),
                "cleared_after_open": or_(
                    QueueDay.cleared_after_open, and_(QueueDay.opened, true() if empty else false())
                ),
                "empty_now": true() if empty else false(),
                "updated_at": now,
            },
        )
    )
    await session.commit()


def state_of(row: QueueDay | None, day: date, today: date) -> DayState:
    if day > today:
        return "future"
    if row is None:
        return "no_data"
    if row.cleared_after_open or (not row.opened and row.empty_now):
        return "cleared"
    return "open"


async def current(session: AsyncSession, scope: str, today: date) -> Streak:
    """This week's seven days and the current run of cleared days."""
    monday = today - timedelta(days=today.weekday())
    first = min(monday, today - timedelta(days=LOOKBACK_DAYS))
    rows = {
        row.day: row
        for row in await session.scalars(
            select(QueueDay).where(
                QueueDay.scope == scope, QueueDay.day >= first, QueueDay.day <= today
            )
        )
    }
    days = [
        StreakDay(date=d, state=state_of(rows.get(d), d, today))
        for d in (monday + timedelta(days=n) for n in range(7))
    ]
    cleared_today = state_of(rows.get(today), today, today) == "cleared"
    cursor = today if cleared_today else today - timedelta(days=1)
    count = 0
    while cursor >= first and state_of(rows.get(cursor), cursor, today) == "cleared":
        count += 1
        cursor -= timedelta(days=1)
    return Streak(days=days, count=count)


async def note(
    session: AsyncSession,
    scope: str,
    now: datetime,
    zone: tzinfo,
    display_currency: str = "GBP",
) -> None:
    """Something was completed or decided: look at the queue again and record it. A failure here
    never matters to what was just done, so callers may ignore the result."""
    from src.dashboards import today as page  # the page rules need this module's tables

    total = await page.queue_total(session, scope, now, zone, display_currency)
    await record(session, scope, now.astimezone(zone).date(), total, now)
