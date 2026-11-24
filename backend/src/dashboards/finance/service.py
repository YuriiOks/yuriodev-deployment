"""Queries of the finance API. The only write is the owner's category of a transaction (a note on
our copy); every failure of the database becomes 503 `dashboards_unavailable` through
`service.guarded` (the class is logged, never a statement)."""

import base64
import calendar
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Any

from sqlalchemy import and_, case, false, func, literal_column, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.brands import Brand
from src.dashboards.finance.categories import CATEGORIES, REFUNDABLE
from src.dashboards.finance.fx import Display, load_rates
from src.dashboards.finance.models import OVERDRAFT_KINDS, Account, Connection, Transaction
from src.dashboards.finance.schemas import (
    CategoriesDisplay,
    CategoriesOut,
    CategorySpend,
    CurrencyCategories,
    CurrencySummary,
    DisplayCategory,
    FinanceSummaryOut,
    SummaryDisplay,
    display_fields,
)
from src.dashboards.service import guarded

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_TEXT = 100
MAX_OVERDRAFT = 10**12  # minor units: far above any real limit, below bigint


@dataclass(frozen=True)
class TransactionFilter:
    account: uuid.UUID | None = None
    start: date | None = None  # a day, in the configured time zone, included
    end: date | None = None  # a day, included
    text: str | None = None  # a substring of the description or the counterparty
    min_amount: int | None = None  # minor units, signed: money out is negative
    max_amount: int | None = None
    category: str | None = None  # the effective category: the override, else the normalised one


def invalid(message: str) -> AppError:
    return AppError(422, "validation_error", message)


def encode_cursor(booked_at: datetime, transaction_id: uuid.UUID) -> str:
    raw = f"{booked_at.astimezone(UTC).isoformat()}|{transaction_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        moment, _, identifier = raw.partition("|")
        booked_at = datetime.fromisoformat(moment)
        if booked_at.tzinfo is None:
            raise ValueError
        return booked_at, uuid.UUID(identifier)
    except ValueError:  # a bad padding, bad UTF-8, date or UUID are all ValueErrors
        raise invalid("Invalid cursor") from None


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def effective_category() -> Any:
    """The category a page shows: the owner's override, else the normalised one, else other."""
    # A literal, not a bound value: the same expression is selected and grouped by, and two bound
    # values would be two different parameters to the database.
    return func.coalesce(
        Transaction.category_override, Transaction.category, literal_column("'other'")
    )


def day_start(day: date, zone: tzinfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)


@guarded
async def list_accounts(
    session: AsyncSession,
) -> tuple[Sequence[Account], Sequence[Connection], dict[uuid.UUID, datetime]]:
    accounts = (
        await session.scalars(
            select(Account).order_by(Account.archived, Account.created_at, Account.external_id)
        )
    ).all()
    connections = (
        await session.scalars(select(Connection).order_by(Connection.created_at, Connection.id))
    ).all()
    oldest = (
        await session.execute(
            select(Transaction.account_id, func.min(Transaction.booked_at))
            .where(Transaction.declined.is_(False))
            .group_by(Transaction.account_id)
        )
    ).all()
    return accounts, connections, {account_id: moment for account_id, moment in oldest}


@guarded
async def set_overdraft(
    session: AsyncSession, account_id: uuid.UUID, limit: int | None, commit: bool = True
) -> tuple[Account, datetime | None]:
    """The owner's overdraft limit of an account in minor units (None clears it, back to what the
    bank sends). Nothing is sent to a bank, and no collector ever writes this column."""
    if limit is not None and not 0 <= limit <= MAX_OVERDRAFT:
        raise invalid("Invalid overdraft limit")
    row = await session.get(Account, account_id)
    if row is None:
        raise AppError(404, "not_found", "Account not found")
    if row.kind not in OVERDRAFT_KINDS and limit is not None:
        raise invalid("Only a current or business account has an overdraft")
    row.overdraft_limit_override = limit
    if commit:
        await session.commit()
    oldest = await session.scalar(
        select(func.min(Transaction.booked_at)).where(
            Transaction.account_id == account_id, Transaction.declined.is_(False)
        )
    )
    return row, oldest


@dataclass(frozen=True)
class Style:
    """How the owner named and coloured one provider on his connection."""

    name: str | None
    colors: Brand | None


