"""Monobank, through its personal API (https://api.monobank.ua/docs/, version v250818).

What the provider's documentation says, and what this module relies on:

- The token goes in the `X-Token` header and only reads: it cannot move money.
- `GET /personal/client-info` returns the client's accounts: `id`, `currencyCode` (ISO 4217
  numeric), `balance` and `creditLimit` in minor units (kopiykas, cents; the balance includes the
  credit limit), `type`, `maskedPan` and `iban`. Not more often than once per 60 seconds.
- `GET /personal/statement/{account}/{from}/{to}`: Unix seconds, a window of at most 31 days and
  1 hour (2 682 000 s), not more often than once per 60 seconds. Items are newest first, with
  `id`, `time`, `description`, `mcc`, `hold`, `amount` (account currency, negative for money out),
  `operationAmount` (the transaction's currency), `currencyCode`, `balance` and, for business
  accounts, `counterName`. The documentation names no page size; an answer is taken to be cut at
  500 items (the cap observed in use), so a full page of 500 is taken to have more behind it and
  the collector asks again for the rest of the window.
- The docs describe `currencyCode` of an item as the account's currency, which would leave the
  currency of `operationAmount` unnamed. Both readings are handled: an original-currency amount
  is stored only when the item's code differs from the account's.
- Jars (`jars[]`: id, title, currencyCode, balance) are kept as accounts of type `jar`; managed
  clients and the webhook are not used.

Every limit is applied with margin: windows are 31 days, requests are 61 seconds apart. Only the
last four digits of a card (or, without a card, of the IBAN) are ever kept. A malformed answer is
`UpstreamError("bad_json")` and changes nothing; no parsing error carries any of the payload.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from pydantic import SecretStr

from src.core.http import get_json_capped
from src.dashboards.finance.base import AccountData, ProviderDefaults, TransactionData
from src.dashboards.finance.categories import categorize
from src.dashboards.finance.parsing import bad, last4, safe_id, text, whole

BASE_URL = "https://api.monobank.ua"
MAX_PAGE = 500
MAX_ID = 64
MAX_DESCRIPTION = 500
MAX_COUNTERPARTY = 200
MAX_TIME = 4_102_444_800  # 2100-01-01: a larger "Unix time" is not a time

# ISO 4217 numeric -> alpha, for the currencies an account here may plausibly hold. An unlisted
# code is stored as XXX (the standard's "no currency") rather than guessed.
CURRENCIES = {
    36: "AUD",
    51: "AMD",
    124: "CAD",
    156: "CNY",
    191: "HRK",
    203: "CZK",
    208: "DKK",
    344: "HKD",
    348: "HUF",
    356: "INR",
    376: "ILS",
    392: "JPY",
    398: "KZT",
    410: "KRW",
    417: "KGS",
    484: "MXN",
    498: "MDL",
    554: "NZD",
    578: "NOK",
    643: "RUB",
    702: "SGD",
    710: "ZAR",
    752: "SEK",
    756: "CHF",
    764: "THB",
    784: "AED",
    826: "GBP",
    840: "USD",
    860: "UZS",
    933: "BYN",
    944: "AZN",
    946: "RON",
    949: "TRY",
    975: "BGN",
    978: "EUR",
    980: "UAH",
    981: "GEL",
    985: "PLN",
    986: "BRL",
}
UNKNOWN_CURRENCY = "XXX"

# A neutral sub-type for the page (the card's tier), never anything of the holder's.
TIER_LABELS = {
    "black": "Black",
    "white": "White",
    "platinum": "Platinum",
    "iron": "Iron",
    "yellow": "Yellow",
    "fop": "Business",
    "eAid": "eAid",
}
ACCOUNT_LABELS = {
    "black": "Black card",
    "white": "White card",
    "platinum": "Platinum card",
    "iron": "Iron card",
    "yellow": "Yellow card",
    "fop": "Business account",
    "eAid": "eAid account",
}


class MonobankProvider(ProviderDefaults):
    name = "monobank"
    ref = "personal"
    min_call_gap = timedelta(seconds=61)  # documented: once per 60 seconds
    refresh_every = timedelta(minutes=20)  # balances three times an hour
    max_window = timedelta(days=31)  # documented: at most 31 days and 1 hour
    page_limit = MAX_PAGE

    def __init__(self, token: SecretStr) -> None:
        self._token = token
        # The owner's own IBANs from the last client-info answer. Kept in memory only (never
        # stored) to recognise a statement item whose counterparty is one of them.
        self._own_ibans: frozenset[str] = frozenset()

    def _headers(self) -> dict[str, str]:
        return {"X-Token": self._token.get_secret_value()}

    async def fetch_accounts(self, client: httpx.AsyncClient) -> list[AccountData]:
        body, _ = await get_json_capped(
            client, f"{BASE_URL}/personal/client-info", headers=self._headers()
        )
        accounts = parse_accounts(body)
        self._own_ibans = own_ibans(body)
        return accounts

    async def fetch_statement(
        self,
        client: httpx.AsyncClient,
        external_id: str,
        currency: str,
        start: datetime,
        end: datetime,
    ) -> list[TransactionData]:
        first, last = int(start.timestamp()), int(end.timestamp())
        url = f"{BASE_URL}/personal/statement/{external_id}/{first}/{last}"
        body, _ = await get_json_capped(client, url, headers=self._headers())
        return parse_statement(body, currency, self._own_ibans)


def currency_code(value: object) -> str:
    return CURRENCIES.get(value, UNKNOWN_CURRENCY) if isinstance(value, int) else UNKNOWN_CURRENCY


def parse_accounts(body: Any) -> list[AccountData]:
    rows = body.get("accounts") if isinstance(body, dict) else None
    jars = body.get("jars", []) if isinstance(body, dict) else None
    if not isinstance(rows, list) or not isinstance(jars, list):
        raise bad()
    return [parse_account(row) for row in rows] + [parse_jar(row) for row in jars]


def parse_jar(row: Any) -> AccountData:
    """A jar (a savings pot) is an account of type `jar`, asked for like any other."""
    if not isinstance(row, dict):
        raise bad()
    currency = currency_code(row.get("currencyCode"))
    return AccountData(
        external_id=safe_id(row.get("id")),
        name=text(row.get("title"), 100) or f"Jar {currency}",
        type="jar",
        currency=currency,
        mask_last4=None,
        balance=whole(row.get("balance")),
        credit_limit=0,
        kind="savings",
        label="Jar",
    )


def own_ibans(body: Any) -> frozenset[str]:
    rows = body.get("accounts") if isinstance(body, dict) else None
    if not isinstance(rows, list):
        return frozenset()
    found = (row.get("iban") for row in rows if isinstance(row, dict))
    return frozenset(value for value in found if isinstance(value, str) and value)


def parse_account(row: Any) -> AccountData:
    if not isinstance(row, dict):
        raise bad()
    external_id = safe_id(row.get("id"))  # it goes into a URL path
    currency = currency_code(row.get("currencyCode"))
    kind = text(row.get("type"), 32)
    pans = row.get("maskedPan")
    mask = last4(pans[0]) if isinstance(pans, list) and pans else None
    if mask is None:
        mask = last4(row.get("iban"))
    label = ACCOUNT_LABELS.get(kind or "", "Account")
    credit = row.get("creditLimit")
    limit = 0 if credit is None else whole(credit)
    account_kind = "business" if kind == "fop" else "credit_card" if limit > 0 else "current"
    return AccountData(
        external_id=external_id,
        name=f"{label} {currency}",
        type=kind,
        currency=currency,
        mask_last4=mask,
        balance=whole(row.get("balance")),
        credit_limit=limit,
        kind=account_kind,
        label=TIER_LABELS.get(kind or ""),
    )


def parse_statement(
    body: Any, account_currency: str, own: frozenset[str] = frozenset()
) -> list[TransactionData]:
    if not isinstance(body, list):
        raise bad()
    return [parse_item(row, account_currency, own) for row in body]


def parse_item(
    row: Any, account_currency: str, own: frozenset[str] = frozenset()
) -> TransactionData:
    if not isinstance(row, dict):
        raise bad()
    external_id = row.get("id")
    if not isinstance(external_id, str) or not 0 < len(external_id) <= MAX_ID:
        raise bad()
    seconds = whole(row.get("time"))
    if not 0 < seconds < MAX_TIME:
        raise bad()
    original_amount: int | None = None
    original_currency: str | None = None
    item_currency = currency_code(row.get("currencyCode"))
    operation = row.get("operationAmount")
    if item_currency != account_currency and isinstance(operation, int):
        original_amount, original_currency = whole(operation), item_currency
    mcc = row.get("mcc")
    balance = row.get("balance")
    counter_iban = row.get("counterIban")
    amount = whole(row.get("amount"))
    code = str(mcc) if isinstance(mcc, int) and not isinstance(mcc, bool) else None
    # The counterparty's IBAN is only ever compared, never stored. Monobank sends it for business
    # accounts only, so a transfer between two personal cards is not recognised.
    internal = isinstance(counter_iban, str) and counter_iban in own
    return TransactionData(
        external_id=external_id,
        booked_at=datetime.fromtimestamp(seconds, UTC),
        amount=amount,
        currency=account_currency,
        original_amount=original_amount,
        original_currency=original_currency,
        description=text(row.get("description"), MAX_DESCRIPTION) or "",
        counterparty=text(row.get("counterName"), MAX_COUNTERPARTY),
        category_code=code,
        balance_after=None if balance is None else whole(balance),
        pending=row.get("hold") is True,
        internal_transfer=internal,
        category=categorize("monobank", code, amount, internal),
    )
