"""Banks without an API, entered by hand: a connection, its accounts, a balance set with a date,
and statements the owner downloaded and uploads. Nothing here talks to a bank; no collector reads
a manual connection.

A manual account is an ordinary `finance.account` (so every page and report treats it like the
others), on a connection with `manual = true`. A credit card keeps the rule of the other
providers: `balance` includes the limit, so the owner gives what he OWES and the balance is the
limit minus that. `connection.last_ok_at` is the date the newest data is as of (a balance's date
or the newest transaction of a statement), never the day it was uploaded: a statement older than
30 days is an attention item.
"""

import re
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, tzinfo
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import AppError
from src.dashboards.finance.brands import COLLECTOR_PROVIDERS, readable
from src.dashboards.finance.categories import categorize
from src.dashboards.finance.logos import PROVIDER_ID
from src.dashboards.finance.models import Account, Connection, Transaction
from src.dashboards.finance.recurring import MAX_MINOR, Minor, RowError
from src.dashboards.finance.recurring_schemas import RowErrorOut
from src.dashboards.finance.service import invalid
from src.dashboards.finance.statements import (
    DateOrder,
    Entry,
    Statement,
    UnknownLayout,
    balance_moment,
    booked_at,
    number_entries,
    parse_statement,
)
from src.dashboards.service import guarded


def _day_or_time(value: Any) -> Any:
    """`2026-11-20` is a day (it would also parse as midnight of a time): keep it a day."""
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return date.fromisoformat(value.strip())
    return value


Money = Annotated[int, Field(strict=True, ge=-MAX_MINOR, le=MAX_MINOR)]
AsOf = Annotated[date | datetime | None, BeforeValidator(_day_or_time)]
ManualKind = Literal["current", "credit_card", "savings", "business"]
INSERT_CHUNK = 400


class ConnectionIn(BaseModel):
    """A bank entered by hand. `provider` is a lower-case id (a built-in brand such as
    `barclays`, or any neutral id of your own for a bank that is not named in the repository);
    `display_name` and the colours are for a bank with no built-in brand."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: str = Field(min_length=1, max_length=32)
    display_name: str | None = Field(default=None, min_length=1, max_length=60)
    brand_bg: str | None = None
    brand_fg: str | None = None


class ConnectionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str | None = Field(default=None, min_length=1, max_length=60)
    brand_bg: str | None = None
    brand_fg: str | None = None


class AccountIn(BaseModel):
    """An account of a manual connection. A credit card takes `credit_limit` and `owed` (what is
    owed now, 0 or more); the others take `balance`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    connection_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    kind: ManualKind = "current"
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    mask_last4: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    label: str | None = Field(default=None, min_length=1, max_length=60)
    type: str | None = Field(default=None, min_length=1, max_length=32)
    credit_limit: Minor | None = None
    balance: Money | None = None
    owed: Minor | None = None
    as_of: AsOf = None
    opened_at: date | None = None
    overdraft_limit: Minor | None = None

    @model_validator(mode="after")
    def _shape(self) -> Self:
        if self.kind == "credit_card":
            if not self.credit_limit or self.owed is None or self.balance is not None:
                raise ValueError("a credit card needs credit_limit above 0 and owed, not balance")
        elif self.balance is None or self.owed is not None or self.credit_limit:
            raise ValueError("this kind needs balance, and no owed or credit_limit")
        if self.overdraft_limit is not None and self.kind not in {"current", "business"}:
            raise ValueError("an overdraft belongs to a current or business account")
        return self


class BalanceIn(BaseModel):
    """A balance as of a date (default now): `balance` (may be negative), or `owed` for a
    credit card."""

    model_config = ConfigDict(extra="forbid")

    balance: Money | None = None
    owed: Minor | None = None
    as_of: AsOf = None

    @model_validator(mode="after")
    def _one(self) -> Self:
        if (self.balance is None) == (self.owed is None):
            raise ValueError("exactly one of balance and owed")
        return self


