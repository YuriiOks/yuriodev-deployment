"""Recurring payments, what is coming up and what needs attention.

The only things written are our own notes: the owner's recurring payments, the dates they move to
and what he did with an attention item. Nothing is ever sent to a bank. Every failure of the
database becomes 503 `dashboards_unavailable` through `guarded`.

Matching a payment to a transaction (`roll_forward`). A payment due on day D is paid when a
transaction exists that: is money out, not declined and not a move between the owner's accounts;
is in the payment's currency (or its original currency, for a card payment abroad); is on the
paying account when the payment names one; was booked from 3 days before D to 7 days after it
(local days); and whose counterparty or description names the payment
(`recurring.text_matches`: the name, or `match_text` when it is set, inside the text, both
reduced to lower-case letters and digits, or, without `match_text`, the counterparty inside the
name). The amount counts: lines within 1% of the recorded amount are the candidates first (the
closest in days wins, before or after D); a line of another amount is the payment only on or
after D and only when nothing is at the right amount, and is then raised as an attention item
(`amount_changed`). One transaction pays one payment once: the match is kept in
`finance.recurring_match`.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime, timedelta, tzinfo
from typing import Any, Literal

from pydantic import ValidationError
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.fx import Display
from src.dashboards.finance.models import (
    Account,
    AttentionState,
    Connection,
    Recurring,
    RecurringMatch,
    Transaction,
)
from src.dashboards.finance.recurring import (
    EARLY_DAYS,
    LATE_DAYS,
    NOT_EMPTY,
    RecurringIn,
    RecurringPatch,
    RowError,
    advance,
    amount_differs,
    anchor_of,
    first_on_or_after,
    frequency_of,
    grace_end,
    instalments_agree,
    last_installment_date,
    needs_a_date,
    occurrences,
    problem_row,
    schedule_state,
    text_matches,
)
from src.dashboards.finance.recurring_schemas import (
    AttentionItem,
    AttentionOut,
    ImportOut,
    RecurringOut,
    RowErrorOut,
    UpcomingDisplay,
    UpcomingItem,
    UpcomingOut,
    UpcomingTotal,
    shown_icon,
)
from src.dashboards.finance.schemas import (
    API_STALE_AFTER,
    API_STALE_HIGH_AFTER,
    DisplayOut,
    display_fields,
)
from src.dashboards.finance.service import day_start, invalid
from src.dashboards.service import guarded

DEFAULT_REMINDER_DAYS = 2
UPCOMING_LOOKAHEAD_DAYS = 90
MAX_UPCOMING_DAYS = 366
MAX_SNOOZE_DAYS = 90
STATE_KEEP = timedelta(days=90)
CATCH_UP_LIMIT = 24  # occurrences handled for one payment in one pass
CREDIT_HIGH_PERCENT = 90
FRESH_DAYS = 60  # a charge found while catching up on old dates is not news
CONDITION_KEYS = ("credit_high:", "overdraft:", "overdrawn:")  # keys of a state of an account
ORDER = (
    "due_not_covered",
    "missed_payment",
    "amount_changed",
    "credit_high",
    "overdraft",
    "overdrawn",
    "reconsent",
    "stale_statement",
    "stale_connection",
)
# How much an item matters, so a page can order and summarise without knowing the kinds.
SEVERITY = {
    "due_not_covered": "high",
    "missed_payment": "high",
    "overdraft": "high",
    "reconsent": "high",
    "amount_changed": "medium",
    "credit_high": "medium",
    "stale_statement": "medium",
    "stale_connection": "medium",
    "overdrawn": "info",
}
SEVERITY_RANK = {"high": 0, "medium": 1, "info": 2}
STATEMENT_STALE_AFTER = timedelta(days=30)


def _not_found() -> AppError:
    return AppError(404, "not_found", "Recurring payment not found")


def _today(now: datetime, zone: tzinfo) -> date:
    return now.astimezone(zone).date()


def overdraft_in_force(account: Account) -> int | None:
    owner = account.overdraft_limit_override
    return account.overdraft_limit if owner is None else owner


async def _check_accounts(session: AsyncSession, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    """The ids among `ids` that are not accounts of ours."""
    if not ids:
        return set()
    known = set(await session.scalars(select(Account.id).where(Account.id.in_(ids))))
    return ids - known


# ---- create, read, change -----------------------------------------------------------------------


@guarded
async def list_recurring(
    session: AsyncSession,
    now: datetime,
    zone: tzinfo,
    active: bool | None = None,
    kind: str | None = None,
) -> Sequence[Recurring]:
    """The payments, active first then by next date, after moving on the ones that were paid."""
    await roll_forward(session, now, zone)
    query = select(Recurring).order_by(
        Recurring.is_active.desc(),
        Recurring.next_payment_date.asc().nulls_last(),
        Recurring.name,
        Recurring.id,
    )
    if active is not None:
        query = query.where(Recurring.is_active.is_(active))
    if kind is not None:
        query = query.where(Recurring.kind == kind)
    return (await session.scalars(query)).all()


@guarded
async def get_recurring(
    session: AsyncSession, recurring_id: uuid.UUID, now: datetime, zone: tzinfo
) -> Recurring:
    await roll_forward(session, now, zone)
    row = await session.get(Recurring, recurring_id)
    if row is None:
        raise _not_found()
    return row


def _values(data: RecurringIn, today: date) -> dict[str, Any]:
    """The columns of a new payment. A repeating payment with a start date and no next date gets
    its first occurrence from today on; the day its dates keep is remembered."""
    values = data.model_dump()
    frequency = frequency_of(data.kind, data.frequency)
    following, start = data.next_payment_date, data.start_date
    if following is None and start is not None and frequency != "once":
        anchor = start.day
        following = first_on_or_after(start, frequency, data.frequency_interval, anchor, today)
        values["next_payment_date"] = following
    base = start or following
    values["anchor_day"] = base.day if base is not None else None
    return values


@guarded
async def create_recurring(
    session: AsyncSession, data: RecurringIn, now: datetime, today: date
) -> Recurring:
    values = _values(data, today)
    if not instalments_agree(values):
        raise invalid("completed_installments cannot exceed total_installments")
    if await _check_accounts(session, {data.account_id} if data.account_id else set()):
        raise invalid("Unknown account")
    if data.external_ref is not None and await session.scalar(
        select(Recurring.id).where(Recurring.external_ref == data.external_ref)
    ):
        raise AppError(409, "conflict", "A payment with this reference exists")
    row = Recurring(**values, created_at=now, updated_at=now)
    session.add(row)
    await session.commit()
    return row


@guarded
async def update_recurring(
    session: AsyncSession, recurring_id: uuid.UUID, patch: RecurringPatch, now: datetime
) -> Recurring:
    row = await session.get(Recurring, recurring_id, with_for_update=True)
    if row is None:
        raise _not_found()
    changes = {name: getattr(patch, name) for name in patch.model_fields_set}
    if any(value is None and name in NOT_EMPTY for name, value in changes.items()):
        raise invalid("A required field cannot be cleared")
    merged = {
        "total_installments": changes.get("total_installments", row.total_installments),
        "completed_installments": changes.get("completed_installments", row.completed_installments),
    }
    if not instalments_agree(merged):
        raise invalid("completed_installments cannot exceed total_installments")
    account = changes.get("account_id")
    if account is not None and await _check_accounts(session, {account}):
        raise invalid("Unknown account")
    ref = changes.get("external_ref")
    if ref is not None and ref != row.external_ref:
        taken = await session.scalar(select(Recurring.id).where(Recurring.external_ref == ref))
        if taken:
            raise AppError(409, "conflict", "A payment with this reference exists")
    for name, value in changes.items():
        setattr(row, name, value)
    if needs_a_date(row.is_active, row.kind, row.frequency, row.start_date, row.next_payment_date):
        raise invalid("A repeating payment needs a next date or a start date")
    if "completed_installments" in changes:
        row.assumed_installments = 0  # his figure is the new starting point
    if changes.get("next_payment_date") is not None:
        row.anchor_day = changes["next_payment_date"].day  # he moved the date: it is the day now
    elif changes.get("start_date") is not None:
        row.anchor_day = changes["start_date"].day
    row.updated_at = now
    await session.commit()
    return row


@guarded
async def delete_recurring(session: AsyncSession, recurring_id: uuid.UUID) -> None:
    row = await session.get(Recurring, recurring_id)
    if row is None:
        raise _not_found()
    await session.delete(row)
    await session.commit()


def _anchor(row: Recurring, current: date) -> int:
    """The day of the month the payment's dates keep (31 stays 31 through February)."""
    return row.anchor_day or anchor_of(row.start_date, current)


