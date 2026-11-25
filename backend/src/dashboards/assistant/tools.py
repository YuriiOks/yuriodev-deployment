"""The tools the assistant may call: the same service functions the MCP tools call, with the page's
scope fixed by the server (no tool takes a `space` or a scope: the model cannot widen it).

- `personal` and `work-1`: that space's tasks and events (`today`, `list_tasks`, `list_events`)
  and, with an owner's confirmation, `add_task`, `update_task`, `complete_task`, `reopen_task`,
  `add_event`;
- `money`: the finance reads (`today`, `finance_accounts`, `finance_balances`,
  `finance_transactions`, `finance_categories`, `finance_recurring`, `upcoming`, `attention`) and,
  with a confirmation, `set_category`, `attention_action`, `mark_paid`.

`work-2` has no tools at all, and no tool of another scope can reach it: every query names the
scope's own space. A tool returns plain data (what the service returned, as JSON); everything
that goes back to the model passes `scrub` first.
"""

import json
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, tzinfo
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from src.dashboards import service as dashboards_service
from src.dashboards import streak
from src.dashboards import today as page
from src.dashboards.catalog import TaskStatusFilter
from src.dashboards.finance import recurring_service
from src.dashboards.finance import service as finance_service
from src.dashboards.finance.categories import CATEGORIES
from src.dashboards.finance.models import Recurring, Transaction
from src.dashboards.finance.recurring_schemas import RecurringOut
from src.dashboards.finance.schemas import (
    AccountOut,
    TransactionOut,
    provider_totals,
)
from src.dashboards.models import Task
from src.dashboards.runtime import DashboardsRuntime, session_scope
from src.dashboards.schemas import EventCreate, EventOut, TaskCreate, TaskOut, TaskPatch

MAX_RESULT_CHARS = 40_000
SPACES = ("personal", "work-1")
SECRET_KEY = re.compile(r"token|secret|password|passwd|authorization|api_?key|iban|pan\b", re.I)


