"""Exchange rates, for showing every amount in one currency (FINANCE_DISPLAY_CURRENCY, GBP).

Nothing stored is ever converted: accounts and transactions stay integers in minor units of their
own currency. The API shows a converted figure beside the original, at the CURRENT rate (the owner
asked for the latest, not the rate of the day of each payment; `RateBook.convert` takes the rate
book as it is, so a per-date book can be handed to it later).

Source: Monobank's public rates (https://api.monobank.ua/docs/, `GET /bank/currency`, no token; the
bank caches the answer and refreshes it at most once per 5 minutes). Each entry is a pair of ISO
4217 numbers with a Unix time and any of `rateBuy`, `rateSell` and `rateCross`. Only the pairs
quoted in hryvnia are used. The rate of a pair is its `rateCross` when it has one (that is all
GBP and PLN have), else the MID of buy and sell, the average of the two (USD and EUR have only
those): never one side of the spread. So the book holds, per currency, hryvnia per one unit, with
the bank's own time for the pair; any pair X to Y is the quotient of the two, a cross through
hryvnia.

Rules, stated once:

- A rate is an exact decimal (never a float) kept to 12 decimal places; the amount of a pair
  is computed with that same rate, so a page can check it.
- A figure is rounded once, half-even on the minor unit of the currency it is shown in
  (`ROUND_HALF_EVEN`, so -2.5 and 2.5 minor units go to -2 and 2; 3.5 goes to 4), after the
  difference between the currencies' minor units (JPY has none, KWD three, the rest two) is
  applied. A total is the sum of figures that were each converted once (a currency's total, a
  category's), never a sum of rounded rows.
- A pair needs both of its rates no older than `MAX_AGE` (3 days); otherwise it has no rate and the
  answer carries the original only and names the currency as missing. Nothing is guessed.
"""

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from typing import Any, NamedTuple

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError, get_json_capped
from src.dashboards.finance.models import FxRate
from src.dashboards.finance.monobank import CURRENCIES

logger = logging.getLogger("yuriodev.finance")

SOURCE = "monobank"
RATES_URL = "https://api.monobank.ua/bank/currency"
PIVOT = "UAH"
PIVOT_NUMBER = 980
MAX_AGE = timedelta(days=3)
REFRESH_EVERY = timedelta(minutes=30)  # the bank refreshes at most every 5 minutes
RETRY_AFTER_FAILURE = timedelta(minutes=5)
PLACES = Decimal("0.000000000001")  # 12 decimal places
MAX_TIME = 4_102_444_800

ZERO_DECIMALS = frozenset(
    {"JPY", "KRW", "VND", "CLP", "ISK", "UGX", "BIF", "DJF", "GNF", "KMF", "PYG", "RWF", "VUV"}
    | {"XAF", "XOF", "XPF"}
)
THREE_DECIMALS = frozenset({"BHD", "JOD", "KWD", "OMR", "TND", "LYD", "IQD"})


def exponent(currency: str) -> int:
    """How many decimal places the minor unit of a currency is below its major one."""
    if currency in ZERO_DECIMALS:
        return 0
    return 3 if currency in THREE_DECIMALS else 2


@dataclass(frozen=True)
class Conversion:
    """The rate a figure was converted with: `rate` units of the target per one of the source."""

    rate: Decimal
    as_of: datetime | None  # the older of the two rates it came from; None for the same currency
    source: str


@dataclass(frozen=True)
class Leg:
    per_pivot: Decimal  # hryvnia per one unit
    as_of: datetime
    source: str


class RateBook:
    """The rates as they are now. `rate(a, b)` is a `Conversion` or None when it cannot be told."""

    def __init__(self, legs: dict[str, Leg], now: datetime) -> None:
        self._legs = legs
        self._now = now

    def _leg(self, currency: str) -> Leg | None:
        if currency == PIVOT:
            return Leg(Decimal(1), self._now, SOURCE)  # hryvnia against hryvnia needs no feed
        leg = self._legs.get(currency)
        if leg is None or self._now - leg.as_of > MAX_AGE:
            return None
        return leg

    def rate(self, source: str, target: str) -> Conversion | None:
        if source == target:
            return Conversion(Decimal(1), None, SOURCE)
        first, second = self._leg(source), self._leg(target)
        if first is None or second is None:
            return None
        as_of = min(leg.as_of for leg in (first, second) if leg.as_of is not None)
        if source == PIVOT:
            as_of = second.as_of
        if target == PIVOT:
            as_of = first.as_of
        rate = (first.per_pivot / second.per_pivot).quantize(PLACES, rounding=ROUND_HALF_EVEN)
        if rate <= 0:
            return None
        return Conversion(rate, as_of, first.source)

    def convert(self, amount: int, source: str, target: str) -> int | None:
        """`amount` minor units of `source` as minor units of `target`, or None without a rate."""
        found = self.rate(source, target)
        return None if found is None else convert_with(amount, found.rate, source, target)