def _following(row: Recurring, current: date) -> date | None:
    """The date after `current`, or None for a payment that happens once, or after the last
    instalment of a plan (a plan never runs past its last date)."""
    frequency = frequency_of(row.kind, row.frequency)
    following = advance(current, frequency, row.frequency_interval, _anchor(row, current))
    if following is None or not row.is_installment:
        return following
    last = last_installment_date(
        row.start_date, frequency, row.frequency_interval, row.total_installments
    )
    return None if last is not None and following > last else following


def _step(row: Recurring, end_once: bool = True) -> bool:
    """Move to the next date (True), or, with nothing after it, finish a payment that happens
    once (only when `end_once`: the owner or a matching line says it was paid). A plan at its
    last instalment stays there. Returns whether the date moved."""
    current = row.next_payment_date
    if current is None:
        return False
    following = _following(row, current)
    if following is None:
        if end_once and frequency_of(row.kind, row.frequency) == "once":
            row.is_active = False
        return False
    row.next_payment_date = following
    return True


def _confirm(row: Recurring, paid: int | None = None) -> None:
    """A payment is confirmed (by a matching line, whose amount is `paid`, or by the owner, when
    it is the recorded `amount`): the balance that is left of a debt goes down by it, and an
    instalment plan counts one more instalment."""
    if row.remaining_balance is not None:
        taken = row.amount if paid is None else paid
        row.remaining_balance = max(row.remaining_balance - taken, 0)
    if not row.is_installment:
        return
    total, done = row.total_installments, row.completed_installments
    if total is not None or done is not None:
        row.completed_installments = min((done or 0) + 1, total) if total else (done or 0) + 1