class ManualAccountPatch(BaseModel):
    """What may be changed on a manual account (an API account accepts only the overdraft)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    label: str | None = Field(default=None, min_length=1, max_length=60)
    mask_last4: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    archived: bool | None = None
    credit_limit: Minor | None = None


MANUAL_FIELDS = frozenset({"name", "label", "mask_last4", "archived", "credit_limit"})


def _brand(background: str | None, foreground: str | None) -> tuple[str | None, str | None]:
    """A colour pair as lower-case `#rrggbb`: both or neither, readable (WCAG AA, 4.5)."""
    if background is None and foreground is None:
        return None, None
    if background is None or foreground is None:
        raise invalid("Give both brand colours or neither")
    pair = background.lower(), foreground.lower()
    if not readable(*pair):
        raise invalid("The brand colours must be #rrggbb with a contrast of at least 4.5")
    return pair


def _instant(value: date | datetime | None, now: datetime, zone: tzinfo) -> datetime:
    """When a balance is as of: a date is the end of that local day, never later than now."""
    if value is None:
        return now
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise invalid("as_of needs a UTC offset")
        moment = value.astimezone(UTC)
        if moment > now:
            raise invalid("as_of is in the future")
        return moment
    if value > now.astimezone(zone).date():
        raise invalid("as_of is in the future")
    return min(balance_moment(value, zone), now)


async def _manual_connection(session: AsyncSession, connection_id: uuid.UUID) -> Connection:
    link = await session.get(Connection, connection_id)
    if link is None:
        raise AppError(404, "not_found", "Connection not found")
    if not link.manual:
        raise invalid("Only a manual connection can be changed by hand")
    return link


async def _manual_account(
    session: AsyncSession, account_id: uuid.UUID, lock: bool = False
) -> tuple[Account, Connection]:
    row = await session.get(Account, account_id, with_for_update=lock)
    if row is None:
        raise AppError(404, "not_found", "Account not found")
    link = await session.get(Connection, row.connection_id)
    if link is None or not link.manual:
        raise invalid("Only an account entered by hand can be changed this way")
    return row, link


def _touch(link: Connection, moment: datetime) -> None:
    if link.last_ok_at is None or moment > link.last_ok_at:
        link.last_ok_at = moment


# ---- connection and account ---------------------------------------------------------------------


@guarded
async def create_connection(session: AsyncSession, data: ConnectionIn) -> Connection:
    if not PROVIDER_ID.fullmatch(data.provider):
        raise invalid("A provider id is lower-case letters, digits and hyphens")
    if data.provider in COLLECTOR_PROVIDERS:
        raise invalid("That bank is connected through its own API")
    background, foreground = _brand(data.brand_bg, data.brand_fg)
    link = Connection(
        provider=data.provider,
        ref=uuid.uuid4().hex,
        status="ok",
        manual=True,
        display_name=data.display_name,
        brand_bg=background,
        brand_fg=foreground,
    )
    session.add(link)
    await session.commit()
    return link


@guarded
async def update_connection(
    session: AsyncSession, connection_id: uuid.UUID, patch: ConnectionPatch
) -> Connection:
    link = await _manual_connection(session, connection_id)
    changes = patch.model_fields_set
    if "display_name" in changes:
        link.display_name = patch.display_name
    if changes & {"brand_bg", "brand_fg"}:
        link.brand_bg, link.brand_fg = _brand(patch.brand_bg, patch.brand_fg)
    await session.commit()
    return link


@guarded
async def create_account(
    session: AsyncSession, data: AccountIn, now: datetime, zone: tzinfo
) -> Account:
    link = await _manual_connection(session, data.connection_id)
    moment = _instant(data.as_of, now, zone)
    limit = data.credit_limit or 0
    balance = limit - (data.owed or 0) if data.kind == "credit_card" else data.balance or 0
    opened = None
    if data.opened_at:
        opened = datetime.combine(data.opened_at, time.min, tzinfo=zone).astimezone(UTC)
    row = Account(
        connection_id=link.id,
        provider=link.provider,
        external_id=uuid.uuid4().hex,
        name=data.name,
        type=data.type,
        currency=data.currency,
        mask_last4=data.mask_last4,
        balance=balance,
        credit_limit=limit,
        balance_at=moment,
        opened_at=opened,
        kind=data.kind,
        label=data.label,
        overdraft_limit_override=data.overdraft_limit,
        backfill_done=True,  # no collector walks it
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    _touch(link, moment)
    await session.commit()
    return row


@guarded
async def update_account(
    session: AsyncSession, account_id: uuid.UUID, patch: ManualAccountPatch, now: datetime
) -> Account:
    row, _ = await _manual_account(session, account_id, lock=True)
    changes = {name: getattr(patch, name) for name in patch.model_fields_set & MANUAL_FIELDS}
    for name in ("name", "archived", "credit_limit"):
        if name in changes and changes[name] is None:
            raise invalid("That field cannot be cleared")
    if "credit_limit" in changes:
        if row.kind != "credit_card" or not changes["credit_limit"]:
            raise invalid("Only a credit card has a limit, above 0")
        row.balance += changes["credit_limit"] - row.credit_limit  # what is owed stays
        row.credit_limit = changes.pop("credit_limit")
    for name, value in changes.items():
        setattr(row, name, value)
    row.updated_at = now
    await session.commit()
    return row


@guarded
async def set_balance(
    session: AsyncSession, account_id: uuid.UUID, data: BalanceIn, now: datetime, zone: tzinfo
) -> Account:
    row, link = await _manual_account(session, account_id, lock=True)
    if (data.owed is not None) != (row.kind == "credit_card"):
        raise invalid("A credit card takes owed, any other account balance")
    moment = _instant(data.as_of, now, zone)
    row.balance = row.credit_limit - data.owed if data.owed is not None else data.balance or 0
    row.balance_at = moment
    row.updated_at = now
    _touch(link, moment)
    await session.commit()
    return row


# ---- statements ---------------------------------------------------------------------------------


class StatementResult(BaseModel):
    """What an upload did (or, with `dry_run`, would do): totals to check against the bank's own."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    layout: str
    dry_run: bool
    parsed: int
    created: int
    duplicates: int
    first_date: date | None
    last_date: date | None
    money_in: int  # positive: the sum of the lines that add money, in minor units
    money_out: int  # positive: the sum of the lines that take money (declined ones are no money)
    balance_applied: bool
    errors: list[RowErrorOut]