type Runner = Callable[[Ctx, dict[str, Any]], Awaitable[Any]]
type Confirmer = Callable[[Ctx, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class Ctx:
    runtime: DashboardsRuntime
    scope: str
    now: datetime
    zone: tzinfo
    display_currency: str


class ToolFailed(Exception):
    """A tool could not do what was asked; `message` is a fixed sentence for the model."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    schema: dict[str, Any]
    write: bool
    run: Runner
    # For a write: what the owner is asked to confirm, as data (subject and changes).
    confirm: Confirmer | None = None

    def definition(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.schema}


def scrub(value: Any) -> Any:
    """What may go to the model: no key that looks like a secret, nothing beyond the data."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if not SECRET_KEY.search(str(k))}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def render(value: Any) -> str:
    """A tool result as the text the model reads (scrubbed, capped)."""
    text = json.dumps(scrub(value), separators=(",", ":"), ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        return text[:MAX_RESULT_CHARS] + " [truncated]"
    return text


def _object(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _checked[A: BaseModel](model: type[A], args: dict[str, Any]) -> A:
    try:
        return model.model_validate(args)
    except ValidationError as exc:
        names = sorted({str(e["loc"][0]) for e in exc.errors() if e.get("loc")})
        raise ToolFailed("Invalid arguments: " + ", ".join(names or ["input"])) from None


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise ToolFailed("Invalid id") from None


# ---- spaces -----------------------------------------------------------------------------------


class ListTasksArgs(_Args):
    status: TaskStatusFilter = "open"


class ListEventsArgs(_Args):
    from_date: date
    to_date: date


class AddTaskArgs(_Args):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None
    priority: bool = False


class UpdateTaskArgs(_Args):
    id: str
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None
    priority: bool | None = None


class TaskIdArgs(_Args):
    id: str


class AddEventArgs(_Args):
    title: str = Field(min_length=1, max_length=300)
    starts_at: AwareDatetime
    ends_at: AwareDatetime


async def _own_task(session: Any, ctx: Ctx, task_id: str) -> Any:
    task = await session.get(Task, _uuid(task_id))
    if task is None or task.space_id != ctx.scope:  # another space's task does not exist here
        raise ToolFailed("Task not found")
    return task


async def _page(ctx: Ctx, _: dict[str, Any]) -> Any:
    async with session_scope(ctx.runtime) as session:
        out = await page.build(session, ctx.scope, ctx.now, ctx.zone, ctx.display_currency)
    return out.model_dump(mode="json")


async def _list_tasks(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(ListTasksArgs, args)
    async with session_scope(ctx.runtime) as session:
        tasks = await dashboards_service.list_tasks(session, ctx.scope, wanted.status)
    return [TaskOut.model_validate(t).model_dump(mode="json") for t in tasks[:100]]


async def _list_events(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(ListEventsArgs, args)
    async with session_scope(ctx.runtime) as session:
        events = await dashboards_service.list_events(
            session, wanted.from_date, wanted.to_date, ctx.zone
        )
    mine = [e for e in events if e.space_id == ctx.scope]
    return [EventOut.model_validate(e).model_dump(mode="json") for e in mine[:100]]


async def _add_task(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(AddTaskArgs, args)
    data = TaskCreate(**wanted.model_dump(exclude_none=True))
    async with session_scope(ctx.runtime) as session:
        task = await dashboards_service.create_task(session, ctx.scope, data, "mcp", ctx.now)
        out = TaskOut.model_validate(task).model_dump(mode="json")
    return out


async def _confirm_add_task(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    wanted = _checked(AddTaskArgs, args)
    return {
        "action": "add_task",
        "subject": {"type": "task", "id": None, "name": wanted.title},
        "changes": {
            "title": wanted.title,
            "notes": wanted.notes,
            "due_date": None if wanted.due_date is None else wanted.due_date.isoformat(),
            "priority": wanted.priority,
        },
    }


async def _update_task(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(UpdateTaskArgs, args)
    fields = wanted.model_dump(exclude={"id"}, exclude_unset=True)
    async with session_scope(ctx.runtime) as session:
        await _own_task(session, ctx, wanted.id)
        task = await dashboards_service.update_task(
            session, wanted.id, TaskPatch(**fields), ctx.now
        )
        return TaskOut.model_validate(task).model_dump(mode="json")


async def _confirm_update_task(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    wanted = _checked(UpdateTaskArgs, args)
    async with session_scope(ctx.runtime) as session:
        task = await _own_task(session, ctx, wanted.id)
        name = task.title
    changes = wanted.model_dump(exclude={"id"}, exclude_unset=True, mode="json")
    return {
        "action": "update_task",
        "subject": {"type": "task", "id": wanted.id, "name": name},
        "changes": changes,
    }


def _status_tool(status: Literal["done", "open"]) -> Runner:
    async def run(ctx: Ctx, args: dict[str, Any]) -> Any:
        wanted = _checked(TaskIdArgs, args)
        async with session_scope(ctx.runtime) as session:
            await _own_task(session, ctx, wanted.id)
            task = await dashboards_service.update_task(
                session, wanted.id, TaskPatch(status=status), ctx.now
            )
            out = TaskOut.model_validate(task).model_dump(mode="json")
            if status == "done":
                await streak.note(session, ctx.scope, ctx.now, ctx.zone, ctx.display_currency)
        return out

    return run


def _confirm_status(action: str, status: str) -> Confirmer:
    async def confirm(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
        wanted = _checked(TaskIdArgs, args)
        async with session_scope(ctx.runtime) as session:
            task = await _own_task(session, ctx, wanted.id)
            name = task.title
        return {
            "action": action,
            "subject": {"type": "task", "id": wanted.id, "name": name},
            "changes": {"status": status},
        }

    return confirm


async def _add_event(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(AddEventArgs, args)
    try:
        data = EventCreate(title=wanted.title, starts_at=wanted.starts_at, ends_at=wanted.ends_at)
    except ValidationError:
        raise ToolFailed("The event must end after it starts") from None
    async with session_scope(ctx.runtime) as session:
        event = await dashboards_service.create_event(session, ctx.scope, data, "mcp", ctx.now)
        return EventOut.model_validate(event).model_dump(mode="json")


async def _confirm_add_event(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    """Exactly what will be stored: the title, the instants in UTC as the API keeps them, and the
    same in the dashboard's own zone, and whether it is in the past."""
    wanted = _checked(AddEventArgs, args)
    if wanted.ends_at <= wanted.starts_at:
        raise ToolFailed("The event must end after it starts")
    start, end = wanted.starts_at.astimezone(ctx.zone), wanted.ends_at.astimezone(ctx.zone)
    return {
        "action": "add_event",
        "subject": {"type": "event", "id": None, "name": wanted.title},
        "changes": {
            "title": wanted.title,
            "starts_at": wanted.starts_at.astimezone(ctx.now.tzinfo).isoformat(),
            "ends_at": wanted.ends_at.astimezone(ctx.now.tzinfo).isoformat(),
            "local_date": start.date().isoformat(),
            "local_start": start.strftime("%H:%M"),
            "local_end": end.strftime("%H:%M"),
            "local_end_date": end.date().isoformat(),
            "in_the_past": wanted.ends_at <= ctx.now,
        },
    }


# ---- money ------------------------------------------------------------------------------------


class TransactionsArgs(_Args):
    query: str | None = Field(default=None, max_length=100)
    from_date: date | None = None
    to_date: date | None = None
    min_amount: int | None = None
    max_amount: int | None = None
    category: str | None = None
    limit: int = Field(default=30, ge=1, le=50)


class MonthArgs(_Args):
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class DaysArgs(_Args):
    days: int = Field(default=14, ge=1, le=60)


class SetCategoryArgs(_Args):
    id: str
    category: str | None = None


class AttentionActionArgs(_Args):
    key: str = Field(min_length=1, max_length=200)
    action: Literal["dismiss", "snooze", "restore", "accept"]
    days: int | None = Field(default=None, ge=1, le=90)


class MarkPaidArgs(_Args):
    id: str
    due_date: date | None = None


async def _display(session: Any, ctx: Ctx) -> Any:
    return await finance_service.display_for(session, ctx.display_currency, ctx.now)


async def _accounts(ctx: Ctx, _: dict[str, Any]) -> Any:
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        accounts, _links, oldest = await finance_service.list_accounts(session)
        shown = [AccountOut.from_row(a, oldest.get(a.id), display) for a in accounts]
    return {
        "accounts": [a.model_dump(mode="json") for a in shown],
        "providers": [t.model_dump(mode="json") for t in provider_totals(shown)],
    }


async def _balances(ctx: Ctx, _: dict[str, Any]) -> Any:
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        out = await finance_service.summary(session, ctx.now, ctx.zone, display)
    return out.model_dump(mode="json")


async def _transactions(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(TransactionsArgs, args)
    flt = finance_service.TransactionFilter(
        None,
        wanted.from_date,
        wanted.to_date,
        wanted.query,
        wanted.min_amount,
        wanted.max_amount,
        wanted.category,
    )
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        rows, _next = await finance_service.list_transactions(
            session, flt, ctx.zone, wanted.limit, None
        )
        return [TransactionOut.from_row(r, display).model_dump(mode="json") for r in rows]


async def _categories(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(MonthArgs, args)
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        out = await finance_service.categories_report(
            session, wanted.month, ctx.now, ctx.zone, display
        )
    return out.model_dump(mode="json")


async def _recurring(ctx: Ctx, _: dict[str, Any]) -> Any:
    today = ctx.now.astimezone(ctx.zone).date()
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        rows = await recurring_service.list_recurring(session, ctx.now, ctx.zone, True)
        return [RecurringOut.from_row(r, display, today).model_dump(mode="json") for r in rows]


async def _upcoming(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(DaysArgs, args)
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        out = await recurring_service.upcoming(session, ctx.now, ctx.zone, display, wanted.days)
    return out.model_dump(mode="json")


async def _attention(ctx: Ctx, _: dict[str, Any]) -> Any:
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        out = await recurring_service.attention(session, ctx.now, ctx.zone, display)
    return out.model_dump(mode="json")


async def _set_category(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(SetCategoryArgs, args)
    if wanted.category is not None and wanted.category not in CATEGORIES:
        raise ToolFailed("Invalid category")
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        row = await finance_service.set_category(session, _uuid(wanted.id), wanted.category)
        return TransactionOut.from_row(row, display).model_dump(mode="json")


async def _confirm_set_category(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    wanted = _checked(SetCategoryArgs, args)
    async with session_scope(ctx.runtime) as session:
        row = await session.get(Transaction, _uuid(wanted.id))
        if row is None:
            raise ToolFailed("Transaction not found")
        name = row.counterparty or row.description
        before = row.category_override or row.category
    return {
        "action": "set_category",
        "subject": {"type": "transaction", "id": wanted.id, "name": name},
        "changes": {"category": wanted.category, "was": before},
    }


async def _attention_action(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(AttentionActionArgs, args)
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        _items, missing, accepted = await recurring_service.set_attention_states(
            session, ctx.now, ctx.zone, display, [wanted.key], wanted.action, wanted.days
        )
    if missing:
        raise ToolFailed("That item is not in the queue (any more)")
    return {"done": wanted.action, "key": wanted.key, "accepted": accepted}


async def _confirm_attention_action(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    wanted = _checked(AttentionActionArgs, args)
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        out = await recurring_service.attention(session, ctx.now, ctx.zone, display, True)
    item = next((i for i in out.items if i.key == wanted.key), None)
    if item is None:
        raise ToolFailed("That item is not in the queue (any more)")
    return {
        "action": "attention_" + wanted.action,
        "subject": {
            "type": item.subject_type,
            "id": str(item.subject_id),
            "name": item.subject_name,
        },
        "changes": {"key": wanted.key, "kind": item.kind, "days": wanted.days},
    }


async def _mark_paid(ctx: Ctx, args: dict[str, Any]) -> Any:
    wanted = _checked(MarkPaidArgs, args)
    today = ctx.now.astimezone(ctx.zone).date()
    async with session_scope(ctx.runtime) as session:
        display = await _display(session, ctx)
        row = await recurring_service.mark_paid(
            session, _uuid(wanted.id), ctx.now, ctx.zone, None, wanted.due_date
        )
        return RecurringOut.from_row(row, display, today).model_dump(mode="json")


async def _confirm_mark_paid(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    wanted = _checked(MarkPaidArgs, args)
    async with session_scope(ctx.runtime) as session:
        row = await session.get(Recurring, _uuid(wanted.id))
        if row is None:
            raise ToolFailed("Payment not found")
        name, due = row.name, row.next_payment_date
    return {
        "action": "mark_paid",
        "subject": {"type": "payment", "id": wanted.id, "name": name},
        "changes": {"due_date": None if due is None else due.isoformat()},
    }


def _read(name: str, description: str, schema: dict[str, Any], run: Runner) -> Tool:
    return Tool(name, description, schema, False, run)


def _write(
    name: str,
    description: str,
    schema: dict[str, Any],
    run: Runner,
    confirm: Confirmer,
) -> Tool:
    return Tool(name, description, schema, True, run, confirm)


NONE = _object({})
TODAY_TOOL = _read(
    "today",
    "The whole Today view of this page: headline facts, the queue of up to three decisions, "
    "what is coming soon, two stats, a breakdown with an insight and today's rows.",
    NONE,
    _page,
)


def _space_tools() -> list[Tool]:
    task_id = _object({"id": {"type": "string", "description": "A task id"}}, ["id"])
    return [
        TODAY_TOOL,
        _read(
            "list_tasks",
            "List this page's tasks. status is open (default), done or all; open ones come first "
            "(priority, due date, oldest).",
            _object({"status": {"type": "string", "enum": ["open", "done", "all"]}}),
            _list_tasks,
        ),
        _read(
            "list_events",
            "List this page's calendar events between two days (both included, YYYY-MM-DD, at most "
            "62 days).",
            _object(
                {
                    "from_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "YYYY-MM-DD"},
                },
                ["from_date", "to_date"],
            ),
            _list_events,
        ),
        _write(
            "add_task",
            "Add a task to this page. The owner confirms before it is created.",
            _object(
                {
                    "title": {"type": "string"},
                    "notes": {"type": "string"},
                    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "priority": {"type": "boolean"},
                },
                ["title"],
            ),
            _add_task,
            _confirm_add_task,
        ),
        _write(
            "update_task",
            "Change a task's title, notes, due date or priority. The owner confirms first.",
            _object(
                {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "notes": {"type": "string"},
                    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "priority": {"type": "boolean"},
                },
                ["id"],
            ),
            _update_task,
            _confirm_update_task,
        ),
        _write(
            "complete_task",
            "Mark a task done. The owner confirms first.",
            task_id,
            _status_tool("done"),
            _confirm_status("complete_task", "done"),
        ),
        _write(
            "reopen_task",
            "Mark a done task open again. The owner confirms first.",
            task_id,
            _status_tool("open"),
            _confirm_status("reopen_task", "open"),
        ),
        _write(
            "add_event",
            "Add a calendar event to this page: title and start and end as ISO 8601 with a UTC "
            "offset. The owner confirms the exact title, date and times first.",
            _object(
                {
                    "title": {"type": "string"},
                    "starts_at": {"type": "string", "description": "ISO 8601 with offset"},
                    "ends_at": {"type": "string", "description": "ISO 8601 with offset"},
                },
                ["title", "starts_at", "ends_at"],
            ),
            _add_event,
            _confirm_add_event,
        ),
    ]


def _money_tools() -> list[Tool]:
    return [
        TODAY_TOOL,
        _read(
            "finance_accounts",
            "The bank accounts with balances (minor units and the display currency), the state of "
            "each connection and a total per provider.",
            NONE,
            _accounts,
        ),
        _read("finance_balances", "This month's totals per currency and overall.", NONE, _balances),
        _read(
            "finance_transactions",
            "Search transactions, newest first (at most 50). query matches the description or "
            "payee; amounts are signed minor units (money out is negative).",
            _object(
                {
                    "query": {"type": "string"},
                    "from_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "min_amount": {"type": "integer"},
                    "max_amount": {"type": "integer"},
                    "category": {"type": "string", "enum": list(CATEGORIES)},
                    "limit": {"type": "integer"},
                }
            ),
            _transactions,
        ),
        _read(
            "finance_categories",
            "Money out per category for a month (YYYY-MM, default this month) beside the month "
            "before.",
            _object({"month": {"type": "string", "description": "YYYY-MM"}}),
            _categories,
        ),
        _read("finance_recurring", "The owner's active recurring payments.", NONE, _recurring),
        _read(
            "upcoming",
            "The payments due in the next days (counting today), and whether the paying account "
            "covers each.",
            _object({"days": {"type": "integer"}}),
            _upcoming,
        ),
        _read("attention", "The attention items, in their order.", NONE, _attention),
        _write(
            "set_category",
            "Set the owner's category of one transaction (null clears it). The owner confirms "
            "first.",
            _object(
                {
                    "id": {"type": "string"},
                    "category": {"type": ["string", "null"], "enum": [*CATEGORIES, None]},
                },
                ["id"],
            ),
            _set_category,
            _confirm_set_category,
        ),
        _write(
            "attention_action",
            "Dismiss, snooze (days 1 to 90), restore or accept (a changed amount) one attention "
            "item by its key. The owner confirms first.",
            _object(
                {
                    "key": {"type": "string"},
                    "action": {
                        "type": "string",
                        "enum": ["dismiss", "snooze", "restore", "accept"],
                    },
                    "days": {"type": "integer"},
                },
                ["key", "action"],
            ),
            _attention_action,
            _confirm_attention_action,
        ),
        _write(
            "mark_paid",
            "Say a recurring payment was paid (its next date moves on). due_date names the "
            "occurrence. The owner confirms first.",
            _object({"id": {"type": "string"}, "due_date": {"type": "string"}}, ["id"]),
            _mark_paid,
            _confirm_mark_paid,
        ),
    ]


def tools_for(scope: str) -> dict[str, Tool]:
    """The tools of one page, by name. `work-2` (and anything unknown) has none."""
    if scope in SPACES:
        found = _space_tools()
    elif scope == "money":
        found = _money_tools()
    else:
        found = []
    return {tool.name: tool for tool in found}