def _assume(row: Recurring) -> None:
    """An instalment was only passed by the schedule: nothing confirms it, so it is counted apart
    (at most up to the plan's total)."""
    if not row.is_installment:
        return
    total = row.total_installments
    if total is None or (row.completed_installments or 0) + row.assumed_installments < total:
        row.assumed_installments += 1


def _finish_by_schedule(row: Recurring) -> None:
    """The last instalment's date has passed unseen: by the schedule the plan is complete (the
    same figure however often this runs)."""
    total = row.total_installments
    if row.is_installment and total is not None:
        row.assumed_installments = max(
            row.assumed_installments, total - (row.completed_installments or 0)
        )


def _outcome(row: Recurring, symbol: str) -> None:
    """Remember what happened to a due date of a payment whose account we collect (the last
    three): "1" a line matched, "0" none did, "p" the owner said it was paid."""
    if row.account_id is not None:
        row.recent_outcomes = (row.recent_outcomes + symbol)[-3:]


@guarded
async def mark_paid(
    session: AsyncSession,
    recurring_id: uuid.UUID,
    now: datetime,
    zone: tzinfo,
    paid_on: date | None = None,
    due_date: date | None = None,
) -> Recurring:
    """The owner says it was paid: the next date moves on one step (a payment that happens once
    ends), and an instalment plan's confirmed count and balance move on with it. It is his word,
    not a match: it is no evidence. `due_date` names the occurrence that is paid: when the
    payment has moved on since (a second click, a retry) it is 409 and nothing changes. A plan
    that is complete counts nothing more."""
    row = await session.get(Recurring, recurring_id, with_for_update=True)
    if row is None:
        raise _not_found()
    if due_date is not None and row.next_payment_date != due_date:
        raise AppError(409, "conflict", "This payment has already moved on")
    total = row.total_installments
    complete = (
        row.is_installment
        and total is not None
        and total > 0
        and (row.completed_installments or 0) >= total
    )
    if not complete:
        _confirm(row)
    row.last_paid_on = paid_on or _today(now, zone)
    row.last_charged_amount = None  # an older match is no longer what he is looking at
    row.last_transaction_id = None
    if _step(row) or not complete:
        _outcome(row, "p")
    row.updated_at = now
    await session.commit()
    return row


# ---- bulk load ----------------------------------------------------------------------------------


def validate_items(raw: Sequence[Any]) -> tuple[list[tuple[int, RecurringIn]], list[RowError]]:
    """Every raw item as an input or as the errors of its row (rows count from 1)."""
    inputs: list[tuple[int, RecurringIn]] = []
    errors: list[RowError] = []
    for number, item in enumerate(raw, start=1):
        try:
            inputs.append((number, RecurringIn.model_validate(item)))
        except ValidationError as exc:
            errors.extend(problem_row(number, problem) for problem in exc.errors())
    return inputs, errors


@guarded
async def load_recurring(
    session: AsyncSession,
    inputs: Sequence[tuple[int, RecurringIn]],
    errors: Sequence[RowError],
    ignored: Sequence[str],
    now: datetime,
    today: date,
    display: Display,
    on_conflict: Literal["skip", "update"] = "skip",
    dry_run: bool = False,
) -> tuple[ImportOut, bool]:
    """Create (and with `update` replace) many payments in one transaction; any error at all
    writes nothing. A row with an `external_ref` that exists is skipped or replaced; rows without
    one are always created. Returns the answer and whether it is clean."""
    problems = list(errors)
    refs = [item.external_ref for _, item in inputs if item.external_ref]
    existing = {
        row.external_ref: row
        for row in await session.scalars(select(Recurring).where(Recurring.external_ref.in_(refs)))
    }
    wanted = {item.account_id for _, item in inputs if item.account_id}
    unknown = await _check_accounts(session, wanted)
    seen: set[str] = set()
    for number, item in inputs:
        if item.account_id in unknown:
            problems.append(RowError(number, "account_id", "unknown account", "unknown_account"))
        if not instalments_agree(item.model_dump()):
            message = "more than the total"
            problems.append(RowError(number, "completed_installments", message, "over_total"))
        if item.external_ref:
            if item.external_ref in seen:
                message = "the same reference twice"
                problems.append(RowError(number, "external_ref", message, "duplicate_reference"))
            seen.add(item.external_ref)
    created: list[Recurring] = []
    updated: list[Recurring] = []
    skipped = 0
    duplicates = 0
    if not problems:
        known = {
            (r.name.lower(), r.currency, r.amount, r.frequency, r.frequency_interval)
            for r in await session.scalars(select(Recurring))
        }
        for _, item in inputs:
            found = existing.get(item.external_ref) if item.external_ref else None
            if found is not None and on_conflict == "skip":
                skipped += 1
            elif found is not None:
                for name, value in _values(item, today).items():
                    setattr(found, name, value)
                found.assumed_installments = 0  # the file is the new starting point
                found.updated_at = now
                updated.append(found)
            else:
                same = (item.name.lower(), item.currency, item.amount)
                if (*same, item.frequency, item.frequency_interval) in known:
                    duplicates += 1  # probably loaded before, under another reference
                row = Recurring(**_values(item, today), created_at=now, updated_at=now)
                session.add(row)
                created.append(row)
        if dry_run:
            await session.rollback()
        else:
            await session.commit()
    rows = [] if dry_run else created + updated
    shown = [RecurringOut.from_row(r, display, today) for r in rows]
    answer = ImportOut(
        dry_run=dry_run,
        created=len(created),
        updated=len(updated),
        skipped=skipped,
        errors=[RowErrorOut.of(e) for e in problems],
        ignored_columns=list(ignored),
        probable_duplicates=duplicates,
        recurring=shown,
    )
    return answer, not problems