def _errors(items: Sequence[RowError]) -> list[RowErrorOut]:
    return [RowErrorOut.of(e) for e in items]


def _newest_balance(statement: Statement) -> tuple[int, date] | None:
    """The balance of the file's newest line: OFX states one; a CSV's is the newest line's, by
    its time when the file has times, else by the order of the file (a file runs oldest first or
    newest first, told by its first and last dates)."""
    if statement.ledger_balance is not None:
        return statement.ledger_balance
    found = [e for e in statement.entries if e.balance is not None and not e.declined]
    if not found or found[0].balance is None:
        return None
    if all(e.at is not None for e in found):
        newest = max(found, key=lambda e: (e.day, e.at or time.min))
    elif found[0].day < found[-1].day:
        newest = found[-1]
    elif found[0].day > found[-1].day or len({e.balance for e in found}) == 1:
        newest = found[0]
    else:
        raise invalid("The newest balance of the file cannot be told: the lines share a day")
    return None if newest.balance is None else (newest.balance, newest.day)


@guarded
async def import_statement(
    session: AsyncSession,
    account_id: uuid.UUID,
    data: bytes,
    now: datetime,
    zone: tzinfo,
    order: DateOrder | None = None,
    apply_balance: bool = False,
    dry_run: bool = False,
) -> tuple[StatementResult, bool]:
    """Read a downloaded file into an account. All or nothing: any error writes nothing. Lines
    already there (same bank id, or same date, amount and text in the same place) are counted as
    duplicates and left as they are, so loading a file again, or one that overlaps, is safe."""
    row, link = await _manual_account(session, account_id, lock=True)
    try:
        statement = parse_statement(data, row.provider, row.currency, order)
    except UnknownLayout:
        message = "The statement is not in a supported layout"
        raise AppError(422, "unknown_layout", message) from None
    except ValueError:
        raise invalid("The file must be UTF-8 text of at most 2 MiB") from None
    entries = statement.entries
    ok = not statement.errors and bool(entries)
    problems = list(statement.errors) or ([] if entries else [RowError(0, None, "no lines")])
    newest: tuple[int, date] | None = None
    if ok and apply_balance:
        if row.kind == "credit_card":
            raise invalid("Set a credit card's balance with its own endpoint (owed)")
        newest = _newest_balance(statement)
        if newest is None:
            raise invalid("The file has no balance to apply")
    created = duplicates = 0
    applied = False
    if ok:
        numbered = number_entries(str(row.id), entries)
        created, duplicates = await _store(session, row, numbered, now, zone, dry_run)
        if not dry_run:
            latest = max(booked_at(e, zone) for _, e in numbered)
            _touch(link, min(latest, now))
            if newest is not None:
                moment = min(balance_moment(newest[1], zone), now)
                if moment >= row.balance_at:
                    row.balance, row.balance_at, applied = newest[0], moment, True
            row.updated_at = now
        await session.commit()
    days = [e.day for e in entries]
    result = StatementResult(
        layout=statement.layout,
        dry_run=dry_run,
        parsed=len(entries) if ok else 0,
        created=created,
        duplicates=duplicates,
        first_date=min(days) if ok else None,
        last_date=max(days) if ok else None,
        money_in=sum(e.amount for e in entries if e.amount > 0 and not e.declined) if ok else 0,
        money_out=-sum(e.amount for e in entries if e.amount < 0 and not e.declined) if ok else 0,
        balance_applied=applied,
        errors=[] if ok else _errors(problems),
    )
    return result, ok


