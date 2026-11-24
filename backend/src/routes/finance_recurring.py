"""Recurring payments, upcoming and attention, under /api/dashboards/v1/finance.

Behind the same gate as the rest of the dashboards API. These are the owner's own notes (nothing
is sent to a bank): payments he enters by hand, the dates they move to once a matching
transaction is seen, and what he did with an attention item.
"""

from datetime import date
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.core.errors import AppError
from src.dashboards.finance import recurring_service as service
from src.dashboards.finance.fx import Display
from src.dashboards.finance.recurring import (
    MAX_CSV_BYTES,
    MAX_ROWS,
    Kind,
    RecurringIn,
    RecurringPatch,
    parse_csv,
)
from src.dashboards.finance.recurring_schemas import (
    AttentionBulkOut,
    AttentionItem,
    AttentionOut,
    ImportOut,
    RecurringListOut,
    RecurringOut,
    UpcomingOut,
)
from src.dashboards.finance.schemas import DisplayOut, display_fields
from src.dashboards.finance.service import display_for
from src.routes.dashboards import ClockDep, SessionDep, SettingsDep, ZoneDep

router = APIRouter(prefix="/api/dashboards/v1/finance", tags=["finance"])
MAX_BULK_KEYS = 200


def _today(clock: ClockDep, zone: ZoneDep) -> date:
    return clock().astimezone(zone).date()


async def _display(session: SessionDep, settings: SettingsDep, clock: ClockDep) -> Display:
    return await display_for(session, settings.finance_display_currency, clock())


@router.get("/recurring")
async def list_recurring(
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    active: Annotated[bool | None, Query()] = None,
    kind: Annotated[Kind | None, Query()] = None,
) -> RecurringListOut:
    """The recurring payments (active first, then by next date), each also in the display
    currency at the latest rate."""
    display = await _display(session, settings, clock)
    rows = await service.list_recurring(session, clock(), zone, active, kind)
    return RecurringListOut(
        recurring=[RecurringOut.from_row(row, display, _today(clock, zone)) for row in rows],
        display=DisplayOut(**display_fields(display, {row.currency for row in rows})),
    )


@router.post("/recurring", status_code=201)
async def create_recurring(
    body: RecurringIn, session: SessionDep, settings: SettingsDep, clock: ClockDep, zone: ZoneDep
) -> RecurringOut:
    today = _today(clock, zone)
    row = await service.create_recurring(session, body, clock(), today)
    display = await _display(session, settings, clock)
    return RecurringOut.from_row(row, display, today)


class BulkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[dict[str, Any]] = Field(max_length=MAX_ROWS)
    on_conflict: Literal["skip", "update"] = "skip"
    dry_run: bool = False


def _answer(result: ImportOut, clean: bool) -> Response:
    """The answer of a load: 200 when clean, 422 with the same body (every error) otherwise."""
    return JSONResponse(result.model_dump(mode="json"), status_code=200 if clean else 422)


@router.post("/recurring/bulk", response_model=ImportOut)
async def bulk_recurring(
    body: BulkIn, session: SessionDep, settings: SettingsDep, clock: ClockDep, zone: ZoneDep
) -> Response:
    """Create many payments in one go (at most 500), all or nothing: with any error nothing is
    written and the answer lists every row's problems. A row with an `external_ref` that already
    exists is skipped, or replaced with `on_conflict: "update"`; `dry_run` checks only."""
    inputs, errors = service.validate_items(body.items)
    display = await _display(session, settings, clock)
    result, clean = await service.load_recurring(
        session,
        inputs,
        errors,
        [],
        clock(),
        _today(clock, zone),
        display,
        body.on_conflict,
        body.dry_run,
    )
    return _answer(result, clean)


@router.post("/recurring/import", response_model=ImportOut)
async def import_recurring(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    on_conflict: Annotated[Literal["skip", "update"], Query()] = "skip",
    dry_run: Annotated[bool, Query()] = False,
) -> Response:
    """Import a CSV file (the request body, UTF-8, a header row, at most 500 rows and 1 MiB).
    Columns: name, amount (a decimal such as 12.99), currency, frequency, frequency_interval,
    start_date, next_payment_date (YYYY-MM-DD), payment_type, payment_mode, category, notes,
    is_active, payment_method, reminder_days, icon_url, color, auto_renew, is_installment,
    total_installments, completed_installments, total_owed, remaining_balance, creditor,
    target_amount, current_saved, recipient; also kind, match_text and external_ref. Other
    columns are ignored and named in the answer. All or nothing, like `bulk`."""
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_CSV_BYTES:
            raise AppError(413, "payload_too_large", "The file is too large")
    try:
        text = bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        raise AppError(422, "validation_error", "The file must be UTF-8") from None
    inputs, errors, ignored = parse_csv(text)
    display = await _display(session, settings, clock)
    result, clean = await service.load_recurring(
        session,
        inputs,
        errors,
        ignored,
        clock(),
        _today(clock, zone),
        display,
        on_conflict,
        dry_run,
    )
    return _answer(result, clean)