# ---- matching and rolling forward ---------------------------------------------------------------


def _paid_figure(row: Recurring, line: Transaction) -> int:
    """What a line paid in the payment's own currency: its amount, or, for a card payment abroad
    on an account in another currency, the original amount."""
    if line.currency == row.currency or line.original_amount is None:
        return -line.amount
    return abs(line.original_amount)


async def _match(
    session: AsyncSession,
    row: Recurring,
    due: date,
    zone: tzinfo,
    today: date,
    used: set[uuid.UUID],
) -> Transaction | None:
    """The line that paid the occurrence due on `due`, if there is one (see the module docstring
    for what qualifies). The amount counts: a line within 1% of the recorded amount wins, the
    closest in days first, and may be before the due date; a line of another amount is the
    payment only on or after the due date, once there is nothing at the right amount."""
    query = select(Transaction).where(
        Transaction.booked_at >= day_start(due - timedelta(days=EARLY_DAYS), zone),
        Transaction.booked_at < day_start(due + timedelta(days=LATE_DAYS + 1), zone),
        Transaction.amount < 0,
        Transaction.declined.is_(False),
        Transaction.internal_transfer.is_(False),
        or_(Transaction.currency == row.currency, Transaction.original_currency == row.currency),
    )
    if row.account_id is not None:
        query = query.where(Transaction.account_id == row.account_id)
    needle = row.match_text or row.name
    found = [
        t
        for t in (await session.scalars(query)).all()
        if t.id not in used
        and text_matches(needle, t.counterparty, t.description, reverse=row.match_text is None)
    ]

    def days(line: Transaction) -> int:
        return abs((line.booked_at.astimezone(zone).date() - due).days)

    exact = [t for t in found if not amount_differs(row.amount, _paid_figure(row, t))]
    if exact:
        return min(exact, key=lambda t: (days(t), str(t.id)))
    if today < due:
        return None
    later = [t for t in found if t.booked_at.astimezone(zone).date() >= due]
    if not later:
        return None
    return min(later, key=lambda t: (days(t), abs(_paid_figure(row, t) - row.amount), str(t.id)))


def _data_to(reach: dict[uuid.UUID, date | None], row: Recurring, day: date) -> bool:
    """Does the paying account's data go past `day`? A manual bank with no newer statement, or a
    link that is not working, shows nothing: no miss can be written for that time."""
    seen = reach.get(row.account_id) if row.account_id else None
    return seen is not None and seen >= day