async def _store(
    session: AsyncSession,
    row: Account,
    numbered: Sequence[tuple[str, Entry]],
    now: datetime,
    zone: tzinfo,
    dry_run: bool,
) -> tuple[int, int]:
    ids = [external for external, _ in numbered]
    known: set[str] = set()
    for start in range(0, len(ids), 2000):
        chunk = ids[start : start + 2000]
        found = await session.scalars(
            select(Transaction.external_id).where(
                Transaction.account_id == row.id, Transaction.external_id.in_(chunk)
            )
        )
        known.update(found)
    fresh = [(external, entry) for external, entry in numbered if external not in known]
    if not dry_run:
        for start in range(0, len(fresh), INSERT_CHUNK):
            values: list[dict[str, Any]] = [
                {
                    "id": uuid.uuid4(),
                    "account_id": row.id,
                    "external_id": external,
                    "booked_at": booked_at(entry, zone),
                    "amount": entry.amount,
                    "currency": row.currency,
                    "description": entry.description,
                    "counterparty": entry.counterparty,
                    "balance_after": entry.balance,
                    "pending": entry.pending,
                    "declined": entry.declined,
                    "internal_transfer": False,
                    "category": categorize(row.provider, None, entry.amount, False),
                    "created_at": now,
                }
                for external, entry in fresh[start : start + INSERT_CHUNK]
            ]
            stmt = insert(Transaction).values(values)
            await session.execute(
                stmt.on_conflict_do_nothing(index_elements=["account_id", "external_id"])
            )
    return len(fresh), len(numbered) - len(fresh)
