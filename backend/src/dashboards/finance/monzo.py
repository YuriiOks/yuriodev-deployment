"""Monzo, through its developer API (https://docs.monzo.com/), for the owner's own accounts.

What the documentation says, and what this module relies on:

- Bearer access tokens from the OAuth flow in `monzo_auth.py`. The token has no permission until
  the owner approves the client in the Monzo app; until then the API answers 403.
- `GET /accounts` (and `?account_type=uk_retail_joint` for joint accounts), `GET /balance`
  (`balance` in minor units, the money in the account without its pots; `currency`),
  `GET /pots?current_account_id=` (pots with their own balances; a pot has no statement),
  `GET /transactions?account_id&since&before&limit` (limit at most 100; `since`/`before` are
  RFC 3339 timestamps or, for `since`, an object id; `expand[]=merchant`).
- Strong customer authentication: right after the owner approves, the whole history can be read;
  after five minutes only the last 90 days. So the history is fetched as fast as the limits
  allow in that window (`burst`), newest to oldest, a 90-day window at a time, and never asked for
  beyond 90 days once it has closed (`history_floor`).
- A transaction has `amount` (minor units, negative is money out), `currency`, `description`,
  `created`, `settled` (empty while pending), `category`, `merchant` (an id, or an object with
  `expand[]=merchant`) and `decline_reason` on a declined one.
- The documentation names no rate limit (only that a 429 means back off) and does not list
  every field. These are used when present and are not required: `local_amount` and
  `local_currency` (the amount in the currency it was spent in), `account_balance` and, for a pot
  transfer, `metadata.pot_id` or a `uk_retail_pot` scheme or a description that is the pot's id.
  Requests are kept one second apart.

Not kept: addresses, coordinates, logos, notes, counterparty account numbers. The merchant's name
is the counterparty. Account names are neutral ("Current account"), never the holder's name.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError, get_json_capped
from src.dashboards.finance.base import AccountData, ProviderDefaults, TransactionData
from src.dashboards.finance.monzo_auth import (
    API_URL,
    TokenView,
    mark_approved,
    token_view,
    usable_token,
)
from src.dashboards.finance.parsing import bad, iso_code, parse_time, safe_id, text, whole

PAGE = 100
MAX_WINDOW_PAGES = 60  # a 90-day window of more than 6000 transactions is refused, not guessed
WINDOW_AFTER_APPROVAL = timedelta(minutes=5)
HISTORY_LIMIT = timedelta(days=89)  # a day inside the 90 days the API answers after the window
FAST_BURST = 60  # requests per tick while the five minutes last
STEADY_BURST = 3
POLL_EVERY = 5.0  # seconds between asking whether the owner has approved yet
POLL_BUDGET = 100.0  # seconds of asking per tick (the manager gives a run 120)
ACCOUNT_LABELS = {"uk_retail": "Current account", "uk_retail_joint": "Joint account"}


class MonzoProvider(ProviderDefaults):
    name = "monzo"
    ref = "personal"
    min_call_gap = timedelta(seconds=1)
    refresh_every = timedelta(minutes=20)
    max_window = timedelta(days=90)
    page_limit = 10**9  # a window's pages are walked inside `fetch_statement`
    full_history = True
    statement_less_types = frozenset({"pot"})

    def __init__(
        self,
        client_id: SecretStr,
        client_secret: SecretStr,
        sessions: async_sessionmaker[AsyncSession],
        clock: Callable[[], datetime],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._sessions = sessions
        self._clock = clock
        self._sleep = sleep
        self._window_until: datetime | None = None  # approval + five minutes

    def _in_window(self, now: datetime) -> bool:
        return self._window_until is not None and now < self._window_until

    def burst(self, now: datetime) -> int:
        return FAST_BURST if self._in_window(now) else STEADY_BURST

    def history_floor(self, now: datetime) -> datetime | None:
        return None if self._in_window(now) else now - HISTORY_LIMIT

    async def needs_attention(self, now: datetime) -> bool:
        """True while the owner has consented but the API still says wait for the app."""
        view = await token_view(self._sessions)
        return view is not None and view.approved_at is None and now <= view.approval_deadline

    async def _get(
        self, client: httpx.AsyncClient, token: str, path: str, params: dict[str, str | int] | None
    ) -> Any:
        body, _ = await get_json_capped(
            client, f"{API_URL}{path}", headers={"Authorization": f"Bearer {token}"}, params=params
        )
        return body

    async def _first_accounts(self, client: httpx.AsyncClient, view: TokenView) -> Any:
        """The accounts answer. Before the in-app approval the API refuses (403): keep asking, for
        a while per tick and until the approval deadline, instead of failing."""
        waited = 0.0
        while True:
            try:
                return await self._get(client, view.access_token, "/accounts", None)
            except UpstreamError as exc:
                if exc.status != 403 or view.approved_at is not None:
                    raise
                if self._clock() > view.approval_deadline:
                    raise UpstreamError("auth", 403) from None  # never approved in time
                if waited >= POLL_BUDGET:
                    raise UpstreamError("awaiting_approval", 403) from None
            await self._sleep(POLL_EVERY)
            waited += POLL_EVERY

    async def fetch_accounts(self, client: httpx.AsyncClient) -> list[AccountData]:
        view = await usable_token(
            client, self._sessions, self._client_id, self._client_secret, self._clock()
        )
        body = await self._first_accounts(client, view)
        approved = view.approved_at or await mark_approved(self._sessions, self._clock())
        self._window_until = approved + WINDOW_AFTER_APPROVAL
        found = parse_account_rows(body, "uk_retail")
        await self._sleep(self.min_call_gap.total_seconds())
        try:
            joint = await self._get(
                client, view.access_token, "/accounts", {"account_type": "uk_retail_joint"}
            )
        except UpstreamError as exc:
            if exc.kind not in ("not_found", "bad_status"):
                raise
            joint = {"accounts": []}
        for row_id, row in parse_account_rows(joint, "uk_retail_joint").items():
            found[row_id] = row
        accounts: list[AccountData] = []
        seen: set[str] = set()
        for row_id, row in found.items():
            await self._sleep(self.min_call_gap.total_seconds())
            balance = await self._get(client, view.access_token, "/balance", {"account_id": row_id})
            account = parse_current(row_id, row, balance)
            accounts.append(account)
            await self._sleep(self.min_call_gap.total_seconds())
            pots = await self._get(
                client, view.access_token, "/pots", {"current_account_id": row_id}
            )
            for pot in parse_pots(pots):
                if pot.external_id not in seen:
                    seen.add(pot.external_id)
                    accounts.append(pot)
        return accounts

    async def fetch_statement(
        self,
        client: httpx.AsyncClient,
        external_id: str,
        currency: str,
        start: datetime,
        end: datetime,
    ) -> list[TransactionData]:
        """Every transaction in [start, end]: pages of 100 are walked here, whichever way the
        API orders them, so a window is whole or an error."""
        view = await usable_token(
            client, self._sessions, self._client_id, self._client_secret, self._clock()
        )
        found: dict[str, TransactionData] = {}
        since, before = start, end + timedelta(seconds=1)
        for _ in range(MAX_WINDOW_PAGES):
            params: dict[str, str | int] = {
                "account_id": external_id,
                "since": rfc3339(since),
                "before": rfc3339(before),
                "limit": PAGE,
                "expand[]": "merchant",
            }
            body = await self._get(client, view.access_token, "/transactions", params)
            page = parse_transactions(body, currency)
            for item in page:
                found[item.external_id] = item
            if len(page) < PAGE:
                return list(found.values())
            stamps = [item.booked_at for item in page]
            if stamps[0] <= stamps[-1]:  # oldest first: the next page starts at the newest
                if max(stamps) <= since:
                    raise UpstreamError("too_large", 200)
                since = max(stamps)
            else:  # newest first: the next page ends at the oldest
                if min(stamps) + timedelta(seconds=1) >= before:
                    raise UpstreamError("too_large", 200)
                before = min(stamps) + timedelta(seconds=1)
            await self._sleep(self.min_call_gap.total_seconds())
        raise UpstreamError("too_large", 200)


def rfc3339(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_account_rows(body: Any, kind: str) -> dict[str, dict[str, Any]]:
    """The open accounts of an answer by id, each with the account type it was asked as."""
    rows = body.get("accounts") if isinstance(body, dict) else None
    if not isinstance(rows, list):
        raise bad()
    found: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise bad()
        row_id = safe_id(row.get("id"))
        if row.get("closed") is True:
            continue
        found[row_id] = {"type": kind, "created": row.get("created")}
    return found


def opened(value: object) -> datetime | None:
    try:
        return parse_time(value)
    except UpstreamError:
        return None


def parse_current(row_id: str, row: dict[str, Any], balance: Any) -> AccountData:
    if not isinstance(balance, dict):
        raise bad()
    currency = iso_code(balance.get("currency"))
    kind = row["type"]
    return AccountData(
        external_id=row_id,
        name=f"{ACCOUNT_LABELS.get(kind, 'Account')} {currency}",
        type=kind,
        currency=currency,
        mask_last4=None,
        balance=whole(balance.get("balance")),  # without the pots: they are accounts too
        credit_limit=0,
        opened_at=opened(row.get("created")),
    )


def parse_pots(body: Any) -> list[AccountData]:
    rows = body.get("pots") if isinstance(body, dict) else None
    if not isinstance(rows, list):
        raise bad()
    pots: list[AccountData] = []
    for row in rows:
        if not isinstance(row, dict):
            raise bad()
        if row.get("deleted") is True:
            continue
        currency = iso_code(row.get("currency"))
        pots.append(
            AccountData(
                external_id=safe_id(row.get("id")),
                name=text(row.get("name"), 100) or f"Pot {currency}",
                type="pot",
                currency=currency,
                mask_last4=None,
                balance=whole(row.get("balance")),
                credit_limit=0,
                opened_at=opened(row.get("created")),
            )
        )
    return pots


def parse_transactions(body: Any, account_currency: str) -> list[TransactionData]:
    rows = body.get("transactions") if isinstance(body, dict) else None
    if not isinstance(rows, list):
        raise bad()
    return [parse_transaction(row, account_currency) for row in rows]


def is_pot_transfer(row: dict[str, Any]) -> bool:
    metadata = row.get("metadata")
    description = row.get("description")
    return (
        (isinstance(metadata, dict) and isinstance(metadata.get("pot_id"), str))
        or row.get("scheme") == "uk_retail_pot"
        or (isinstance(description, str) and description.startswith("pot_"))
    )


def parse_transaction(row: Any, account_currency: str) -> TransactionData:
    if not isinstance(row, dict):
        raise bad()
    booked = parse_time(row.get("created"))
    settled_raw = row.get("settled")
    settled = None if settled_raw in (None, "") else parse_time(settled_raw)
    declined = isinstance(row.get("decline_reason"), str)
    merchant = row.get("merchant")
    name = text(merchant.get("name"), 200) if isinstance(merchant, dict) else None
    category = row.get("category")
    if isinstance(merchant, dict) and not isinstance(category, str):
        category = merchant.get("category")
    if name is None and isinstance(row.get("counterparty"), dict):
        name = text(row["counterparty"].get("name"), 200)
    original_amount: int | None = None
    original_currency: str | None = None
    local_amount, local_currency = row.get("local_amount"), row.get("local_currency")
    if (
        isinstance(local_amount, int)
        and not isinstance(local_amount, bool)
        and isinstance(local_currency, str)
        and local_currency != account_currency
    ):
        original_amount, original_currency = local_amount, iso_code(local_currency)
    after = row.get("account_balance")
    return TransactionData(
        external_id=safe_id(row.get("id")),
        booked_at=booked,
        amount=whole(row.get("amount")),
        currency=account_currency,
        original_amount=original_amount,
        original_currency=original_currency,
        description=text(row.get("description"), 500) or "",
        counterparty=name,
        category_code=text(category, 16),
        balance_after=None if after is None else whole(after),
        pending=settled is None and not declined,
        internal_transfer=is_pot_transfer(row),
        declined=declined,
        settled_at=settled,
    )