def convert_with(amount: int, rate: Decimal, source: str, target: str) -> int:
    """One conversion, one rounding: half-even on the target's minor unit."""
    shifted = Decimal(amount).scaleb(exponent(target) - exponent(source))
    return int((shifted * rate).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


class RateUsed(NamedTuple):
    rate: str  # display units per one unit of the currency, exact decimal text
    as_of: datetime | None
    source: str


@dataclass(frozen=True)
class Display:
    """The currency a page asks to see, and the rates to get there."""

    currency: str
    book: RateBook

    def convert(self, amount: int, currency: str) -> int | None:
        return self.book.convert(amount, currency, self.currency)

    def converted(self, currency: str) -> bool:
        """True when a figure shown here is an approximation of one in another currency."""
        return currency != self.currency

    def rates(self, currencies: Iterable[str]) -> tuple[dict[str, RateUsed], list[str]]:
        """The rate used for each of `currencies` (as text, its time and source), and those
        with no usable rate. The display currency itself needs none."""
        used: dict[str, RateUsed] = {}
        missing: list[str] = []
        for currency in sorted(set(currencies) - {self.currency}):
            found = self.book.rate(currency, self.currency)
            if found is None:
                missing.append(currency)
            else:
                text = format(found.rate.normalize(), "f")
                used[currency] = RateUsed(text, found.as_of, found.source)
        return used, missing


async def load_rates(session: AsyncSession, now: datetime) -> RateBook:
    rows = (await session.execute(select(FxRate))).scalars().all()
    legs = {
        row.base: Leg(row.rate, row.as_of, row.source) for row in rows if row.quote == PIVOT
    }
    return RateBook(legs, now)


def pair_rate(row: dict[str, Any]) -> Decimal | None:
    """`rateCross`, else the mid of buy and sell; None when the pair has neither."""
    cross = _decimal(row.get("rateCross"))
    if cross is not None:
        return cross
    buy, sell = _decimal(row.get("rateBuy")), _decimal(row.get("rateSell"))
    if buy is None or sell is None:
        return None
    return ((buy + sell) / 2).quantize(PLACES, rounding=ROUND_HALF_EVEN)


def _decimal(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        number = Decimal(str(value))  # the shortest text of the number, not its binary noise
    except InvalidOperation:
        return None
    if not number.is_finite() or number <= 0:
        return None
    return number.quantize(PLACES, rounding=ROUND_HALF_EVEN)


def parse_rates(body: Any) -> dict[str, tuple[Decimal, datetime]]:
    """Hryvnia per unit and the bank's time, per currency we know the alpha code of. A malformed
    answer is `UpstreamError("bad_json")`; a malformed pair is skipped (one odd pair must not
    stop the others)."""
    if not isinstance(body, list):
        raise UpstreamError("bad_json", 200)
    found: dict[str, tuple[Decimal, datetime]] = {}
    for row in body:
        if not isinstance(row, dict) or row.get("currencyCodeB") != PIVOT_NUMBER:
            continue
        code, stamp = row.get("currencyCodeA"), row.get("date")
        currency = CURRENCIES.get(code) if isinstance(code, int) else None
        rate = pair_rate(row)
        valid_time = isinstance(stamp, int) and not isinstance(stamp, bool) and 0 < stamp < MAX_TIME
        if currency is None or currency == PIVOT or rate is None or not valid_time:
            continue
        found[currency] = (rate, datetime.fromtimestamp(stamp, UTC))
    return found


class FxCollector:
    """Keeps `finance.fx_rate` fresh. It runs under the finance loop and only when a bank
    collector does (no credentials, no outbound call); it asks at most every 30 minutes."""

    name = "fx"

    def __init__(self) -> None:
        self._next_at: datetime | None = None

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        if self._next_at is not None and now < self._next_at:
            return {"calls": 0, "rates": 0}
        try:
            body, _ = await get_json_capped(client, RATES_URL, headers={})
            rates = parse_rates(body)
        except Exception:
            self._next_at = now + RETRY_AFTER_FAILURE
            raise
        async with sessions() as session, session.begin():
            for currency, (rate, as_of) in rates.items():
                values = {"rate": rate, "as_of": as_of, "source": SOURCE, "fetched_at": now}
                statement = insert(FxRate).values(base=currency, quote=PIVOT, **values)
                await session.execute(
                    statement.on_conflict_do_update(
                        index_elements=[FxRate.base, FxRate.quote], set_=values
                    )
                )
        self._next_at = now + REFRESH_EVERY
        return {"calls": 1, "rates": len(rates)}