@guarded
async def connection_styles(session: AsyncSession) -> dict[str, Style]:
    """Per provider, the display name and colours of its oldest connection that has any."""
    rows = (
        await session.scalars(
            select(Connection)
            .where(or_(Connection.display_name.is_not(None), Connection.brand_bg.is_not(None)))
            .order_by(Connection.created_at.desc(), Connection.id.desc())
        )
    ).all()
    styles: dict[str, Style] = {}
    for link in rows:  # newest first, so the oldest wins
        pair = Brand("", link.brand_bg, link.brand_fg) if link.brand_bg and link.brand_fg else None
        styles[link.provider] = Style(link.display_name, pair)
    return styles


@guarded
async def account_with_history(
    session: AsyncSession, account_id: uuid.UUID
) -> tuple[Account, datetime | None]:
    row = await session.get(Account, account_id)
    if row is None:
        raise AppError(404, "not_found", "Account not found")
    oldest = await session.scalar(
        select(func.min(Transaction.booked_at)).where(
            Transaction.account_id == account_id, Transaction.declined.is_(False)
        )
    )
    return row, oldest


@guarded
async def provider_ids(session: AsyncSession) -> list[str]:
    """The providers that have at least one connection (an API's, or one entered by hand)."""
    return list((await session.scalars(select(Connection.provider).distinct())).all())


