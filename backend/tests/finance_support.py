"""Fakes for the finance tests: a Monobank that follows its documented rules, behind MockTransport.

Everything is invented: made-up merchants, round amounts, account ids that are not real ones.
`FakeMonobank` refuses what the real service refuses (a wrong key, a window longer than 31 days
and 1 hour) and cuts a statement at 500 items, newest first, so a test fails the way production
would. Every request is recorded in `calls`.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from pydantic import SecretStr

from src.dashboards.finance.base import FinanceCollector
from src.dashboards.finance.models import Account, Connection, Transaction
from src.dashboards.finance.monobank import MonobankProvider
from tests.collectors_support import json_response
from tests.dashboards_support import FakeClock

MONO_KEY = "mono-test-key-4417"  # a name without "token": ruff S105 reads it as a password
MAX_SPAN = 2_682_000  # 31 days and 1 hour, the documented longest statement window
PAGE = 500


def ts(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp())


def mono_account(
    account_id: str = "acc-black-uah",
    *,
    currency: int = 980,
    balance: int = 1_250_000,
    credit: int = 0,
    kind: str = "black",
    pan: str | None = "537541******1234",
    iban: str = "UA213220010000026207301234567",
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": account_id,
        "sendId": "sample-send-id",
        "balance": balance,
        "creditLimit": credit,
        "type": kind,
        "currencyCode": currency,
        "cashbackType": "UAH",
        "maskedPan": [pan] if pan else [],
        "iban": iban,
    }
    return row


def mono_item(
    item_id: str,
    time: int,
    amount: int,
    description: str = "Corner Cafe",
    *,
    currency: int = 980,
    operation: int | None = None,
    mcc: int = 5812,
    hold: bool = False,
    balance: int = 1_000_000,
    counter: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": item_id,
        "time": time,
        "description": description,
        "mcc": mcc,
        "originalMcc": mcc,
        "hold": hold,
        "amount": amount,
        "operationAmount": amount if operation is None else operation,
        "currencyCode": currency,
        "commissionRate": 0,
        "cashbackAmount": 0,
        "balance": balance,
    }
    if counter is not None:
        row["counterName"] = counter
    return row


class FakeMonobank:
    """The transport handler. `accounts` and `statements` can be changed between requests;
    `failures` holds answers to give (one per statement request, `None` for a normal one)."""

    def __init__(
        self, accounts: list[dict[str, Any]], statements: dict[str, list[dict[str, Any]]]
    ) -> None:
        self.accounts = accounts
        self.statements = statements
        self.calls: list[tuple[Any, ...]] = []
        self.failures: list[httpx.Response | None] = []
        self.client_info_failures: list[httpx.Response] = []
        self.key = MONO_KEY
        self.headers_seen: list[dict[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.headers_seen.append(dict(request.headers))
        if request.url.host != "api.monobank.ua":
            return json_response({"errorDescription": "wrong host"}, 404)
        if request.headers.get("x-token") != self.key:
            return json_response({"errorDescription": "Unknown 'X-Token'"}, 403)
        parts = request.url.path.strip("/").split("/")
        if parts == ["personal", "client-info"]:
            self.calls.append(("client-info",))
            if self.client_info_failures:
                return self.client_info_failures.pop(0)
            return json_response(
                {"clientId": "sample-client", "name": "Sample Client", "accounts": self.accounts}
            )
        if len(parts) == 5 and parts[:2] == ["personal", "statement"]:
            account, start, end = parts[2], int(parts[3]), int(parts[4])
            self.calls.append(("statement", account, start, end))
            if self.failures:
                failure = self.failures.pop(0)
                if failure is not None:
                    return failure
            if end - start > MAX_SPAN:
                return json_response({"errorDescription": "Too long period"}, 400)
            rows = [r for r in self.statements.get(account, []) if start <= r["time"] <= end]
            rows.sort(key=lambda r: r["time"], reverse=True)
            return json_response(rows[:PAGE])
        return json_response({"errorDescription": "not found"}, 404)

    def statement_calls(self) -> list[tuple[Any, ...]]:
        return [call for call in self.calls if call[0] == "statement"]


def client_for(fake: FakeMonobank) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(fake))


def collector(months: int = 12) -> FinanceCollector:
    return FinanceCollector(MonobankProvider(SecretStr(MONO_KEY)), months)


async def drive(
    finance: FinanceCollector,
    client: httpx.AsyncClient,
    sessions: Any,
    clock: FakeClock,
    ticks: int,
    step: timedelta = timedelta(seconds=90),
) -> list[dict[str, int]]:
    """`ticks` calls of `collect`, `step` apart on the fake clock; returns each tick's counts."""
    results = []
    for _ in range(ticks):
        results.append(await finance.collect(client, sessions, clock.now))
        clock.now += step
    return results


