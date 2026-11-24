"""One answer per page: everything a page's Today view shows, as data and codes.

`GET /api/dashboards/v1/today?scope=personal|work-1|work-2|money` (and the MCP tool `today` with a
`scope`). Never a finished sentence: the page words every headline, action and insight itself (in
two languages) from the `code` and `facts` of what is here. Dates are ISO strings, money is an
integer in minor units next to its currency, times are UTC instants.

The rules are deterministic and live here, so they can be tested without a page:

- the queue is at most three items, most urgent first (`queue_total` says how many qualify):
  `personal`: overdue then due today, then priority tasks, then due within three days;
  `work-1`: review requests waiting longest, urgent or high issues in progress with no movement
  for three days, then priority tasks; `work-2`: its manual priority tasks and tasks due today
  (nothing else: that space is manual only); `money`: the attention items, as they are ordered;
- `soon` is the next two or three things after the queue: dated tasks, other review requests, or
  the upcoming payments;
- `stats` are two figures with a comparison each; `breakdown` is up to four rows for bars plus an
  `insight` chosen by rule (the largest rise, the stalest group, the freest day) or null;
- `today` is up to three rows: events for the spaces, the bank connections for money.

Everything is read from what the other services already compute (tasks, events, attention,
upcoming payments, categories, balances): there is no new collector, and `work-2` is only ever
its own tasks and events.
"""

import uuid
from collections import Counter, defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance import recurring_service
from src.dashboards.finance import service as finance_service
from src.dashboards.finance.models import Recurring
from src.dashboards.finance.schemas import API_STALE_AFTER
from src.dashboards.models import Area, Event, Task
from src.dashboards.service import guarded, task_order
from src.dashboards.streak import Streak, current, record

Scope = Literal["personal", "work-1", "work-2", "money"]
SCOPES: tuple[str, ...] = get_args(Scope)
QUEUE_MAX = 3
SOON_MAX = 3
ROWS_MAX = 4
TODAY_MAX = 3
SOON_DAYS = 3  # personal: a task due within this many days is worth a place in the queue
IDLE_ISSUE_DAYS = 3  # work-1: an urgent or high issue in progress with no movement this long
STALE_TASK_DAYS = 30  # personal: a task with no date this old is "stale"
STALE_AREA_MIN = 3  # ... and an area needs this many of them to be called out
LARGE_PAYMENT_MINOR = 10_000  # money: a "large" payment, in the display currency (100.00)
UPCOMING_DAYS = 14
HIGH = ("urgent", "high")
_RESPONSE = ConfigDict(extra="forbid", frozen=True)


class Subject(BaseModel):
    """What an item is about: a task, an event, a payment, an account, a connection..."""

    model_config = _RESPONSE

    type: str
    id: str | None
    name: str | None  # the owner's own text (a title, a bank's name): data, not a sentence


class Link(BaseModel):
    """Where the page sends the owner to act: a page object, or an address outside (a PR)."""

    model_config = _RESPONSE

    kind: str
    id: str | None
    url: str | None


class QueueItem(BaseModel):
    model_config = _RESPONSE

    key: str
    kind: str
    subject: Subject
    facts: dict[str, Any]
    primary: str  # an action code the page words and wires (mark_done, open_pull_request, ...)
    secondary: str | None
    link: Link


class SoonItem(BaseModel):
    model_config = _RESPONSE

    key: str
    kind: str
    subject: Subject
    facts: dict[str, Any]


class Compare(BaseModel):
    model_config = _RESPONSE

    code: str
    value: int | None


class Stat(BaseModel):
    model_config = _RESPONSE

    code: str
    value: int | None
    compare: Compare | None
    facts: dict[str, Any]


class Row(BaseModel):
    """One bar: `value` in the unit the `breakdown.code` says; `label` carries a name the
    server holds in two languages (a life area), else the page words `key`."""

    model_config = _RESPONSE

    key: str
    value: int
    label: dict[str, str] | None
    facts: dict[str, Any]


