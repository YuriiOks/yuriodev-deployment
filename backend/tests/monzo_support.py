"""A Monzo that follows its documented rules, behind MockTransport.

Everything is invented. `FakeMonzo` checks the OAuth client and the single-use code, refuses a
refresh token that is not the current one (a refresh is one time), answers 403 until the owner has
"approved in the app", and, once five minutes after the approval have passed, refuses to read
further back than 90 days: the strong-customer-authentication rules of the documentation. Its
transaction list gives the first 100 after `since` (oldest first) or the newest 100 before `before`
(`order`), like the two orderings a client may meet.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs

import httpx

from src.dashboards.finance.monzo_auth import TokenPair
from tests.collectors_support import json_response
from tests.dashboards_support import FakeClock

MZ_ID = "oauth2client_sample0001"
MZ_SECRET = "mz-client-value-4471"
MZ_BASE = "https://dev.example.test"
MZ_REDIRECT = f"{MZ_BASE}/api/dashboards/v1/finance/monzo/callback"
ACCOUNT = "acc_00009237aqC8c5umZmrRdh"
POT = "pot_0000778xxfgh4iu8z83nWb"


def stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def monzo_tx(
    n: int,
    created: datetime,
    amount: int,
    description: str = "Corner Cafe",
    *,
    merchant: str | None = "Corner Cafe Ltd",
    settled: bool = True,
    decline: str | None = None,
    local: tuple[int, str] | None = None,
    pot: bool = False,
    category: str = "eating_out",
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": f"tx_{n:022d}",
        "amount": amount,
        "created": stamp(created),
        "currency": "GBP",
        "description": description,
        "merchant": None,
        "metadata": {"notes": "NOTE-SENTINEL-1", "pot_id": POT} if pot else {},
        "notes": "NOTE-SENTINEL-1",
        "is_load": False,
        "settled": stamp(created + timedelta(days=1)) if settled else "",
        "category": category,
        "account_balance": 100_000,
    }
    if merchant is not None:
        row["merchant"] = {
            "id": "merch_1",
            "name": merchant,
            "category": category,
            "address": {"address": "ADDRESS-SENTINEL-9", "latitude": 51.5, "longitude": -0.1},
        }
    if decline is not None:
        row["decline_reason"] = decline
    if local is not None:
        row["local_amount"], row["local_currency"] = local
    return row


class FakeMonzo:
    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.code: str | None = "code-1"
        self.approve_after: int | None = 0  # /accounts answers 403 for this many calls first
        self.approved_at: datetime | None = None
        self.accounts_calls = 0
        self.expires_in = 21_600
        self.fail_refresh = False
        self.refresh_calls = 0
        self.exchange_calls = 0
        self.issued = 0
        self.access = ""
        self.refresh = ""
        self.accounts = [
            {"id": ACCOUNT, "description": "Sample Holder", "created": "2023-11-22T00:00:00Z"}
        ]
        self.joint: list[dict[str, Any]] = []
        self.balance = {"balance": 150_000, "total_balance": 200_000, "currency": "GBP"}
        self.pots = [
            {"id": POT, "name": "Holiday", "balance": 50_000, "currency": "GBP", "deleted": False}
        ]
        self.transactions: list[dict[str, Any]] = []
        self.order = "ascending"
        self.calls: list[tuple[str, str, dict[str, str]]] = []

    def new_pair(self) -> TokenPair:
        self.issued += 1
        self.access = f"access-token-{self.issued}"
        self.refresh = f"refresh-token-{self.issued}"
        return TokenPair(self.access, self.refresh, self.expires_in, "user_00009sample")

    def _token_answer(self) -> httpx.Response:
        pair = self.new_pair()
        body = {
            "access_token": pair.access_token,
            "client_id": MZ_ID,
            "expires_in": pair.expires_in,
            "refresh_token": pair.refresh_token,
            "token_type": "Bearer",
            "user_id": pair.user_id,
        }
        return json_response(body)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        params = {key: values[0] for key, values in parse_qs(request.url.query.decode()).items()}
        path = request.url.path
        self.calls.append((request.method, path, params))
        if request.url.host != "api.monzo.com":
            return json_response({"error": "wrong host"}, 404)
        if path == "/oauth2/token" and request.method == "POST":
            return self._token(parse_qs(request.content.decode()))
        if request.headers.get("authorization") != f"Bearer {self.access}":
            return json_response({"code": "unauthorized.bad_access_token"}, 401)
        if path == "/accounts":
            return self._accounts(params)
        if self.approved_at is None:
            return json_response({"code": "forbidden.insufficient_permissions"}, 403)
        if path == "/balance":
            return json_response(self.balance)
        if path == "/pots":
            return json_response({"pots": self.pots})
        if path == "/transactions":
            return self._transactions(params)
        return json_response({"error": "not found"}, 404)

    def _token(self, form: dict[str, list[str]]) -> httpx.Response:
        grant = form.get("grant_type", [""])[0]
        right_client = (
            form.get("client_id") == [MZ_ID] and form.get("client_secret") == [MZ_SECRET]
        )
        if not right_client:
            return json_response({"error": "invalid_client"}, 401)
        if grant == "authorization_code":
            self.exchange_calls += 1
            if self.code is None or form.get("code") != [self.code]:
                return json_response({"error": "invalid_grant"}, 400)
            if form.get("redirect_uri") != [MZ_REDIRECT]:
                return json_response({"error": "invalid_grant"}, 400)
            self.code = None  # a code is single use
            return self._token_answer()
        if grant == "refresh_token":
            self.refresh_calls += 1
            if self.fail_refresh or form.get("refresh_token") != [self.refresh]:
                return json_response({"error": "invalid_grant"}, 400)
            return self._token_answer()
        return json_response({"error": "unsupported_grant_type"}, 400)

    def _accounts(self, params: dict[str, str]) -> httpx.Response:
        self.accounts_calls += 1
        if self.approved_at is None and self.approve_after is not None:
            if self.accounts_calls > self.approve_after:
                self.approved_at = self.clock.now
        if self.approved_at is None:
            return json_response({"code": "forbidden.insufficient_permissions"}, 403)
        rows = self.joint if params.get("account_type") == "uk_retail_joint" else self.accounts
        return json_response({"accounts": rows})

    def _transactions(self, params: dict[str, str]) -> httpx.Response:
        since = datetime.fromisoformat(params["since"])
        before = datetime.fromisoformat(params["before"])
        window_closed = (
            self.approved_at is not None
            and self.clock.now > self.approved_at + timedelta(minutes=5)
        )
        if window_closed and since < self.clock.now - timedelta(days=90):
            return json_response({"code": "forbidden.verification_required"}, 403)
        rows = [
            r
            for r in self.transactions
            if since <= datetime.fromisoformat(r["created"]) < before
        ]
        rows.sort(key=lambda r: r["created"])
        limit = int(params.get("limit", "30"))
        page = rows[:limit] if self.order == "ascending" else rows[::-1][:limit]
        return json_response({"transactions": page})

    def transaction_calls(self) -> list[dict[str, str]]:
        return [p for method, path, p in self.calls if path == "/transactions"]


async def no_sleep(seconds: float) -> None:
    """A pause that does not pause: the tests keep time on the fake clock."""
    return None

