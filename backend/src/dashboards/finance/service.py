"""Queries of the finance API. The only write is the owner's category of a transaction (a note on
our copy); every failure of the database becomes 503 `dashboards_unavailable` through
`service.guarded` (the class is logged, never a statement)."""

import base64
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Any

from sqlalchemy import case, func, literal_column, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.categories import CATEGORIES
from src.dashboards.finance.models import Account, Connection, Transaction
from src.dashboards.finance.schemas import (
    CategoriesOut,
    CategorySpend,
    CurrencyCategories,
    CurrencySummary,
    FinanceSummaryOut,
)
from src.dashboards.service import guarded

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_TEXT = 100


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
async def summary(session: AsyncSession, now: datetime, zone: tzinfo) -> FinanceSummaryOut:
    """Per currency: the balances of the open accounts and this month's money out and in."""
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
    out = case((Transaction.amount < 0, -Transaction.amount), else_=0)
    received = case((Transaction.amount > 0, Transaction.amount), else_=0)
    flows = (
        await session.execute(
            select(Transaction.currency, func.sum(out), func.sum(received))
            .where(
                Transaction.booked_at >= day_start(first, zone),
                Transaction.booked_at < day_start(following, zone),
                Transaction.declined.is_(False),  # a refused payment never moved money
                Transaction.internal_transfer.is_(False),  # nor does a move between own accounts
            )
            .group_by(Transaction.currency)
        )
    ).all()
    by_currency: dict[str, list[int]] = {}  # count, balance, own balance, spent, received
    for currency, count, total, own, _ in balances:
        by_currency[currency] = [int(count), int(total), int(own), 0, 0]
    for currency, spent, got in flows:
        entry = by_currency.setdefault(currency, [0, 0, 0, 0, 0])
        entry[3], entry[4] = int(spent), int(got)
    as_of = min((row[4] for row in balances), default=None)
    return FinanceSummaryOut(
        month=f"{first.year:04d}-{first.month:02d}",
        as_of=as_of,
        currencies=[
            CurrencySummary(
                currency=currency,
                accounts=n,
                balance=balance,
                own_balance=own,
                spent=spent,
                received=got,
            )
            for currency, (n, balance, own, spent, got) in sorted(by_currency.items())
        ],
    )


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
        except ValueError:
            raise invalid("Invalid month") from None
    return shift_month(first, -1), first, shift_month(first, 1)


@guarded
async def categories_report(
    session: AsyncSession, month: str | None, now: datetime, zone: tzinfo
) -> CategoriesOut:
    """Money out per currency and category for a month and the one before. Left out: transfers
    between the owner's own accounts and pots, declined payments, and money in."""
    before, first, after = month_bounds(month, now, zone)
    start_before, start, end = (day_start(day, zone) for day in (before, first, after))
    category = effective_category()
    this_month = case((Transaction.booked_at >= start, -Transaction.amount), else_=0)
    last_month = case((Transaction.booked_at < start, -Transaction.amount), else_=0)
    rows = (
        await session.execute(
            select(
                Transaction.currency,
                category,
                func.sum(this_month),
                func.sum(last_month),
            )
            .where(
                Transaction.booked_at >= start_before,
                Transaction.booked_at < end,
                Transaction.amount < 0,
                Transaction.declined.is_(False),
                Transaction.internal_transfer.is_(False),
            )
            .group_by(Transaction.currency, category)
        )
    ).all()
    grouped: dict[str, list[CategorySpend]] = {}
    for currency, name, spent, previous in rows:
        if int(spent) or int(previous):
            grouped.setdefault(currency, []).append(
                CategorySpend(category=name, spent=int(spent), previous=int(previous))
            )
    currencies = []
    for currency in sorted(grouped):
        lines = sorted(grouped[currency], key=lambda line: (-line.spent, line.category))
        currencies.append(
            CurrencyCategories(
                currency=currency,
                spent=sum(line.spent for line in lines),
                previous_spent=sum(line.previous for line in lines),
                categories=lines,
            )
        )
    return CategoriesOut(
        month=f"{first.year:04d}-{first.month:02d}",
        previous_month=f"{before.year:04d}-{before.month:02d}",
        currencies=currencies,
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