@guarded
async def roll_forward(session: AsyncSession, now: datetime, zone: tzinfo) -> int:
    """Move the next date of every active payment past the occurrences that were paid.

    A due date is paid when a transaction matches it (`_match`); the match is written to
    `recurring_match`, so a line pays one payment once and a due date is settled once. A payment
    with a matching line rolls (its `last_paid_on`, `last_matched_on`, `last_charged_amount` and
    `last_transaction_id` are set). One whose paying account is not one we collect cannot be
    seen, so it rolls when its date has passed (and counts as assumed). One whose account we do
    collect and that has no matching line stays put until its next due date arrives, as a
    `missed_payment`; then the miss is written to its outcomes and it moves on (not as assumed:
    nothing assumes what the bank could have shown). Only the latest occurrence is looked up for
    a payment that is not collected. Idempotent; run before every read that shows dates. Returns
    how many payments moved."""
    today = _today(now, zone)
    rows = (
        await session.scalars(
            select(Recurring)
            .where(
                Recurring.is_active.is_(True),
                Recurring.next_payment_date.is_not(None),
                Recurring.next_payment_date <= today + timedelta(days=EARLY_DAYS),
            )
            .order_by(Recurring.next_payment_date, Recurring.name, Recurring.id)
            .with_for_update()
        )
    ).all()
    if not rows:
        return 0
    reach = await _reach(session, rows, zone)
    used: set[uuid.UUID] = set(await session.scalars(select(RecurringMatch.transaction_id)))
    settled: set[tuple[uuid.UUID, date]] = {
        (match.recurring_id, match.due_date)
        for match in await session.scalars(
            select(RecurringMatch).where(RecurringMatch.recurring_id.in_([r.id for r in rows]))
        )
    }
    moved = 0
    for row in rows:
        for _ in range(CATCH_UP_LIMIT):
            due = row.next_payment_date
            if due is None or not row.is_active or today < due - timedelta(days=EARLY_DAYS):
                break
            if (row.id, due) in settled:
                break  # a plan at its last instalment: this date was paid already
            following = _following(row, due)
            stale = following is not None and following <= today
            collected = row.account_id is not None
            if stale and not collected:
                _assume(row)  # more than one period ago and nobody can see it: rolled past
                _step(row)
                row.updated_at = now
                moved += 1
                continue
            found = await _match(session, row, due, zone, today, used)
            if found is not None:
                used.add(found.id)
                settled.add((row.id, due))
                session.add(
                    RecurringMatch(recurring_id=row.id, due_date=due, transaction_id=found.id)
                )
                row.last_paid_on = row.last_matched_on = found.booked_at.astimezone(zone).date()
                row.last_charged_amount = _paid_figure(row, found)
                row.last_transaction_id = found.id
                _confirm(row, _paid_figure(row, found))
                _outcome(row, "1")
            elif collected and stale and _data_to(reach, row, due + timedelta(days=LATE_DAYS)):
                _outcome(row, "0")  # the window is over and nothing came: a miss, remembered
            elif collected or today <= due:
                break  # waiting for a line, or not due yet
            elif following is None:
                _finish_by_schedule(row)  # the last date has passed and nobody can see it
                break
            else:
                _assume(row)  # nobody can see it: passed by the schedule
            progressed = _step(row)
            row.updated_at = now
            moved += 1
            if not progressed:
                break  # a payment that happens once, or a plan at its last instalment
    await session.commit()  # also ends the transaction that holds the row locks
    return moved


# ---- upcoming -----------------------------------------------------------------------------------


async def _occurrences(
    session: AsyncSession, today: date, end: date, display: Display
) -> list[tuple[UpcomingItem, Recurring]]:
    rows = (
        await session.scalars(
            select(Recurring).where(
                Recurring.is_active.is_(True), Recurring.next_payment_date.is_not(None)
            )
        )
    ).all()
    ids = {row.account_id for row in rows if row.account_id}
    accounts = {
        a.id: a for a in (await session.scalars(select(Account).where(Account.id.in_(ids)))).all()
    }
    entries: list[tuple[date, Recurring]] = []
    for row in rows:
        first = row.next_payment_date
        if first is None:
            continue
        frequency = frequency_of(row.kind, row.frequency)
        until, limit = end, 400
        if row.is_installment:  # a plan has no occurrence beyond its last instalment
            total = row.total_installments
            if total:
                limit = total - (row.completed_installments or 0) - row.assumed_installments
            last = last_installment_date(row.start_date, frequency, row.frequency_interval, total)
            if last is not None:
                until = min(until, last)
        anchor = _anchor(row, first)
        for day in occurrences(first, frequency, row.frequency_interval, anchor, until, limit):
            # An occurrence already due and not seen paid on an account we collect is still to be
            # taken from it: it is listed first (`overdue`) and counted against the account.
            if day >= today or (day == first and row.account_id is not None):
                entries.append((day, row))
    entries.sort(key=lambda entry: (entry[0], entry[1].name, str(entry[1].id)))
    room: dict[uuid.UUID, int] = {}
    found: list[tuple[UpcomingItem, Recurring]] = []
    for day, row in entries:
        covered: bool | None = None
        shortfall: int | None = None
        short_total: int | None = None
        account_currency: str | None = None
        account = accounts.get(row.account_id) if row.account_id else None
        if account is not None and not account.archived:
            account_currency = account.currency
            if account.id not in room:
                room[account.id] = account.balance + (overdraft_in_force(account) or 0)
            need = display.book.convert(row.amount, row.currency, account.currency)
            if need is not None:
                room[account.id] -= need
                covered = room[account.id] >= 0
                short_total = max(-room[account.id], 0)
                shortfall = min(need, short_total)
        item = UpcomingItem(
            recurring_id=row.id,
            name=row.name,
            kind=row.kind,  # type: ignore[arg-type]
            due_date=day,
            days_until=(day - today).days,
            amount=row.amount,
            currency=row.currency,
            display_amount=display.convert(row.amount, row.currency),
            converted=display.converted(row.currency),
            account_id=row.account_id,
            payment_method=row.payment_method,
            icon_url=row.icon_url,
            icon_data=shown_icon(row),
            color=row.color,
            covered=covered,
            shortfall=shortfall,
            account_short_total=short_total,
            account_currency=account_currency,
            overdue=day < today,
        )
        found.append((item, row))
    return found