def server_error() -> httpx.Response:
    return json_response({"errorDescription": "boom"}, 500)


def rate_limited() -> httpx.Response:
    return json_response({"errorDescription": "Too many requests"}, 429, {"retry-after": "60"})


def forbidden() -> httpx.Response:
    return json_response({"errorDescription": "Unknown 'X-Token'"}, 403)


LINK = uuid.UUID(int=1)
ACC_A = uuid.UUID(int=10)  # UAH, open
ACC_B = uuid.UUID(int=11)  # EUR, open
ACC_C = uuid.UUID(int=12)  # UAH, archived
NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)


def at(month: int, day: int, hour: int = 10, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


def tx(n: int, account: uuid.UUID, when: datetime, amount: int, text: str, **extra: Any) -> Any:
    """Transaction number n (its id is 1000 + n) of an account, in the account's currency."""
    return Transaction(
        id=uuid.UUID(int=1000 + n),
        account_id=account,
        external_id=f"ext-{n}",
        booked_at=when,
        amount=amount,
        currency="EUR" if account == ACC_B else "UAH",
        description=text,
        **extra,
    )


def account(account_id: uuid.UUID, name: str, currency: str, balance: int, **extra: Any) -> Any:
    return Account(
        id=account_id,
        connection_id=LINK,
        provider="sample",
        external_id=name.lower(),
        name=name,
        currency=currency,
        balance=balance,
        balance_at=NOW,
        **extra,
    )


async def seed(app: Any) -> None:
    """One link, three accounts and eight transactions around the November 2026 month edge. The
    first two (ids 1002 and 1001) share one instant, so the higher id comes first."""
    accounts = [
        account(
            ACC_A, "Main", "UAH", 1_250_000, type="black", mask_last4="1234", credit_limit=500_000
        ),
        account(ACC_B, "Euro", "EUR", 33_300),
        account(ACC_C, "Old", "UAH", 999, archived=True),
    ]
    october_end = datetime(2026, 10, 31, 23, 30, tzinfo=UTC)
    rows = [
        tx(2, ACC_A, at(11, 20), -45_000, "Corner Cafe", category_code="5812"),
        tx(1, ACC_A, at(11, 20), -12_000, "Bakery Example"),
        tx(7, ACC_B, at(11, 19), 10_000, "Refund", original_amount=11_000, original_currency="USD"),
        tx(6, ACC_B, at(11, 18), -2_500, "Acme Grocery", pending=True),
        tx(3, ACC_A, at(11, 15, 9), 1_000_000, "Payroll", counterparty="Globex Ltd"),
        tx(8, ACC_C, at(11, 10), -300, "Old card"),
        tx(4, ACC_A, at(11, 1, 0, 30), -500, "Subscription 100% fun"),
        tx(5, ACC_A, october_end, -7_000, "Old purchase"),
    ]
    link = Connection(id=LINK, provider="sample", ref="main", status="ok", last_ok_at=NOW)
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add(link)
        await session.flush()  # the models declare no relationships: parents go in first
        session.add_all(accounts)
        await session.flush()
        session.add_all(rows)


NEWEST_FIRST = [1002, 1001, 1007, 1006, 1003, 1008, 1004, 1005]  # transaction ids
