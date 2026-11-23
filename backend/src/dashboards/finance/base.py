"""What every bank provider shares: the neutral data shapes and the collector that drives one.

A provider (`monobank.py`) only knows how to ask its bank: list the accounts with their balances,
and fetch one statement window. Everything else is here and the same for every bank:

- Money is an integer in minor units plus an ISO 4217 alpha code. A provider that cannot give
  that raises instead of guessing; there is no float anywhere.
- One tick makes at most one provider request, and never two within the provider's minimum gap
  (kept in memory against the manager's clock). Accounts and balances are refreshed a few times an
  hour, then each account's newest window, and only when nothing else is due one step of the
  slow history walk.
- A statement window is fetched whole (several pages when the provider's page is full) in memory
  and written in one transaction together with the cursor move; a failed or cut-off fetch changes
  nothing and the window is simply asked for again. Rows are upserted by (account, external id),
  so the overlap of every window with the one before it only refreshes rows.
- Provider-specific auth or consent state is kept out of the shared tables. What the page may show
  about a link is `connection.status`: `ok`, `needs_reconsent` (the provider refused the
  credential) or `paused` (set by hand; the collector then makes no call).

Nothing here logs an amount, a description, a counterparty, an account number or a token: the
manager logs the collector name, the counts this returns and an error kind.
"""

import calendar
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol

import httpx
from sqlalchemy import literal_column, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError
from src.dashboards.finance.models import Account, Connection, Transaction

logger = logging.getLogger("yuriodev.finance")

OVERLAP = timedelta(days=3)  # every incremental window starts this far before the last one ended
MAX_PAGES = 10  # a window of more than this many full pages is refused, never half stored
EMPTY_WINDOWS_AT_END = 3  # this many empty windows in a row: the provider's history ended
INSERT_CHUNK = 500


@dataclass(frozen=True)
class AccountData:
    external_id: str
    name: str
    type: str | None
    currency: str
    mask_last4: str | None
    balance: int
    credit_limit: int


@dataclass(frozen=True)
class TransactionData:
    external_id: str
    booked_at: datetime
    amount: int
    currency: str
    original_amount: int | None
    original_currency: str | None
    description: str
    counterparty: str | None
    category_code: str | None
    balance_after: int | None
    pending: bool


class FinanceProvider(Protocol):
    """One bank. The limits are the provider's documented ones, see its module."""

    name: str  # the provider column of the rows, and the collector name in logs
    ref: str  # which link of this provider (one token, one consent)
    min_call_gap: timedelta  # at least this long between two requests
    refresh_every: timedelta  # accounts and balances, and each account's newest window
    max_window: timedelta  # the longest statement window one request may span
    page_limit: int  # a statement answer of this many items may have more behind it

    async def fetch_accounts(self, client: httpx.AsyncClient) -> list[AccountData]: ...

    async def fetch_statement(
        self,
        client: httpx.AsyncClient,
        external_id: str,
        currency: str,
        start: datetime,
        end: datetime,
    ) -> list[TransactionData]:
        """One page of the account's statement for [start, end]: at most `page_limit` items,
        the newest ones when there are more."""
        ...


def months_back(moment: datetime, months: int) -> datetime:
    """`moment` minus whole calendar months (the day is cut to the month's length)."""
    index = moment.year * 12 + moment.month - 1 - months
    year, month0 = divmod(index, 12)
    day = min(moment.day, calendar.monthrange(year, month0 + 1)[1])
    return moment.replace(year=year, month=month0 + 1, day=day)


@dataclass
class _Window:
    kind: str  # initial | incremental | backfill
    account_id: uuid.UUID
    external_id: str
    currency: str
    start: datetime
    end: datetime  # the end of the whole window
    cursor: datetime  # the end of the page asked for next
    depth_limit: datetime
    caught_up: bool  # an incremental window that ends at the moment it was planned
    items: dict[str, TransactionData] = field(default_factory=dict)
    pages: int = 0


@dataclass(frozen=True)
class _Cursors:
    id: uuid.UUID
    external_id: str
    currency: str
    synced_until: datetime | None
    backfilled_from: datetime | None
    backfill_done: bool
    empty_streak: int