class Insight(BaseModel):
    model_config = _RESPONSE

    code: str
    facts: dict[str, Any]


class Breakdown(BaseModel):
    model_config = _RESPONSE

    code: str
    rows: list[Row]
    insight: Insight | None


class TodayRow(BaseModel):
    model_config = _RESPONSE

    kind: str
    starts_at: datetime | None
    ends_at: datetime | None
    subject: Subject
    facts: dict[str, Any]


class Headline(BaseModel):
    model_config = _RESPONSE

    code: str
    facts: dict[str, Any]


class Assistant(BaseModel):
    model_config = _RESPONSE

    enabled: bool


class TodayPageOut(BaseModel):
    model_config = _RESPONSE

    scope: Scope
    date: date
    generated_at: datetime
    summary: Headline
    queue: list[QueueItem]
    queue_total: int
    soon: list[SoonItem]
    stats: list[Stat]
    breakdown: Breakdown
    today: list[TodayRow]
    streak: Streak
    assistant: Assistant


def invalid_scope() -> AppError:
    return AppError(422, "validation_error", "Invalid scope")


# ---- tasks ------------------------------------------------------------------------------------


def _days(later: date, earlier: date) -> int:
    return (later - earlier).days


def task_subject(task: Task) -> Subject:
    return Subject(type="task", id=str(task.id), name=task.title)


