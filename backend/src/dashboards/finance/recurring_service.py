"""Recurring payments, what is coming up and what needs attention.

The only things written are our own notes: the owner's recurring payments, the dates they move to
and what he did with an attention item. Nothing is ever sent to a bank. Every failure of the
database becomes 503 `dashboards_unavailable` through `guarded`.

Matching a payment to a transaction (`roll_forward`). A payment due on day D is paid when a
transaction exists that: is money out, not declined and not a move between the owner's accounts;
is in the payment's currency; is on the paying account when the payment names one; was booked
from 3 days before D to 7 days after it (local days); and whose counterparty or description names
the payment (`recurring.text_matches`: the name, or `match_text` when it is set, inside the text,
both reduced to lower-case letters and digits, or the counterparty inside the name). The amount
does not decide the match: a charge of a different amount is still the payment, and is raised
as an attention item instead. Of several candidates the one closest to D (then closest in
amount) wins, and one transaction pays one payment only.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime, timedelta, tzinfo
from typing import Any, Literal

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.fx import Display
from src.dashboards.finance.models import (
    Account,
    AttentionState,
    Connection,
    Recurring,
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
    instalments_agree,
    occurrences,
    problem_row,
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
)
from src.dashboards.finance.schemas import DisplayOut, display_fields
from src.dashboards.finance.service import day_start, invalid
from src.dashboards.service import guarded

DEFAULT_REMINDER_DAYS = 2
UPCOMING_LOOKAHEAD_DAYS = 90
MAX_UPCOMING_DAYS = 366
MAX_SNOOZE_DAYS = 90
STATE_KEEP = timedelta(days=90)
CATCH_UP_LIMIT = 24  # occurrences handled for one payment in one pass
CREDIT_HIGH_PERCENT = 90
ORDER = (
    "due_not_covered",
    "missed_payment",
    "amount_changed",
    "credit_high",
    "overdraft",
    "reconsent",
    "stale_statement",
)
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


@guarded
async def create_recurring(session: AsyncSession, data: RecurringIn, now: datetime) -> Recurring:
    values = data.model_dump()
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


def _step(row: Recurring) -> None:
    """Move to the next date, or finish a payment that happens once."""
    current = row.next_payment_date
    if current is None:
        return
    following = advance(
        current, row.frequency, row.frequency_interval, anchor_of(row.start_date, current)
    )
    if following is None:
        row.is_active = False
    else:
        row.next_payment_date = following


@guarded
async def mark_paid(
    session: AsyncSession,
    recurring_id: uuid.UUID,
    now: datetime,
    zone: tzinfo,
    paid_on: date | None = None,
) -> Recurring:
    """The owner says it was paid: the next date moves on one step (a payment that happens once
    ends). No figure of his (instalments, balances) is changed on a guess."""
    row = await session.get(Recurring, recurring_id, with_for_update=True)
    if row is None:
        raise _not_found()
    row.last_paid_on = paid_on or _today(now, zone)
    _step(row)
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
            problems.append(RowError(number, "account_id", "unknown account"))
        if not instalments_agree(item.model_dump()):
            problems.append(RowError(number, "completed_installments", "more than the total"))
        if item.external_ref:
            if item.external_ref in seen:
                problems.append(RowError(number, "external_ref", "the same reference twice"))
            seen.add(item.external_ref)
    created: list[Recurring] = []
    updated: list[Recurring] = []
    skipped = 0
    if not problems:
        for _, item in inputs:
            found = existing.get(item.external_ref) if item.external_ref else None
            if found is not None and on_conflict == "skip":
                skipped += 1
            elif found is not None:
                for name, value in item.model_dump().items():
                    setattr(found, name, value)
                found.updated_at = now
                updated.append(found)
            else:
                row = Recurring(**item.model_dump(), created_at=now, updated_at=now)
                session.add(row)
                created.append(row)
        if dry_run:
            await session.rollback()
        else:
            await session.commit()
    answer = ImportOut(
        dry_run=dry_run,
        created=len(created),
        updated=len(updated),
        skipped=skipped,
        errors=[RowErrorOut.of(e) for e in problems],
        ignored_columns=list(ignored),
        recurring=[] if dry_run else [RecurringOut.from_row(r, display) for r in created + updated],
    )
    return answer, not problems


# ---- matching and rolling forward ---------------------------------------------------------------


async def _match(
    session: AsyncSession,
    row: Recurring,
    due: date,
    zone: tzinfo,
    used: set[uuid.UUID],
) -> Transaction | None:
    query = select(Transaction).where(
        Transaction.booked_at >= day_start(due - timedelta(days=EARLY_DAYS), zone),
        Transaction.booked_at < day_start(due + timedelta(days=LATE_DAYS + 1), zone),
        Transaction.amount < 0,
        Transaction.declined.is_(False),
        Transaction.internal_transfer.is_(False),
        Transaction.currency == row.currency,
    )
    if row.account_id is not None:
        query = query.where(Transaction.account_id == row.account_id)
    needle = row.match_text or row.name
    found = [
        t
        for t in (await session.scalars(query)).all()
        if t.id not in used and text_matches(needle, t.counterparty, t.description)
    ]
    if not found:
        return None

    def closeness(t: Transaction) -> tuple[int, int, str]:
        days = abs((t.booked_at.astimezone(zone).date() - due).days)
        return days, abs(-t.amount - row.amount), str(t.id)

    return min(found, key=closeness)


@guarded
async def roll_forward(session: AsyncSession, now: datetime, zone: tzinfo) -> int:
    """Move the next date of every active payment past the occurrences that were paid. A payment
    with a matching transaction rolls (its `last_paid_on`, `last_charged_amount` and
    `last_transaction_id` are set); one whose paying account is not one we collect cannot be
    seen, so it rolls when its date has passed; one whose account we do collect and that has no
    matching transaction stays put: it becomes a `missed_payment` attention item. Idempotent;
    run before every read that shows dates. Returns how many payments moved."""
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
    paid = await session.scalars(
        select(Recurring.last_transaction_id).where(Recurring.last_transaction_id.is_not(None))
    )
    used: set[uuid.UUID] = {found for found in paid if found is not None}
    moved = 0
    for row in rows:
        for _ in range(CATCH_UP_LIMIT):
            due = row.next_payment_date
            if due is None or not row.is_active or today < due - timedelta(days=EARLY_DAYS):
                break
            found = await _match(session, row, due, zone, used)
            if found is not None:
                used.add(found.id)
                row.last_paid_on = found.booked_at.astimezone(zone).date()
                row.last_charged_amount = -found.amount
                row.last_transaction_id = found.id
            elif row.account_id is not None or today <= due:
                break
            _step(row)
            row.updated_at = now
            moved += 1
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
        anchor = anchor_of(row.start_date, first)
        for day in occurrences(first, row.frequency, row.frequency_interval, anchor, end):
            if day >= today:
                entries.append((day, row))
    entries.sort(key=lambda entry: (entry[0], entry[1].name, str(entry[1].id)))
    room: dict[uuid.UUID, int] = {}
    found: list[tuple[UpcomingItem, Recurring]] = []
    for day, row in entries:
        covered: bool | None = None
        shortfall: int | None = None
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
                shortfall = max(-room[account.id], 0)
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
            color=row.color,
            covered=covered,
            shortfall=shortfall,
            account_currency=account_currency,
        )
        found.append((item, row))
    return found


@guarded
async def upcoming(
    session: AsyncSession, now: datetime, zone: tzinfo, display: Display, days: int
) -> UpcomingOut:
    """The payments due from today to `days` days ahead (a weekly one appears each time), with
    whether the paying account covers each, counting the earlier ones of the window against the
    same account. Nothing is assumed about money arriving in between. Totals per currency, each
    converted once, make the display total."""
    if not 1 <= days <= MAX_UPCOMING_DAYS:
        raise invalid("Invalid days")
    await roll_forward(session, now, zone)
    today = _today(now, zone)
    end = today + timedelta(days=days)
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
) -> AttentionItem:
    amount, currency = money if money else (None, None)
    shown = None if amount is None or currency is None else display.convert(amount, currency)
    return AttentionItem.model_validate(
        {
            "key": key,
            "kind": kind,
            "title": title,
            "subject_type": subject[0],
            "subject_id": subject[1],
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


def _when(days: int) -> str:
    if days <= 0:
        return "today"
    return "tomorrow" if days == 1 else f"in {days} days"


async def _conditions(
    session: AsyncSession, now: datetime, zone: tzinfo, display: Display
) -> list[AttentionItem]:
    today = _today(now, zone)
    month = f"{today.year:04d}-{today.month:02d}"
    items: list[AttentionItem] = []
    horizon = today + timedelta(days=UPCOMING_LOOKAHEAD_DAYS)
    ahead = await _occurrences(session, today, horizon, display)
    for entry, row in ahead:
        window = DEFAULT_REMINDER_DAYS if row.reminder_days is None else row.reminder_days
        if entry.covered is False and entry.days_until <= window:
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
                        "account_currency": entry.account_currency,
                    },
                    entry.due_date,
                    (row.amount, row.currency),
                )
            )
    active = select(Recurring).where(Recurring.is_active.is_(True))
    recurring = (await session.scalars(active)).all()
    for row in recurring:
        due = row.next_payment_date
        if due is not None and row.account_id is not None and due < today:
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
                    },
                    due,
                    (row.amount, row.currency),
                )
            )
        charged = row.last_charged_amount
        if (
            charged is not None
            and row.last_transaction_id is not None
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
                        "paid_on": str(row.last_paid_on) if row.last_paid_on else None,
                    },
                    None,
                    (charged, row.currency),
                )
            )
    accounts = (await session.scalars(select(Account).where(Account.archived.is_(False)))).all()
    for account in accounts:
        if account.kind == "credit_card" and account.credit_limit > 0:
            owed = account.credit_limit - account.balance
            if owed * 100 > CREDIT_HIGH_PERCENT * account.credit_limit:
                items.append(
                    _item(
                        display,
                        f"credit_high:{account.id}:{month}",
                        "credit_high",
                        f"{account.name} has used more than {CREDIT_HIGH_PERCENT}% of its limit",
                        ("account", account.id),
                        {
                            "used_percent": owed * 100 // account.credit_limit,
                            "owed": owed,
                            "credit_limit": account.credit_limit,
                        },
                        None,
                        (owed, account.currency),
                    )
                )
        elif account.kind in {"current", "business"}:
            limit = overdraft_in_force(account)
            over = -account.balance - (limit or 0)
            if over > 0:
                items.append(
                    _item(
                        display,
                        f"overdraft:{account.id}:{month}",
                        "overdraft",
                        f"{account.name} is past its overdraft",
                        ("account", account.id),
                        {"balance": account.balance, "overdraft_limit": limit, "over_by": over},
                        None,
                        (over, account.currency),
                    )
                )
    links = (
        await session.scalars(select(Connection).where(Connection.status == "needs_reconsent"))
    ).all()
    for link in links:
        since = link.status_changed_at.astimezone(zone).date() if link.status_changed_at else None
        items.append(
            _item(
                display,
                f"reconsent:{link.id}:{since}",
                "reconsent",
                f"The {link.provider} connection needs to be approved again",
                ("connection", link.id),
                {"provider": link.provider, "since": str(since) if since else None},
            )
        )
    open_links = {account.connection_id for account in accounts}
    manual_links = (
        await session.scalars(select(Connection).where(Connection.manual.is_(True)))
    ).all()
    for link in manual_links:
        stale = link.last_ok_at is None or now - link.last_ok_at > STATEMENT_STALE_AFTER
        if link.id in open_links and stale:
            since = link.last_ok_at.astimezone(zone).date() if link.last_ok_at else None
            items.append(
                _item(
                    display,
                    f"stale_statement:{link.id}:{since}",
                    "stale_statement",
                    f"The data of {link.display_name or link.provider} is more than 30 days old",
                    ("connection", link.id),
                    {
                        "provider": link.provider,
                        "as_of": str(since) if since else None,
                        "days_old": (today - since).days if since else None,
                    },
                )
            )
    items.sort(key=lambda i: (ORDER.index(i.kind), i.due_date or date.max, i.key))
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
async def set_attention_state(
    session: AsyncSession,
    now: datetime,
    zone: tzinfo,
    display: Display,
    key: str,
    action: Literal["dismiss", "snooze", "restore"],
    days: int | None = None,
) -> AttentionItem:
    """Dismiss (for good: the key names the occasion, so a new occasion is a new item), snooze
    for 1 to 90 days, or bring back an item. The key must be one that exists now."""
    if action == "snooze" and (days is None or not 1 <= days <= MAX_SNOOZE_DAYS):
        raise invalid("Invalid days")
    found = await _conditions(session, now, zone, display)
    item = next((i for i in found if i.key == key), None)
    if item is None:
        raise AppError(404, "not_found", "Attention item not found")
    row = await session.get(AttentionState, key)
    if action == "restore":
        if row is not None:
            await session.delete(row)
        row = None
    else:
        until = now + timedelta(days=days or 0) if action == "snooze" else None
        state = "snoozed" if action == "snooze" else "dismissed"
        if row is None:
            row = AttentionState(key=key, state=state, until=until, updated_at=now)
            session.add(row)
        else:
            row.state, row.until, row.updated_at = state, until, now
    current = [i.key for i in found]
    await session.execute(
        delete(AttentionState).where(
            AttentionState.key.not_in(current), AttentionState.updated_at < now - STATE_KEEP
        )
    )
    await session.commit()
    return _with_state(item, row, now)