@router.get("/recurring/{recurring_id}")
async def get_recurring(
    recurring_id: UUID,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> RecurringOut:
    row = await service.get_recurring(session, recurring_id, clock(), zone)
    display = await _display(session, settings, clock)
    return RecurringOut.from_row(row, display, _today(clock, zone))


@router.patch("/recurring/{recurring_id}")
async def update_recurring(
    recurring_id: UUID,
    body: RecurringPatch,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> RecurringOut:
    """Change the fields sent; `null` clears a field that may be empty."""
    row = await service.update_recurring(session, recurring_id, body, clock())
    display = await _display(session, settings, clock)
    return RecurringOut.from_row(row, display, _today(clock, zone))


@router.delete("/recurring/{recurring_id}", status_code=204)
async def delete_recurring(recurring_id: UUID, session: SessionDep) -> Response:
    await service.delete_recurring(session, recurring_id)
    return Response(status_code=204)


class PaidIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paid_on: date | None = None  # the day it was paid (default today)
    # The due date being paid (the `next_payment_date` the page showed): when the payment has
    # moved on since, nothing is done and the answer is 409, so a second click pays nothing.
    due_date: date | None = None


@router.post("/recurring/{recurring_id}/paid")
async def mark_paid(
    recurring_id: UUID,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    body: PaidIn | None = None,
) -> RecurringOut:
    """The owner says this one was paid: the next date moves on one step (a payment that happens
    once ends). Use it for a payment that cannot be matched to a transaction. Send `due_date` so
    a repeated request is refused (409) instead of paying the next occurrence too."""
    paid_on, due_date = (body.paid_on, body.due_date) if body else (None, None)
    row = await service.mark_paid(session, recurring_id, clock(), zone, paid_on, due_date)
    display = await _display(session, settings, clock)
    return RecurringOut.from_row(row, display, _today(clock, zone))


@router.get("/upcoming")
async def upcoming(
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    days: Annotated[int, Query(ge=1, le=service.MAX_UPCOMING_DAYS)] = 14,
) -> UpcomingOut:
    """The payments due from today to `days` days ahead (default 14), each also in the display
    currency, and whether the paying account covers it."""
    display = await _display(session, settings, clock)
    return await service.upcoming(session, clock(), zone, display, days)


@router.get("/attention")
async def attention(
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    include_hidden: Annotated[bool, Query()] = False,
) -> AttentionOut:
    """What needs a look now. Dismissed and snoozed items are left out (counted in `hidden`)
    unless `include_hidden` is true."""
    display = await _display(session, settings, clock)
    return await service.attention(session, clock(), zone, display, include_hidden)


class AttentionKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=200)


class AttentionSnooze(AttentionKey):
    days: int = Field(strict=True, ge=1, le=service.MAX_SNOOZE_DAYS)


class AttentionBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        min_length=1, max_length=MAX_BULK_KEYS
    )
    action: Literal["dismiss", "snooze", "restore"]
    days: int | None = Field(default=None, strict=True, ge=1, le=service.MAX_SNOOZE_DAYS)

    @model_validator(mode="after")
    def _days_only_for_snooze(self) -> Self:
        if (self.action == "snooze") != (self.days is not None):
            raise ValueError("days goes with snooze and only with it")
        return self


async def _state(
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
    key: str,
    action: Literal["dismiss", "snooze", "restore"],
    days: int | None = None,
) -> AttentionItem:
    display = await _display(session, settings, clock)
    return await service.set_attention_state(session, clock(), zone, display, key, action, days)


@router.post("/attention/dismiss")
async def dismiss(
    body: AttentionKey, session: SessionDep, settings: SettingsDep, clock: ClockDep, zone: ZoneDep
) -> AttentionItem:
    """Dismiss an item for good (its key names the occasion: a new occasion is a new item)."""
    return await _state(session, settings, clock, zone, body.key, "dismiss")


@router.post("/attention/snooze")
async def snooze(
    body: AttentionSnooze,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> AttentionItem:
    """Hide an item for 1 to 90 days."""
    return await _state(session, settings, clock, zone, body.key, "snooze", body.days)


@router.post("/attention/restore")
async def restore(
    body: AttentionKey, session: SessionDep, settings: SettingsDep, clock: ClockDep, zone: ZoneDep
) -> AttentionItem:
    """Bring a dismissed or snoozed item back."""
    return await _state(session, settings, clock, zone, body.key, "restore")


@router.post("/attention/bulk")
async def bulk_state(
    body: AttentionBulk,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> AttentionBulkOut:
    """Dismiss, snooze (`days`) or restore many items at once (at most 200 keys). Keys that are
    not an item right now are returned in `missing` and nothing is done for them."""
    display = await _display(session, settings, clock)
    items, missing = await service.set_attention_states(
        session, clock(), zone, display, body.keys, body.action, body.days
    )
    return AttentionBulkOut(items=items, missing=missing)