@guarded
async def list_transactions(
    session: AsyncSession,
    flt: TransactionFilter,
    zone: tzinfo,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> tuple[Sequence[Transaction], str | None]:
    """Newest first, `limit` rows and the cursor of the next page (None at the end)."""
    if not 1 <= limit <= MAX_LIMIT:
        raise invalid("Invalid limit")
    if flt.start is not None and flt.end is not None and flt.start > flt.end:
        raise invalid("from must not be after to")
    if flt.text is not None and len(flt.text) > MAX_TEXT:
        raise invalid("Search text is too long")
    after = decode_cursor(cursor) if cursor else None
    if flt.account is not None and await session.get(Account, flt.account) is None:
        raise AppError(404, "not_found", "Account not found")
    query = select(Transaction)
    if flt.account is not None:
        query = query.where(Transaction.account_id == flt.account)
    if flt.start is not None:
        query = query.where(Transaction.booked_at >= day_start(flt.start, zone))
    if flt.end is not None:
        query = query.where(Transaction.booked_at < day_start(flt.end + timedelta(days=1), zone))
    if flt.text:
        pattern = _like(flt.text)
        query = query.where(
            Transaction.description.ilike(pattern, escape="\\")
            | Transaction.counterparty.ilike(pattern, escape="\\")
        )
    if flt.category is not None:
        if flt.category not in CATEGORIES:
            raise invalid("Invalid category")
        query = query.where(effective_category() == flt.category)
    if flt.min_amount is not None:
        query = query.where(Transaction.amount >= flt.min_amount)
    if flt.max_amount is not None:
        query = query.where(Transaction.amount <= flt.max_amount)
    if after is not None:
        query = query.where(tuple_(Transaction.booked_at, Transaction.id) < tuple_(*after))
    query = query.order_by(Transaction.booked_at.desc(), Transaction.id.desc()).limit(limit + 1)
    rows = (await session.scalars(query)).all()
    page = rows[:limit]
    more = len(rows) > limit
    return page, (encode_cursor(page[-1].booked_at, page[-1].id) if more else None)


@guarded
async def display_for(session: AsyncSession, currency: str, now: datetime) -> Display:
    """The display currency with the rates as they are at `now`."""
    return Display(currency, await load_rates(session, now))


@guarded
async def summary(
    session: AsyncSession, now: datetime, zone: tzinfo, display: Display
) -> FinanceSummaryOut:
    """Per currency: the balances of the open accounts and this month's money out and in, and the
    grand total in the display currency (the converted parts, each converted once, added)."""
    local = now.astimezone(zone)
    first = date(local.year, local.month, 1)
    following = date(local.year + local.month // 12, local.month % 12 + 1, 1)
    balances = (
        await session.execute(
            select(
                Account.currency,
                func.count(Account.id),
                func.sum(Account.balance),
                func.sum(Account.balance - Account.credit_limit),
                func.min(Account.balance_at),
            )
            .where(Account.archived.is_(False))
            .group_by(Account.currency)
        )
    ).all()
    category = effective_category()
    out = case((Transaction.amount < 0, -Transaction.amount), else_=0)
    received = case((Transaction.amount > 0, Transaction.amount), else_=0)
    flows = (
        await session.execute(
            select(Transaction.currency, category, func.sum(out), func.sum(received))
            .where(
                Transaction.booked_at >= day_start(first, zone),
                Transaction.booked_at < day_start(following, zone),
                Transaction.declined.is_(False),  # a refused payment never moved money
                Transaction.internal_transfer.is_(False),  # nor does a move between own accounts
                category != "transfers",  # nor one the owner (or the bank) calls that
            )
            .group_by(Transaction.currency, category)
        )
    ).all()
    by_currency: dict[str, list[int]] = {}  # count, balance, own balance, spent, received
    for currency, count, total, own, _ in balances:
        by_currency[currency] = [int(count), int(total), int(own), 0, 0]
    for currency, name, money_out, money_in in flows:
        entry = by_currency.setdefault(currency, [0, 0, 0, 0, 0])
        spent, got = net_flow(name, int(money_out), int(money_in))
        entry[3] += spent
        entry[4] += got
    as_of = min((row[4] for row in balances), default=None)
    lines: list[CurrencySummary] = []
    totals = [0, 0, 0, 0]  # the converted parts that have a rate, added
    for currency, (n, balance, own, spent, got) in sorted(by_currency.items()):
        parts = [display.convert(figure, currency) for figure in (balance, own, spent, got)]
        for index, part in enumerate(parts):
            totals[index] += part or 0
        lines.append(
            CurrencySummary(
                currency=currency,
                accounts=n,
                balance=balance,
                own_balance=own,
                spent=spent,
                received=got,
                display_balance=parts[0],
                display_own_balance=parts[1],
                display_spent=parts[2],
                display_received=parts[3],
                converted=display.converted(currency),
            )
        )
    shown = display_fields(display, by_currency)
    return FinanceSummaryOut(
        month=f"{first.year:04d}-{first.month:02d}",
        as_of=as_of,
        currencies=lines,
        display=SummaryDisplay(
            **shown,
            complete=not shown["missing"],
            balance=totals[0],
            own_balance=totals[1],
            spent=totals[2],
            received=totals[3],
        ),
    )


def net_flow(category: str, money_out: int, money_in: int) -> tuple[int, int]:
    """(spent, received) of one category in one month. Money in on a spending category is a refund:
    it is taken off what was spent there (never below 0) and is not income; elsewhere (income, and
    what is sent to people) money out is spent and money in is received."""
    if category in REFUNDABLE:
        return max(money_out - money_in, 0), 0
    return money_out, money_in


def shift_month(first: date, months: int) -> date:
    index = first.year * 12 + first.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def month_bounds(month: str | None, now: datetime, zone: tzinfo) -> tuple[date, date, date]:
    """The first day of the month before the one asked for, of that month (default: this one in
    the zone) and of the month after it."""
    if month is None:
        local = now.astimezone(zone)
        first = date(local.year, local.month, 1)
    else:
        try:
            year_text, dash, month_text = month.partition("-")
            if dash != "-" or len(year_text) != 4 or len(month_text) != 2:
                raise ValueError
            first = date(int(year_text), int(month_text), 1)
            before, after = shift_month(first, -1), shift_month(first, 1)
        except ValueError:  # also the first and the last month a date can hold: no neighbour
            raise invalid("Invalid month") from None
        return before, first, after
    return shift_month(first, -1), first, shift_month(first, 1)


def _previous_cutoff(
    before: date, first: date, now: datetime, zone: tzinfo
) -> tuple[datetime, date] | None:
    """For the month in progress: the instant in the previous month that is the same day and time
    of day as now (the day clamped to that month's length), and its day. None for a past month."""
    local = now.astimezone(zone)
    if first != date(local.year, local.month, 1):
        return None
    day = min(local.day, calendar.monthrange(before.year, before.month)[1])
    moment = datetime(
        before.year, before.month, day, local.hour, local.minute, local.second, tzinfo=zone
    )
    return moment.astimezone(UTC), date(before.year, before.month, day)


@guarded
async def categories_report(
    session: AsyncSession, month: str | None, now: datetime, zone: tzinfo, display: Display
) -> CategoriesOut:
    """Money out per currency and category for a month and the one before, refunds netted off the
    category they refund. Left out: moves between the owner's own accounts and pots (and what is
    called `transfers`), declined payments, and money in (apart from refunds). For the month in
    progress the previous month is also given up to the same day and time (`previous_to_date`),
    the fair comparison."""
    before, first, after = month_bounds(month, now, zone)
    start_before, start, end = (day_start(day, zone) for day in (before, first, after))
    cutoff = _previous_cutoff(before, first, now, zone)
    category = effective_category()
    money_out = case((Transaction.amount < 0, -Transaction.amount), else_=0)
    money_in = case((Transaction.amount > 0, Transaction.amount), else_=0)
    this_month = Transaction.booked_at >= start
    last_month = Transaction.booked_at < start
    to_date = and_(last_month, Transaction.booked_at < cutoff[0]) if cutoff else false()
    rows = (
        await session.execute(
            select(
                Transaction.currency,
                category,
                func.sum(case((this_month, money_out), else_=0)),
                func.sum(case((this_month, money_in), else_=0)),
                func.sum(case((last_month, money_out), else_=0)),
                func.sum(case((last_month, money_in), else_=0)),
                func.sum(case((to_date, money_out), else_=0)),
                func.sum(case((to_date, money_in), else_=0)),
            )
            .where(
                Transaction.booked_at >= start_before,
                Transaction.booked_at < end,
                Transaction.declined.is_(False),
                Transaction.internal_transfer.is_(False),
                category != "transfers",
            )
            .group_by(Transaction.currency, category)
        )
    ).all()
    grouped: dict[str, list[tuple[str, int, int, int]]] = {}
    for currency, name, out_now, in_now, out_before, in_before, out_td, in_td in rows:
        spent = net_flow(name, int(out_now), int(in_now))[0]
        previous = net_flow(name, int(out_before), int(in_before))[0]
        so_far = net_flow(name, int(out_td), int(in_td))[0]
        if spent or previous:
            grouped.setdefault(currency, []).append((name, spent, previous, so_far))
    currencies = []
    merged: dict[str, list[int]] = {}  # per category, display currency: spent, previous, to date
    for currency in sorted(grouped):
        lines = []
        ordered = sorted(grouped[currency], key=lambda line: (-line[1], line[0]))
        for name, spent, previous, so_far in ordered:
            shown_spent = display.convert(spent, currency)
            shown_previous = display.convert(previous, currency)
            shown_so_far = display.convert(so_far, currency) if cutoff else None
            lines.append(
                CategorySpend(
                    category=name,
                    spent=spent,
                    previous=previous,
                    previous_to_date=so_far if cutoff else None,
                    display_spent=shown_spent,
                    display_previous=shown_previous,
                    display_previous_to_date=shown_so_far,
                )
            )
            if shown_spent is not None and shown_previous is not None:
                entry = merged.setdefault(name, [0, 0, 0])
                entry[0] += shown_spent
                entry[1] += shown_previous
                entry[2] += shown_so_far or 0
        has_rate = display.convert(0, currency) is not None
        currencies.append(
            CurrencyCategories(
                currency=currency,
                spent=sum(line.spent for line in lines),
                previous_spent=sum(line.previous for line in lines),
                previous_to_date_spent=(
                    sum(line.previous_to_date or 0 for line in lines) if cutoff else None
                ),
                categories=lines,
                display_spent=sum(line.display_spent or 0 for line in lines) if has_rate else None,
                display_previous_spent=(
                    sum(line.display_previous or 0 for line in lines) if has_rate else None
                ),
                display_previous_to_date_spent=(
                    sum(line.display_previous_to_date or 0 for line in lines)
                    if has_rate and cutoff
                    else None
                ),
                converted=display.converted(currency),
            )
        )
    shown = display_fields(display, grouped)
    ranked = sorted(merged.items(), key=lambda item: (-item[1][0], item[0]))
    return CategoriesOut(
        month=f"{first.year:04d}-{first.month:02d}",
        previous_month=f"{before.year:04d}-{before.month:02d}",
        previous_to_date_day=cutoff[1] if cutoff else None,
        currencies=currencies,
        display=CategoriesDisplay(
            **shown,
            complete=not shown["missing"],
            spent=sum(entry[0] for entry in merged.values()),
            previous_spent=sum(entry[1] for entry in merged.values()),
            previous_to_date_spent=sum(entry[2] for entry in merged.values()) if cutoff else None,
            categories=[
                DisplayCategory(
                    category=name,
                    spent=entry[0],
                    previous=entry[1],
                    previous_to_date=entry[2] if cutoff else None,
                )
                for name, entry in ranked
            ],
        ),
    )


@guarded
async def set_category(
    session: AsyncSession, transaction_id: uuid.UUID, category: str | None
) -> Transaction:
    """The owner's category for one transaction (None clears it, back to the normalised one).
    Nothing is sent to a bank: this is a note on our own copy, which a re-import keeps."""
    if category is not None and category not in CATEGORIES:
        raise invalid("Invalid category")
    row = await session.get(Transaction, transaction_id)
    if row is None:
        raise AppError(404, "not_found", "Transaction not found")
    row.category_override = category
    await session.commit()
    return row