@guarded
async def upcoming(
    session: AsyncSession, now: datetime, zone: tzinfo, display: Display, days: int
) -> UpcomingOut:
    """The payments due in `days` days counting today (today to today + days - 1: a weekly one
    appears each time), with whether the paying account covers each, counting the earlier ones of
    the window against the same account; one already due and not seen paid on an account we
    collect comes first, `overdue`, and counts in the totals and against the account. Nothing is
    assumed about money arriving in between. Totals per currency, each converted once, make the
    display total."""
    if not 1 <= days <= MAX_UPCOMING_DAYS:
        raise invalid("Invalid days")
    await roll_forward(session, now, zone)
    today = _today(now, zone)
    end = today + timedelta(days=days - 1)
    items = [item for item, _ in await _occurrences(session, today, end, display)]
    sums: dict[str, int] = {}
    for item in items:
        sums[item.currency] = sums.get(item.currency, 0) + item.amount
    totals: list[UpcomingTotal] = []
    grand = 0
    for currency, amount in sorted(sums.items()):
        shown = display.convert(amount, currency)
        grand += shown or 0
        totals.append(
            UpcomingTotal(
                currency=currency,
                amount=amount,
                display_amount=shown,
                converted=display.converted(currency),
            )
        )
    fields = display_fields(display, sums)
    return UpcomingOut(
        from_date=today,
        to_date=end,
        items=items,
        totals=totals,
        display=UpcomingDisplay(**fields, complete=not fields["missing"], total=grand),
    )


# ---- attention ----------------------------------------------------------------------------------


def _item(
    display: Display,
    key: str,
    kind: str,
    title: str,
    subject: tuple[str, uuid.UUID],
    facts: dict[str, Any],
    due: date | None = None,
    money: tuple[int, str] | None = None,
    severity: str | None = None,
    name: str = "",
    provider: str | None = None,
) -> AttentionItem:
    amount, currency = money if money else (None, None)
    shown = None if amount is None or currency is None else display.convert(amount, currency)
    return AttentionItem.model_validate(
        {
            "key": key,
            "kind": kind,
            "severity": severity or SEVERITY[kind],
            "title": title,
            "subject_type": subject[0],
            "subject_id": subject[1],
            "subject_name": name,
            "provider": provider,
            "due_date": due,
            "amount": amount,
            "currency": currency,
            "display_amount": shown,
            "converted": currency is not None and display.converted(currency),
            "facts": facts,
            "state": "active",
            "snoozed_until": None,
        }
    )


def _order(item: AttentionItem) -> tuple[int, int, date, str]:
    rank, kind = SEVERITY_RANK[item.severity], ORDER.index(item.kind)
    return rank, kind, item.due_date or date.max, item.key


def _when(days: int) -> str:
    if days <= 0:
        return "today"
    return "tomorrow" if days == 1 else f"in {days} days"


async def _reach(
    session: AsyncSession, rows: Sequence[Recurring], zone: tzinfo
) -> dict[uuid.UUID, date | None]:
    """How far the data of each paying account goes (a day): a manual bank's is the date its
    newest data is as of, a collected bank's the day it was last read, and nothing when its link
    is not working. Without data up to a date, a payment due then cannot be called missed."""
    ids = {row.account_id for row in rows if row.account_id}
    if not ids:
        return {}
    pairs = (
        await session.execute(
            select(Account, Connection)
            .join(Connection, Connection.id == Account.connection_id)
            .where(Account.id.in_(ids))
        )
    ).all()
    reach: dict[uuid.UUID, date | None] = {}
    for account, link in pairs:
        if link.manual:
            moment = link.last_ok_at
        elif link.status == "ok":
            moment = account.synced_until or link.last_ok_at
        else:
            moment = None
        reach[account.id] = moment.astimezone(zone).date() if moment else None
    return reach


def _tier(used_percent: int) -> int:
    """How bad a card is: 90, 95 or 100 (percent of its limit): a worse tier is a new item."""
    return 100 if used_percent >= 100 else 95 if used_percent >= 95 else 90