def task_facts(task: Task, today: date, now: datetime) -> dict[str, Any]:
    """What a page needs to say why a task is here."""
    facts: dict[str, Any] = {
        "priority": task.priority,
        "due_date": None if task.due_date is None else task.due_date.isoformat(),
        "days_overdue": None,
        "days_until": None,
        "area_id": task.area_id,
        "source": task.source,
        "stage": task.stage,
        "source_priority": task.source_priority,
        "waiting_hours": int((now - task.created_at).total_seconds() // 3600),
        "idle_days": None,
    }
    if task.due_date is not None:
        facts["days_overdue"] = max(_days(today, task.due_date), 0) or None
        facts["days_until"] = max(_days(task.due_date, today), 0)
    if task.source_updated_at is not None:
        facts["idle_days"] = max((now - task.source_updated_at).days, 0)
    return facts


def _task_item(task: Task, reason: str, today: date, now: datetime) -> QueueItem:
    facts = {"reason": reason, **task_facts(task, today, now)}
    collected = task.url is not None and task.source in {"github", "linear"}
    kind = "pull_request" if task.stage in {"mine", "review", "reviewed"} else "task"
    if task.source == "linear":
        kind = "issue"
    link = Link(kind=kind if collected else "task", id=str(task.id), url=task.url)
    # A collected item is acted on where it lives; the owner's own task is ticked off here.
    primary = "open_external" if collected else "mark_done"
    secondary = "snooze" if collected else "open_task"
    return QueueItem(
        key=f"task:{task.id}",
        kind=kind,
        subject=task_subject(task),
        facts=facts,
        primary=primary,
        secondary=secondary,
        link=link,
    )


def personal_queue(
    tasks: Sequence[Task], today: date, now: datetime
) -> tuple[list[QueueItem], int]:
    """Overdue first (oldest due date first), then due today, then priority, then due within
    three days. A task appears once, under the first rule that takes it."""
    open_tasks = [t for t in tasks if t.status == "open"]
    late = sorted(
        (t for t in open_tasks if t.due_date is not None and t.due_date < today),
        key=lambda t: (t.due_date, t.created_at),
    )
    due_today = [t for t in open_tasks if t.due_date == today]
    seen = {t.id for t in (*late, *due_today)}
    priority = [t for t in open_tasks if t.priority and t.id not in seen]
    seen |= {t.id for t in priority}
    soon_limit = today + timedelta(days=SOON_DAYS)
    near = sorted(
        (
            t
            for t in open_tasks
            if t.id not in seen and t.due_date is not None and today < t.due_date <= soon_limit
        ),
        key=lambda t: (t.due_date, t.created_at),
    )
    ranked = (
        [(t, "overdue") for t in late]
        + [(t, "due_today") for t in due_today]
        + [(t, "priority") for t in priority]
        + [(t, "due_soon") for t in near]
    )
    return [_task_item(t, why, today, now) for t, why in ranked[:QUEUE_MAX]], len(ranked)


def work2_queue(tasks: Sequence[Task], today: date, now: datetime) -> tuple[list[QueueItem], int]:
    """Its manual priority tasks (due today first) and tasks due today: nothing else."""
    open_tasks = [t for t in tasks if t.status == "open"]
    chosen = [t for t in open_tasks if t.priority or t.due_date == today]
    chosen.sort(key=lambda t: (t.due_date != today, not t.priority, t.created_at))
    ranked = [(t, "due_today" if t.due_date == today else "priority") for t in chosen]
    return [_task_item(t, why, today, now) for t, why in ranked[:QUEUE_MAX]], len(ranked)


def _is_review(task: Task) -> bool:
    return task.stage == "review" and task.source == "github" and not task.draft


def _in_progress(task: Task) -> bool:
    return task.source == "linear" and task.stage == "started"


def work1_queue(tasks: Sequence[Task], today: date, now: datetime) -> tuple[list[QueueItem], int]:
    """Review requests waiting longest, then urgent or high issues in progress that have not
    moved for three days, then the owner's priority tasks."""
    open_tasks = [t for t in tasks if t.status == "open"]
    reviews = sorted((t for t in open_tasks if _is_review(t)), key=lambda t: t.created_at)
    cutoff = now - timedelta(days=IDLE_ISSUE_DAYS)
    stuck = sorted(
        (
            t
            for t in open_tasks
            if _in_progress(t)
            and t.source_priority in HIGH
            and (t.source_updated_at is None or t.source_updated_at <= cutoff)
        ),
        key=lambda t: (HIGH.index(t.source_priority or "high"), t.source_updated_at or now),
    )
    seen = {t.id for t in (*reviews, *stuck)}
    priority = [t for t in open_tasks if t.priority and t.id not in seen]
    ranked = (
        [(t, "review_waiting") for t in reviews]
        + [(t, "issue_idle") for t in stuck]
        + [(t, "priority") for t in priority]
    )
    return [_task_item(t, why, today, now) for t, why in ranked[:QUEUE_MAX]], len(ranked)


def dated_soon(tasks: Sequence[Task], skip: set[str], today: date, now: datetime) -> list[SoonItem]:
    """The next dated open tasks that are not already in the queue."""
    found = sorted(
        (
            t
            for t in tasks
            if t.status == "open" and t.due_date is not None and f"task:{t.id}" not in skip
        ),
        key=lambda t: (t.due_date, t.created_at),
    )
    return [
        SoonItem(
            key=f"task:{t.id}",
            kind="task",
            subject=task_subject(t),
            facts=task_facts(t, today, now),
        )
        for t in found[:SOON_MAX]
    ]


def review_soon(
    tasks: Sequence[Task], skip: set[str], today: date, now: datetime
) -> list[SoonItem]:
    """The other review requests, longest waiting first."""
    found = sorted(
        (t for t in tasks if t.status == "open" and _is_review(t) and f"task:{t.id}" not in skip),
        key=lambda t: t.created_at,
    )
    return [
        SoonItem(
            key=f"task:{t.id}",
            kind="pull_request",
            subject=task_subject(t),
            facts=task_facts(t, today, now),
        )
        for t in found[:SOON_MAX]
    ]


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def local_midnight(day: date, zone: tzinfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=zone)


def _day_bounds(day: date, zone: tzinfo) -> tuple[datetime, datetime]:
    return local_midnight(day, zone), local_midnight(day + timedelta(days=1), zone)


def meeting_minutes(events: Sequence[Event], days: Sequence[date], zone: tzinfo) -> dict[date, int]:
    """Minutes of events on each local day, an event that spans midnight split between the days."""
    minutes: dict[date, int] = dict.fromkeys(days, 0)
    for day in days:
        start, end = local_midnight(day, zone), local_midnight(day + timedelta(days=1), zone)
        for event in events:
            overlap = min(event.ends_at, end) - max(event.starts_at, start)
            if overlap > timedelta(0):
                minutes[day] += int(overlap.total_seconds() // 60)
    return minutes


# ---- the spaces -------------------------------------------------------------------------------


async def _open_tasks(session: AsyncSession, space: str) -> Sequence[Task]:
    query = select(Task).where(Task.space_id == space, Task.status == "open")
    return (await session.scalars(query.order_by(*task_order()))).all()


async def _closed_counts(
    session: AsyncSession, space: str, this_week: datetime, last_week: datetime
) -> tuple[int, int]:
    this_count = func.count().filter(Task.done_at >= this_week)
    last_count = func.count().filter(Task.done_at >= last_week, Task.done_at < this_week)
    row = (
        await session.execute(
            select(this_count, last_count).where(Task.space_id == space, Task.status == "done")
        )
    ).one()
    return int(row[0]), int(row[1])


async def _events(
    session: AsyncSession, space: str, start: datetime, end: datetime
) -> Sequence[Event]:
    query = select(Event).where(
        Event.space_id == space, Event.starts_at < end, Event.ends_at > start
    )
    return (await session.scalars(query.order_by(Event.starts_at, Event.id))).all()


async def _next_event(session: AsyncSession, space: str, now: datetime) -> dict[str, Any] | None:
    query = (
        select(Event)
        .where(Event.space_id == space, Event.ends_at > now)
        .order_by(Event.starts_at, Event.id)
        .limit(1)
    )
    event = await session.scalar(query)
    if event is None:
        return None
    return {"title": event.title, "starts_at": event.starts_at.astimezone(UTC).isoformat()}


def _event_row(event: Event) -> TodayRow:
    return TodayRow(
        kind="event",
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        subject=Subject(type="event", id=str(event.id), name=event.title),
        facts={"busy_only": event.busy_only, "source": event.source},
    )


def _space_stats(tasks: Sequence[Task], today: date, closed: tuple[int, int]) -> list[Stat]:
    open_count = len(tasks)
    dated = sum(1 for t in tasks if t.due_date is not None)
    first = Stat(
        code="open_tasks",
        value=open_count,
        compare=None,
        facts={
            "priority": sum(1 for t in tasks if t.priority),
            "without_date": open_count - dated,
            "overdue": sum(1 for t in tasks if t.due_date is not None and t.due_date < today),
        },
    )
    second = Stat(
        code="closed_this_week",
        value=closed[0],
        compare=Compare(code="closed_last_week", value=closed[1]),
        facts={},
    )
    return [first, second]


def _by_area(
    tasks: Sequence[Task], areas: dict[str, Area], today: date, now: datetime
) -> tuple[list[Row], Insight | None]:
    counts: Counter[str] = Counter(
        t.area_id for t in tasks if t.area_id is not None and t.area_id in areas
    )
    ranked = sorted(counts.items(), key=lambda item: (-item[1], str(item[0])))
    rows = [
        Row(
            key=area_id,
            value=count,
            label={"ru": areas[area_id].name_ru, "en": areas[area_id].name_en},
            facts={},
        )
        for area_id, count in ranked[:ROWS_MAX]
    ]
    stale_limit = now - timedelta(days=STALE_TASK_DAYS)
    stale: Counter[str] = Counter(
        t.area_id
        for t in tasks
        if t.area_id is not None
        and t.area_id in areas
        and t.due_date is None
        and t.created_at <= stale_limit
    )
    insight = None
    if stale:
        area_id, count = sorted(stale.items(), key=lambda item: (-item[1], item[0]))[0]
        if count >= STALE_AREA_MIN:
            insight = Insight(
                code="stale_area",
                facts={"area_id": area_id, "count": count, "older_than_days": STALE_TASK_DAYS},
            )
    return rows, insight


async def _areas(session: AsyncSession, space: str) -> dict[str, Area]:
    rows = await session.scalars(select(Area).where(Area.space_id == space))
    return {area.id: area for area in rows}


async def _personal(
    session: AsyncSession, now: datetime, zone: tzinfo, today: date
) -> dict[str, Any]:
    tasks = await _open_tasks(session, "personal")
    queue, total = personal_queue(tasks, today, now)
    skip = {item.key for item in queue}
    this_week = local_midnight(week_start(today), zone)
    closed = await _closed_counts(session, "personal", this_week, this_week - timedelta(days=7))
    rows, insight = _by_area(tasks, await _areas(session, "personal"), today, now)
    midnight, next_midnight = _day_bounds(today, zone)
    events = await _events(session, "personal", midnight, next_midnight)
    return {
        "summary": Headline(
            code="personal",
            facts={
                "open": len(tasks),
                "priority": sum(1 for t in tasks if t.priority),
                "overdue": sum(1 for t in tasks if t.due_date is not None and t.due_date < today),
                "next_event": await _next_event(session, "personal", now),
            },
        ),
        "queue": queue,
        "queue_total": total,
        "soon": dated_soon(tasks, skip, today, now),
        "stats": _space_stats(tasks, today, closed),
        "breakdown": Breakdown(code="open_by_area", rows=rows, insight=insight),
        "today": [_event_row(e) for e in events[:TODAY_MAX]],
    }


def _work1_stats(tasks: Sequence[Task], now: datetime) -> list[Stat]:
    reviews = [t for t in tasks if _is_review(t)]
    oldest = min((t.created_at for t in reviews), default=None)
    progress = [t for t in tasks if _in_progress(t)]
    by_priority = Counter(t.source_priority or "none" for t in progress)
    return [
        Stat(
            code="review_waiting",
            value=len(reviews),
            compare=None,
            facts={
                "oldest_hours": None
                if oldest is None
                else int((now - oldest).total_seconds() // 3600)
            },
        ),
        Stat(
            code="issues_in_progress",
            value=len(progress),
            compare=None,
            facts={"by_priority": dict(by_priority)},
        ),
    ]


STAGE_ORDER = ("started", "unstarted", "backlog", "triage")


def _work1_breakdown(tasks: Sequence[Task], now: datetime) -> Breakdown:
    issues = [t for t in tasks if t.source == "linear"]
    counts = Counter(t.stage or "other" for t in issues)
    order = {stage: index for index, stage in enumerate(STAGE_ORDER)}
    ranked = sorted(counts.items(), key=lambda item: (order.get(item[0], 99), item[0]))
    rows = [Row(key=stage, value=count, label=None, facts={}) for stage, count in ranked[:ROWS_MAX]]
    # The bottleneck: the owner's own pull requests that nobody has touched for a day or more.
    waiting = [
        t
        for t in tasks
        if t.source == "github"
        and t.stage == "mine"
        and not t.draft
        and t.source_updated_at is not None
        and now - t.source_updated_at >= timedelta(days=1)
    ]
    insight = None
    if waiting:
        oldest = min(t.source_updated_at for t in waiting if t.source_updated_at is not None)
        insight = Insight(
            code="stalled_pull_requests",
            facts={"count": len(waiting), "oldest_days": (now - oldest).days},
        )
    return Breakdown(code="issues_by_stage", rows=rows, insight=insight)


async def _work1(session: AsyncSession, now: datetime, zone: tzinfo, today: date) -> dict[str, Any]:
    tasks = await _open_tasks(session, "work-1")
    queue, total = work1_queue(tasks, today, now)
    skip = {item.key for item in queue}
    midnight, next_midnight = _day_bounds(today, zone)
    events = await _events(session, "work-1", midnight, next_midnight)
    stats = _work1_stats(tasks, now)
    reviews, progress = stats[0], stats[1]
    return {
        "summary": Headline(
            code="work-1",
            facts={
                "review_waiting": reviews.value,
                "issues_in_progress": progress.value,
                "urgent": sum(
                    1 for t in tasks if _in_progress(t) and t.source_priority == "urgent"
                ),
                "next_event": await _next_event(session, "work-1", now),
            },
        ),
        "queue": queue,
        "queue_total": total,
        "soon": review_soon(tasks, skip, today, now),
        "stats": stats,
        "breakdown": _work1_breakdown(tasks, now),
        "today": [_event_row(e) for e in events[:TODAY_MAX]],
    }


async def _work2(session: AsyncSession, now: datetime, zone: tzinfo, today: date) -> dict[str, Any]:
    tasks = await _open_tasks(session, "work-2")
    queue, total = work2_queue(tasks, today, now)
    skip = {item.key for item in queue}
    monday = week_start(today)
    days = [monday + timedelta(days=n) for n in range(5)]  # the working week
    week_end = local_midnight(monday + timedelta(days=7), zone)
    week = await _events(session, "work-2", local_midnight(monday, zone), week_end)
    minutes = meeting_minutes(week, days, zone)
    rows = [Row(key=d.isoformat(), value=m, label=None, facts={}) for d, m in minutes.items()]
    ahead = {d: m for d, m in minutes.items() if d >= today}
    insight = None
    if ahead:
        free = min(sorted(ahead), key=lambda d: (ahead[d], d))
        facts = {"date": free.isoformat(), "minutes": ahead[free]}
        insight = Insight(code="freest_day", facts=facts)
    this_week = local_midnight(monday, zone)
    closed = await _closed_counts(session, "work-2", this_week, this_week - timedelta(days=7))
    midnight, next_midnight = _day_bounds(today, zone)
    todays = [e for e in week if e.starts_at < next_midnight and e.ends_at > midnight]
    return {
        "summary": Headline(
            code="work-2",
            facts={
                "open": len(tasks),
                "priority": sum(1 for t in tasks if t.priority),
                "next_event": await _next_event(session, "work-2", now),
            },
        ),
        "queue": queue,
        "queue_total": total,
        "soon": dated_soon(tasks, skip, today, now),
        "stats": _space_stats(tasks, today, closed),
        "breakdown": Breakdown(code="meeting_minutes_by_day", rows=rows, insight=insight),
        "today": [_event_row(e) for e in todays[:TODAY_MAX]],
    }


# ---- money ------------------------------------------------------------------------------------

ATTENTION_ACTIONS: dict[str, tuple[str, str | None]] = {
    "amount_changed": ("accept_amount", "open_payment"),
    "due_not_covered": ("open_payment", "snooze"),
    "missed_payment": ("mark_paid", "open_payment"),
    "credit_high": ("open_bank", "snooze"),
    "overdraft": ("open_bank", "snooze"),
    "overdrawn": ("set_overdraft_limit", "snooze"),
    "reconsent": ("reconnect", "snooze"),
    "stale_statement": ("update_balance", "snooze"),
    "stale_connection": ("open_bank", "snooze"),
}
LINK_KINDS = {"recurring": "payment", "account": "account", "connection": "connection"}


def money_queue(items: Sequence[Any]) -> list[QueueItem]:
    """The first three attention items, as the attention list already orders them."""
    queue: list[QueueItem] = []
    for item in items[:QUEUE_MAX]:
        primary, secondary = ATTENTION_ACTIONS.get(item.kind, ("open", "snooze"))
        facts = {
            **item.facts,
            "severity": item.severity,
            "due_date": None if item.due_date is None else item.due_date.isoformat(),
            "amount": item.amount,
            "currency": item.currency,
            "display_amount": item.display_amount,
            "converted": item.converted,
            "provider": item.provider,
        }
        queue.append(
            QueueItem(
                key=item.key,
                kind=item.kind,
                subject=Subject(
                    type=LINK_KINDS.get(item.subject_type, item.subject_type),
                    id=str(item.subject_id),
                    name=item.subject_name,
                ),
                facts=facts,
                primary=primary,
                secondary=secondary,
                link=Link(
                    kind=LINK_KINDS.get(item.subject_type, item.subject_type),
                    id=str(item.subject_id),
                    url=None,
                ),
            )
        )
    return queue


def money_soon(upcoming: Any) -> list[SoonItem]:
    """The next payments due (not the ones already overdue: those are attention items)."""
    items = [i for i in upcoming.items if not i.overdue]
    return [
        SoonItem(
            key=f"payment:{i.recurring_id}:{i.due_date.isoformat()}",
            kind="payment",
            subject=Subject(type="payment", id=str(i.recurring_id), name=i.name),
            facts={
                "due_date": i.due_date.isoformat(),
                "days_until": i.days_until,
                "amount": i.amount,
                "currency": i.currency,
                "display_amount": i.display_amount,
                "converted": i.converted,
                "covered": i.covered,
                "frequency_kind": i.kind,
            },
        )
        for i in items[:SOON_MAX]
    ]


def large_payment(upcoming: Any) -> dict[str, Any] | None:
    """The first upcoming payment of at least `LARGE_PAYMENT_MINOR` in the display currency."""
    for i in upcoming.items:
        if i.overdue or i.display_amount is None:
            continue
        if i.display_amount >= LARGE_PAYMENT_MINOR:
            return {
                "recurring_id": str(i.recurring_id),
                "name": i.name,
                "days_until": i.days_until,
                "due_date": i.due_date.isoformat(),
                "display_amount": i.display_amount,
            }
    return None


def category_insight(categories: Any) -> Insight | None:
    """The category that rose most against the month before up to the same day."""
    best: tuple[int, Any] | None = None
    for line in categories.display.categories:
        before = line.previous_to_date if line.previous_to_date is not None else line.previous
        rise = line.spent - before
        if rise > 0 and (best is None or rise > best[0]):
            best = (rise, line)
    if best is None:
        return None
    rise, line = best
    before = line.previous_to_date if line.previous_to_date is not None else line.previous
    return Insight(
        code="category_rise",
        facts={
            "category": line.category,
            "spent": line.spent,
            "before": before,
            "rise": rise,
            "currency": categories.display.currency,
            "converted": line.converted,
        },
    )


async def _confirmed_amount(session: AsyncSession, upcoming: Any) -> int:
    """The part of what is due that the bank has already confirmed: payments on an account we
    read whose pattern has been matched in its statement before."""
    ids = [i.recurring_id for i in upcoming.items if i.account_id is not None]
    if not ids:
        return 0
    matched = set(
        await session.scalars(
            select(Recurring.id).where(
                Recurring.id.in_(ids), Recurring.last_matched_on.is_not(None)
            )
        )
    )
    return sum(i.display_amount or 0 for i in upcoming.items if i.recurring_id in matched)


def _connection_rows(
    accounts: Sequence[Any], links: Sequence[Any], now: datetime
) -> list[TodayRow]:
    """The bank connections, those that need a look first, with what each holds."""
    held: dict[uuid.UUID, Counter[str]] = defaultdict(Counter)
    for account in accounts:
        if not account.archived:
            held[account.connection_id][account.currency] += account.balance - account.credit_limit
    rows: list[TodayRow] = []
    for link in links:
        since = link.last_ok_at or link.created_at
        stale = not link.manual and link.status == "ok" and now - since > API_STALE_AFTER
        rows.append(
            TodayRow(
                kind="connection",
                starts_at=None,
                ends_at=None,
                subject=Subject(
                    type="connection", id=str(link.id), name=link.display_name or link.provider
                ),
                facts={
                    "provider": link.provider,
                    "manual": link.manual,
                    "status": link.status,
                    "last_ok_at": None
                    if link.last_ok_at is None
                    else link.last_ok_at.astimezone(UTC).isoformat(),
                    "stale": stale,
                    "balances": [
                        {"currency": c, "amount": a} for c, a in sorted(held[link.id].items())
                    ],
                },
            )
        )
    rows.sort(
        key=lambda r: (
            not (r.facts["stale"] or r.facts["status"] != "ok"),
            r.subject.name or "",
        )
    )
    return rows[:TODAY_MAX]


async def _money(
    session: AsyncSession, now: datetime, zone: tzinfo, today: date, display_currency: str
) -> dict[str, Any]:
    display = await finance_service.display_for(session, display_currency, now)
    attention = await recurring_service.attention(session, now, zone, display)
    upcoming = await recurring_service.upcoming(session, now, zone, display, UPCOMING_DAYS)
    categories = await finance_service.categories_report(session, None, now, zone, display)
    summary = await finance_service.summary(session, now, zone, display)
    accounts, links, _ = await finance_service.list_accounts(session)
    large = large_payment(upcoming)
    shown = categories.display.categories[:ROWS_MAX]
    return {
        "summary": Headline(
            code="money",
            facts={
                "currency": display.currency,
                "total": summary.display.own_balance,
                "complete": summary.display.complete,
                "queue_total": len(attention.items),
                "large_payment": large,
                "days_to_large_payment": None if large is None else large["days_until"],
            },
        ),
        "queue": money_queue(attention.items),
        "queue_total": len(attention.items),
        "soon": money_soon(upcoming),
        "stats": [
            Stat(
                code="spent_month_to_date",
                value=categories.display.spent,
                compare=Compare(
                    code="previous_to_date", value=categories.display.previous_to_date_spent
                ),
                facts={
                    "currency": display.currency,
                    "complete": categories.display.complete,
                    "month": categories.month,
                    "previous_to_date_day": None
                    if categories.previous_to_date_day is None
                    else categories.previous_to_date_day.isoformat(),
                },
            ),
            Stat(
                code="due_in_14_days",
                value=upcoming.display.total,
                compare=None,
                facts={
                    "currency": display.currency,
                    "complete": upcoming.display.complete,
                    "confirmed_by_bank": await _confirmed_amount(session, upcoming),
                    "count": len([i for i in upcoming.items if not i.overdue]),
                },
            ),
        ],
        "breakdown": Breakdown(
            code="spent_by_category",
            rows=[
                Row(
                    key=line.category,
                    value=line.spent,
                    label=None,
                    facts={
                        "previous": line.previous,
                        "previous_to_date": line.previous_to_date,
                        "converted": line.converted,
                        "currency": display.currency,
                    },
                )
                for line in shown
            ],
            insight=category_insight(categories),
        ),
        "today": _connection_rows(accounts, links, now),
    }


# ---- the entry point --------------------------------------------------------------------------


async def queue_total(
    session: AsyncSession, scope: str, now: datetime, zone: tzinfo, display_currency: str = "GBP"
) -> int:
    """How many items qualify for a page's queue right now (without building the whole page)."""
    if scope not in SCOPES:
        raise invalid_scope()
    today = now.astimezone(zone).date()
    if scope == "money":
        display = await finance_service.display_for(session, display_currency, now)
        return len((await recurring_service.attention(session, now, zone, display)).items)
    tasks = await _open_tasks(session, scope)
    rule = {"personal": personal_queue, "work-1": work1_queue}.get(scope, work2_queue)
    return rule(tasks, today, now)[1]


@guarded
async def build(
    session: AsyncSession,
    scope: str,
    now: datetime,
    zone: tzinfo,
    display_currency: str = "GBP",
    assistant_enabled: bool = False,
) -> TodayPageOut:
    """Everything the Today view of one page shows. An unknown scope is 422."""
    if scope not in SCOPES:
        raise invalid_scope()
    today = now.astimezone(zone).date()
    if scope == "money":
        parts = await _money(session, now, zone, today, display_currency)
    elif scope == "personal":
        parts = await _personal(session, now, zone, today)
    elif scope == "work-1":
        parts = await _work1(session, now, zone, today)
    else:
        parts = await _work2(session, now, zone, today)
    await record(session, scope, today, parts["queue_total"], now)
    return TodayPageOut(
        scope=scope,  # type: ignore[arg-type]
        date=today,
        generated_at=now,
        streak=await current(session, scope, today),
        assistant=Assistant(enabled=assistant_enabled and scope != "work-2"),
        **parts,
    )
