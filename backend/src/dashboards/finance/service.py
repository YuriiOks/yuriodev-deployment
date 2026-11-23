"""Read queries of the finance API. Nothing here writes; every failure of the database becomes 503
`dashboards_unavailable` through `service.guarded` (the class is logged, never a statement)."""

import base64
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo

from sqlalchemy import case, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.models import Account, Connection, Transaction
from src.dashboards.finance.schemas import CurrencySummary, FinanceSummaryOut
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


def day_start(day: date, zone: tzinfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)


@guarded
async def list_accounts(session: AsyncSession) -> tuple[Sequence[Account], Sequence[Connection]]:
    accounts = (
        await session.scalars(
            select(Account).order_by(Account.archived, Account.created_at, Account.external_id)
        )
    ).all()
    connections = (
        await session.scalars(select(Connection).order_by(Connection.created_at, Connection.id))
    ).all()
    return accounts, connections


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