async def _conditions(
    session: AsyncSession, now: datetime, zone: tzinfo, display: Display
) -> list[AttentionItem]:
    today = _today(now, zone)
    items: list[AttentionItem] = []
    horizon = today + timedelta(days=UPCOMING_LOOKAHEAD_DAYS - 1)
    ahead = await _occurrences(session, today, horizon, display)
    for entry, row in ahead:
        window = DEFAULT_REMINDER_DAYS if row.reminder_days is None else row.reminder_days
        if entry.covered is False and not entry.overdue and entry.days_until <= window:
            items.append(
                _item(
                    display,
                    f"due_not_covered:{row.id}:{entry.due_date}",
                    "due_not_covered",
                    f"{row.name} is due {_when(entry.days_until)} and the paying account "
                    "cannot cover it",
                    ("recurring", row.id),
                    {
                        "due_in_days": entry.days_until,
                        "shortfall": entry.shortfall,
                        "account_short_total": entry.account_short_total,
                        "account_currency": entry.account_currency,
                    },
                    entry.due_date,
                    (row.amount, row.currency),
                    name=row.name,
                )
            )
    active = select(Recurring).where(Recurring.is_active.is_(True))
    recurring = (await session.scalars(active)).all()
    reach = await _reach(session, recurring, zone)
    for row in recurring:
        due = row.next_payment_date
        ended = schedule_state(row, today) == "ended_by_schedule"
        seen_to = reach.get(row.account_id) if row.account_id else None
        # Missed: past its grace, and the account's data goes at least that far (else the page
        # says the data is old, not that the payment is missing).
        if (
            due is not None
            and row.account_id is not None
            and today > grace_end(due)
            and seen_to is not None
            and seen_to >= grace_end(due)
            and not ended
        ):
            items.append(
                _item(
                    display,
                    f"missed_payment:{row.id}:{due}",
                    "missed_payment",
                    f"{row.name} was due {(today - due).days} day(s) ago and no matching "
                    "transaction has been seen",
                    ("recurring", row.id),
                    {
                        "days_overdue": (today - due).days,
                        "last_paid_on": str(row.last_paid_on) if row.last_paid_on else None,
                        "account_id": str(row.account_id),
                        "data_as_of": str(seen_to),
                    },
                    due,
                    (row.amount, row.currency),
                    name=row.name,
                )
            )
        charged = row.last_charged_amount
        matched_on = row.last_matched_on
        recent = matched_on is not None and (today - matched_on).days <= FRESH_DAYS
        if (
            charged is not None
            and row.last_transaction_id is not None
            and recent
            and amount_differs(row.amount, charged)
        ):
            items.append(
                _item(
                    display,
                    f"amount_changed:{row.id}:{row.last_transaction_id}",
                    "amount_changed",
                    f"{row.name} was charged a different amount than recorded",
                    ("recurring", row.id),
                    {
                        "recorded_amount": row.amount,
                        "charged_amount": charged,
                        "difference": charged - row.amount,
                        "paid_on": str(matched_on) if matched_on else None,
                    },
                    None,
                    (charged, row.currency),
                    name=row.name,
                )
            )
    accounts = (await session.scalars(select(Account).where(Account.archived.is_(False)))).all()
    for account in accounts:
        if account.kind == "credit_card" and account.credit_limit > 0:
            owed = account.credit_limit - account.balance
            if owed * 100 > CREDIT_HIGH_PERCENT * account.credit_limit:
                used = owed * 100 // account.credit_limit
                items.append(
                    _item(
                        display,
                        f"credit_high:{account.id}:{_tier(used)}",
                        "credit_high",
                        f"{account.name} has used more than {CREDIT_HIGH_PERCENT}% of its limit",
                        ("account", account.id),
                        {"used_percent": used, "owed": owed, "credit_limit": account.credit_limit},
                        None,
                        (owed, account.currency),
                        name=account.name,
                        provider=account.provider,
                    )
                )
        elif account.kind in {"current", "business"} and account.balance < 0:
            limit = overdraft_in_force(account)
            if limit is None:  # no limit known, from the owner or the bank: only a plain fact
                items.append(
                    _item(
                        display,
                        f"overdrawn:{account.id}",
                        "overdrawn",
                        f"{account.name} is overdrawn and no overdraft limit is known",
                        ("account", account.id),
                        {"balance": account.balance, "overdraft_limit": None},
                        None,
                        (-account.balance, account.currency),
                        name=account.name,
                        provider=account.provider,
                    )
                )
            elif -account.balance > limit:
                over = -account.balance - limit
                items.append(
                    _item(
                        display,
                        f"overdraft:{account.id}",
                        "overdraft",
                        f"{account.name} is past its overdraft",
                        ("account", account.id),
                        {"balance": account.balance, "overdraft_limit": limit, "over_by": over},
                        None,
                        (over, account.currency),
                        name=account.name,
                        provider=account.provider,
                    )
                )
    open_links = {account.connection_id for account in accounts}
    links = (await session.scalars(select(Connection))).all()
    for link in links:
        label = link.display_name or link.provider
        stamp = link.last_ok_at or link.created_at
        if link.status == "needs_reconsent":
            changed = link.status_changed_at
            since = changed.astimezone(zone).date() if changed else None
            items.append(
                _item(
                    display,
                    f"reconsent:{link.id}:{since}",
                    "reconsent",
                    f"The {link.provider} connection needs to be approved again",
                    ("connection", link.id),
                    {"provider": link.provider, "since": str(since) if since else None},
                    name=label,
                    provider=link.provider,
                )
            )
        elif link.manual and link.id in open_links:
            if link.last_ok_at is None or now - link.last_ok_at > STATEMENT_STALE_AFTER:
                since = link.last_ok_at.astimezone(zone).date() if link.last_ok_at else None
                title = (
                    f"The data of {label} is more than 30 days old"
                    if since
                    else f"No data yet for {label}: set a balance or upload a statement"
                )
                items.append(
                    _item(
                        display,
                        f"stale_statement:{link.id}:{since}",
                        "stale_statement",
                        title,
                        ("connection", link.id),
                        {
                            "provider": link.provider,
                            "as_of": str(since) if since else None,
                            "days_old": (today - since).days if since else None,
                            "no_data": since is None,
                        },
                        name=label,
                        provider=link.provider,
                    )
                )
        elif not link.manual and link.status == "ok" and link.id in open_links:
            if now - stamp > API_STALE_AFTER:
                since = stamp.astimezone(zone).date()
                late = now - stamp > API_STALE_HIGH_AFTER
                items.append(
                    _item(
                        display,
                        f"stale_connection:{link.id}:{since}",
                        "stale_connection",
                        f"The balances of {label} have not been read since {since}",
                        ("connection", link.id),
                        {
                            "provider": link.provider,
                            "last_error": link.last_error,
                            "since": str(since),
                            "hours_old": int((now - stamp).total_seconds() // 3600),
                        },
                        severity="high" if late else "medium",
                        name=label,
                        provider=link.provider,
                    )
                )
    items.sort(key=_order)
    return items


def _with_state(item: AttentionItem, row: AttentionState | None, now: datetime) -> AttentionItem:
    if row is None:
        return item
    if row.state == "dismissed":
        return item.model_copy(update={"state": "dismissed"})
    if row.until is not None and row.until > now:
        return item.model_copy(update={"state": "snoozed", "snoozed_until": row.until})
    return item  # a snooze that ran out


@guarded
async def attention(
    session: AsyncSession,
    now: datetime,
    zone: tzinfo,
    display: Display,
    include_hidden: bool = False,
) -> AttentionOut:
    await roll_forward(session, now, zone)
    found = await _conditions(session, now, zone, display)
    # What the owner did about a condition (a card near its limit, an account below zero) lasts
    # while the condition does: once it has cleared the state is gone, so when it comes back it
    # is raised again.
    gone = delete(AttentionState).where(
        or_(*(AttentionState.key.startswith(prefix) for prefix in CONDITION_KEYS)),
        AttentionState.key.not_in([item.key for item in found]),
    )
    await session.execute(gone)
    await session.commit()
    states = {
        row.key: row
        for row in (
            await session.scalars(
                select(AttentionState).where(AttentionState.key.in_([i.key for i in found]))
            )
        ).all()
    }
    shown = [_with_state(item, states.get(item.key), now) for item in found]
    visible = [item for item in shown if include_hidden or item.state == "active"]
    currencies = {i.currency for i in found if i.currency}
    return AttentionOut(
        items=visible,
        hidden=len(shown) - len([i for i in shown if i.state == "active"]),
        display=DisplayOut(**display_fields(display, currencies)),
    )


@guarded
async def set_attention_states(
    session: AsyncSession,
    now: datetime,
    zone: tzinfo,
    display: Display,
    keys: Sequence[str],
    action: Literal["dismiss", "snooze", "restore", "accept"],
    days: int | None = None,
) -> tuple[list[AttentionItem], list[str], list[str]]:
    """Dismiss (for good: the key names the occasion, so a new occasion is a new item), snooze
    for 1 to 90 days, bring back, or `accept` (an `amount_changed` item: the charged amount
    becomes the payment's amount, all in one transaction) the items of `keys`. Returns the items
    as they are now, the keys that are not an item right now (nothing is done for those; with
    `accept` also the keys of any other kind) and the keys accepted."""
    if action == "snooze" and (days is None or not 1 <= days <= MAX_SNOOZE_DAYS):
        raise invalid("Invalid days")
    await roll_forward(session, now, zone)  # the list the page just showed was made the same way
    found = await _conditions(session, now, zone, display)
    by_key = {item.key: item for item in found}
    changed: list[AttentionItem] = []
    missing: list[str] = []
    accepted: list[str] = []
    for key in dict.fromkeys(keys):
        item = by_key.get(key)
        if item is None or (action == "accept" and item.kind != "amount_changed"):
            missing.append(key)
            continue
        if action == "accept":
            row = await session.get(Recurring, item.subject_id, with_for_update=True)
            if row is None or row.last_charged_amount is None:
                missing.append(key)
                continue
            row.amount = row.last_charged_amount
            row.updated_at = now
            accepted.append(key)
            continue
        state: AttentionState | None = None
        if action == "restore":
            await session.execute(delete(AttentionState).where(AttentionState.key == key))
        else:
            until = now + timedelta(days=days or 0) if action == "snooze" else None
            kept = "snoozed" if action == "snooze" else "dismissed"
            values = {"state": kept, "until": until, "updated_at": now}
            await session.execute(
                insert(AttentionState)
                .values(key=key, **values)
                .on_conflict_do_update(index_elements=[AttentionState.key], set_=values)
            )
            state = AttentionState(key=key, **values)
        changed.append(_with_state(item, state, now))
    await session.execute(
        delete(AttentionState).where(
            AttentionState.key.not_in(list(by_key)), AttentionState.updated_at < now - STATE_KEEP
        )
    )
    await session.commit()
    return changed, missing, accepted


async def set_attention_state(
    session: AsyncSession,
    now: datetime,
    zone: tzinfo,
    display: Display,
    key: str,
    action: Literal["dismiss", "snooze", "restore"],
    days: int | None = None,
) -> AttentionItem:
    """One item of `set_attention_states`; a key that is not an item now is 404."""
    changed, _, _ = await set_attention_states(session, now, zone, display, [key], action, days)
    if not changed:
        raise AppError(404, "not_found", "Attention item not found")
    return changed[0]