class FinanceCollector:
    """Drives one provider. `collect` is the manager's per-tick call."""

    def __init__(self, provider: FinanceProvider, backfill_months: int) -> None:
        self.name = provider.name
        self._provider = provider
        self._backfill_months = backfill_months
        self._next_call_at: datetime | None = None
        self._last_refresh: datetime | None = None
        self._last_caught_up: dict[str, datetime] = {}
        self._window: _Window | None = None

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        counts = {"calls": 0, "accounts": 0, "windows": 0, "added": 0, "updated": 0}
        if self._next_call_at is not None and now < self._next_call_at:
            return counts
        connection_id, status = await self._connection(sessions, now)
        if status == "paused":
            return counts
        try:
            await self._step(client, sessions, now, connection_id, counts)
        except UpstreamError as exc:
            self._window = None  # a partial fetch is thrown away; the window is asked again
            gap = self._provider.refresh_every if exc.kind == "auth" else self._gap()
            self._next_call_at = now + gap
            await self._failed(sessions, connection_id, now, exc.kind)
            raise
        except Exception:
            self._window = None
            self._next_call_at = now + self._gap()
            raise
        if counts["calls"]:
            await self._succeeded(sessions, connection_id, now)
        return counts

    def _gap(self) -> timedelta:
        return self._provider.min_call_gap

    def _called(self, now: datetime, counts: dict[str, int]) -> None:
        counts["calls"] += 1
        self._next_call_at = now + self._gap()

    async def _step(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
        connection_id: uuid.UUID,
        counts: dict[str, int],
    ) -> None:
        if self._window is None:
            refresh_due = (
                self._last_refresh is None
                or now - self._last_refresh >= self._provider.refresh_every
            )
            if refresh_due:
                self._called(now, counts)
                accounts = await self._provider.fetch_accounts(client)
                counts["accounts"] = await self._store_accounts(
                    sessions, connection_id, accounts, now
                )
                self._last_refresh = now
                return
            self._window = await self._plan(sessions, now)
            if self._window is None:
                return
        self._called(now, counts)
        window = self._window
        page = await self._provider.fetch_statement(
            client, window.external_id, window.currency, window.start, window.cursor
        )
        window.pages += 1
        for item in page:
            window.items[item.external_id] = item
        full = len(page) >= self._provider.page_limit
        if full:
            if window.pages >= MAX_PAGES:
                raise UpstreamError("too_large", 200)
            oldest = min(item.booked_at for item in page)
            # `oldest` itself is asked for again (the rows are deduplicated); step back a second
            # only when a whole page sits in one second, so the walk always ends.
            window.cursor = min(oldest, window.cursor - timedelta(seconds=1))
            full = window.cursor > window.start
        if not full:
            counts["windows"] = 1
            counts["added"], counts["updated"] = await self._finish(sessions, window, now)
            self._window = None

    async def _plan(
        self, sessions: async_sessionmaker[AsyncSession], now: datetime
    ) -> _Window | None:
        """The next statement window to fetch, or None when nothing is due."""
        provider = self._provider
        depth_limit = months_back(now, self._backfill_months)
        async with sessions() as session:
            rows = (
                await session.execute(
                    select(
                        Account.id,
                        Account.external_id,
                        Account.currency,
                        Account.synced_until,
                        Account.backfilled_from,
                        Account.backfill_done,
                        Account.empty_streak,
                    )
                    .where(Account.provider == provider.name, Account.archived.is_(False))
                    .order_by(Account.created_at, Account.external_id)
                )
            ).all()
        accounts = [_Cursors(*row) for row in rows]
        for cursors in accounts:
            caught = self._last_caught_up.get(cursors.external_id)
            if caught is not None and now - caught < provider.refresh_every:
                continue
            if cursors.synced_until is None:
                start = now - provider.max_window
                return self._window_for("initial", cursors, (start, now), depth_limit, True)
            start = cursors.synced_until - OVERLAP
            end = min(start + provider.max_window, now)
            return self._window_for("incremental", cursors, (start, end), depth_limit, end >= now)
        for cursors in accounts:
            if cursors.backfill_done or cursors.backfilled_from is None:
                continue
            end = cursors.backfilled_from
            if end <= depth_limit:
                await self._mark_backfill_done(sessions, cursors.id)
                continue
            start = max(end - provider.max_window, depth_limit)
            return self._window_for("backfill", cursors, (start, end), depth_limit, False)
        return None

    def _window_for(
        self,
        kind: str,
        cursors: _Cursors,
        span: tuple[datetime, datetime],
        depth_limit: datetime,
        caught_up: bool,
    ) -> _Window:
        start, end = span
        return _Window(
            kind=kind,
            account_id=cursors.id,
            external_id=cursors.external_id,
            currency=cursors.currency,
            start=start,
            end=end,
            cursor=end,
            depth_limit=depth_limit,
            caught_up=caught_up,
        )

    async def _mark_backfill_done(
        self, sessions: async_sessionmaker[AsyncSession], account_id: uuid.UUID
    ) -> None:
        async with sessions() as session, session.begin():
            await session.execute(
                update(Account).where(Account.id == account_id).values(backfill_done=True)
            )

    async def _finish(
        self, sessions: async_sessionmaker[AsyncSession], window: _Window, now: datetime
    ) -> tuple[int, int]:
        """Write the whole window and move the cursors, in one transaction."""
        rows = [
            {
                "account_id": window.account_id,
                "external_id": item.external_id,
                "booked_at": item.booked_at,
                "amount": item.amount,
                "currency": item.currency,
                "original_amount": item.original_amount,
                "original_currency": item.original_currency,
                "description": item.description,
                "counterparty": item.counterparty,
                "category_code": item.category_code,
                "balance_after": item.balance_after,
                "pending": item.pending,
            }
            for item in window.items.values()
        ]
        added = updated = 0
        async with sessions() as session, session.begin():
            for index in range(0, len(rows), INSERT_CHUNK):
                chunk = insert(Transaction).values(rows[index : index + INSERT_CHUNK])
                fresh = {
                    name: chunk.excluded[name]
                    for name in rows[0]
                    if name not in ("account_id", "external_id")
                }
                outcome: Sequence[Any] = (
                    await session.execute(
                        chunk.on_conflict_do_update(
                            index_elements=[Transaction.account_id, Transaction.external_id],
                            set_=fresh,
                        ).returning(literal_column("(xmax = 0)"))
                    )
                ).all()
                added += sum(1 for (is_new,) in outcome if is_new)
                updated += sum(1 for (is_new,) in outcome if not is_new)
            moved = await self._cursor_values(session, window, now)
            await session.execute(
                update(Account).where(Account.id == window.account_id).values(**moved)
            )
        if window.caught_up:
            self._last_caught_up[window.external_id] = now
        return added, updated

    async def _cursor_values(
        self, session: AsyncSession, window: _Window, now: datetime
    ) -> dict[str, object]:
        if window.kind == "initial":
            return {
                "synced_until": window.end,
                "backfilled_from": window.start,
                "empty_streak": 0,
                "updated_at": now,
            }
        if window.kind == "incremental":
            return {"synced_until": window.end, "updated_at": now}
        streak = 0 if window.items else await self._streak(session, window.account_id) + 1
        done = window.start <= window.depth_limit or streak >= EMPTY_WINDOWS_AT_END
        return {
            "backfilled_from": window.start,
            "empty_streak": streak,
            "backfill_done": done,
            "updated_at": now,
        }

    async def _streak(self, session: AsyncSession, account_id: uuid.UUID) -> int:
        streak = await session.scalar(select(Account.empty_streak).where(Account.id == account_id))
        return int(streak or 0)

    async def _connection(
        self, sessions: async_sessionmaker[AsyncSession], now: datetime
    ) -> tuple[uuid.UUID, str]:
        provider = self._provider
        async with sessions() as session, session.begin():
            await session.execute(
                insert(Connection)
                .values(provider=provider.name, ref=provider.ref, status_changed_at=now)
                .on_conflict_do_nothing(index_elements=[Connection.provider, Connection.ref])
            )
            row = (
                await session.execute(
                    select(Connection.id, Connection.status).where(
                        Connection.provider == provider.name, Connection.ref == provider.ref
                    )
                )
            ).one()
        return row.id, row.status

    async def _store_accounts(
        self,
        sessions: async_sessionmaker[AsyncSession],
        connection_id: uuid.UUID,
        accounts: list[AccountData],
        now: datetime,
    ) -> int:
        provider = self._provider
        async with sessions() as session, session.begin():
            for data in accounts:
                values = {
                    "name": data.name,
                    "type": data.type,
                    "currency": data.currency,
                    "mask_last4": data.mask_last4,
                    "balance": data.balance,
                    "credit_limit": data.credit_limit,
                    "balance_at": now,
                    "archived": False,
                    "updated_at": now,
                }
                statement = insert(Account).values(
                    connection_id=connection_id,
                    provider=provider.name,
                    external_id=data.external_id,
                    **values,
                )
                await session.execute(
                    statement.on_conflict_do_update(
                        index_elements=[Account.provider, Account.external_id], set_=values
                    )
                )
            if accounts:  # an empty answer proves nothing: never archive everything on it
                await session.execute(
                    update(Account)
                    .where(
                        Account.connection_id == connection_id,
                        Account.external_id.not_in([data.external_id for data in accounts]),
                    )
                    .values(archived=True, updated_at=now)
                )
        return len(accounts)

    async def _succeeded(
        self, sessions: async_sessionmaker[AsyncSession], connection_id: uuid.UUID, now: datetime
    ) -> None:
        async with sessions() as session, session.begin():
            row = await session.get(Connection, connection_id)
            if row is None:
                return
            if row.status == "needs_reconsent":
                row.status = "ok"
                row.status_changed_at = now
                self._log_status(row.status)
            row.last_ok_at = now
            row.last_error = None

    async def _failed(
        self,
        sessions: async_sessionmaker[AsyncSession],
        connection_id: uuid.UUID,
        now: datetime,
        kind: str,
    ) -> None:
        async with sessions() as session, session.begin():
            row = await session.get(Connection, connection_id)
            if row is None:
                return
            row.last_error = kind[:32]
            if kind == "auth" and row.status == "ok":
                row.status = "needs_reconsent"
                row.status_changed_at = now
                self._log_status(row.status)

    def _log_status(self, status: str) -> None:
        logger.warning(
            "finance connection status changed",
            extra={
                "event": "finance.connection_status",
                "collector": self.name,
                "status": status,
            },
        )
