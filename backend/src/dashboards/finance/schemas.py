"""Response shapes of the finance API. Money is an `int` in minor units next to its ISO code."""

from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.dashboards.finance.brands import BRANDS, NEUTRAL, Brand
from src.dashboards.finance.fx import Display
from src.dashboards.finance.models import OVERDRAFT_KINDS

_RESPONSE = ConfigDict(extra="forbid", frozen=True, from_attributes=True)

AccountKind = Literal["current", "credit_card", "savings", "pot", "business"]


class FxRateOut(BaseModel):
    """The rate a currency was converted with: `rate` display units per one unit of it, exact
    decimal text, as of the source's own time (the older of the two it came from)."""

    model_config = _RESPONSE

    rate: str
    as_of: datetime | None
    source: str


class DisplayOut(BaseModel):
    """The currency figures were also converted to, at the latest rate. `rates` has the rate used
    for every other currency in the answer; `missing` the currencies with no usable rate (none,
    or older than 3 days): their figures stay in the original currency only, their display
    fields are null. Whatever has `converted: true` is an approximation."""

    model_config = _RESPONSE

    currency: str
    rates: dict[str, FxRateOut]
    missing: list[str]


def display_fields(display: Display, currencies: Any) -> dict[str, Any]:
    used, missing = display.rates(currencies)
    rates = {
        name: FxRateOut(rate=rate.rate, as_of=rate.as_of, source=rate.source)
        for name, rate in used.items()
    }
    return {"currency": display.currency, "rates": rates, "missing": missing}


class AccountOut(BaseModel):
    model_config = _RESPONSE

    id: UUID
    connection_id: UUID
    provider: str
    name: str
    type: str | None
    currency: str
    mask_last4: str | None
    balance: int  # exactly as the provider sends it: with a credit card it includes the limit
    credit_limit: int
    own_balance_minor: int  # balance minus credit_limit: the owner's own money
    balance_at: datetime
    opened_at: datetime | None  # when the provider says it was opened
    history_from: datetime | None  # the oldest transaction kept: "history from <date>"
    archived: bool
    kind: AccountKind  # what the page can rely on to present it
    label: str | None  # a neutral sub-type ("Joint", "Platinum"): never a holder's name
    # True when the name is one the collector made up ("Black card UAH"): a page may write its
    # own words from `type`, `label` and `currency`. A name from the bank or you is false.
    name_generated: bool
    parent_id: UUID | None  # a pot's current account
    goal_amount: int | None  # a pot's goal, when the provider gives one
    # A credit card's use of its limit, floored: the number the attention item uses (so the
    # wallet and the alert never disagree); null for any other account.
    used_percent: int | None
    overdraft_limit: int | None  # the one in force: the owner's if set, else the bank's
    overdraft_limit_source: Literal["owner", "bank"] | None
    overdraft_limit_bank: int | None  # what the bank sent, whether or not the owner overrides it
    available_minor: int  # what can be spent: the balance plus the overdraft (a credit card's
    # balance already counts its limit)
    display_balance_minor: int | None  # the same in the display currency, at the latest rate
    display_own_balance_minor: int | None
    display_available_minor: int | None
    converted: bool  # the display figures are approximations (another currency)

    @classmethod
    def from_row(
        cls, row: Any, history_from: datetime | None = None, display: Display | None = None
    ) -> Self:
        derived = (
            "used_percent",
            "own_balance_minor",
            "history_from",
            "parent_id",
            "available_minor",
            "overdraft_limit",
            "overdraft_limit_source",
            "overdraft_limit_bank",
            "display_balance_minor",
            "display_own_balance_minor",
            "display_available_minor",
            "converted",
        )
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
        own = row.balance - row.credit_limit
        owner, bank = row.overdraft_limit_override, row.overdraft_limit
        limit = bank if owner is None else owner  # the owner's figure wins, always
        # What can be spent: the balance plus the overdraft of a current or business account (a
        # credit card's balance already counts its limit, a pot or jar has no overdraft).
        available = row.balance + ((limit or 0) if row.kind in OVERDRAFT_KINDS else 0)
        values["overdraft_limit"] = limit
        values["overdraft_limit_bank"] = bank
        source = "owner" if owner is not None else "bank" if bank is not None else None
        values["overdraft_limit_source"] = source
        values["own_balance_minor"] = own
        owed = row.credit_limit - row.balance
        values["used_percent"] = (
            max(owed, 0) * 100 // row.credit_limit
            if row.kind == "credit_card" and row.credit_limit > 0
            else None
        )
        values["history_from"] = history_from
        values["parent_id"] = row.parent_account_id
        values["available_minor"] = available

        def shown(amount: int) -> int | None:
            return display.convert(amount, row.currency) if display else None

        values["display_balance_minor"] = shown(row.balance)
        values["display_own_balance_minor"] = shown(own)
        values["display_available_minor"] = shown(available)
        values["converted"] = bool(display and display.converted(row.currency))
        return cls.model_validate(values)


class ColorsOut(BaseModel):
    """A brand colour and the text colour on it (contrast of at least 3:1)."""

    model_config = _RESPONSE

    background: str
    foreground: str


API_STALE_AFTER = timedelta(hours=2)  # a bank's API not read for this long: its balances are old
API_STALE_HIGH_AFTER = timedelta(hours=24)


class ConnectionOut(BaseModel):
    """One link to a provider. `status` is ok, needs_reconsent or paused."""

    model_config = _RESPONSE

    id: UUID
    provider: str
    status: str
    status_changed_at: datetime | None
    last_ok_at: datetime | None  # for a manual connection: the date its newest data is as of
    manual: bool  # entered by hand: no collector reads it
    display_name: str | None
    # What a bank card needs to be drawn before the logo arrives: the name in effect (yours, else
    # the built-in brand's, else null) and the colours in effect (yours, else the brand's, else
    # the neutral pair).
    name: str | None
    colors: ColorsOut
    last_error: str | None  # why the last read failed (a short kind), until one works
    # A bank's API that was last read more than two hours ago (nothing to say of a manual bank:
    # its age is `last_ok_at`, and a statement older than 30 days is an attention item). Its
    # balances are then as of `stale_since`, whatever `status` says.
    stale: bool
    stale_since: datetime | None

    @classmethod
    def from_row(cls, row: Any, now: datetime) -> Self:
        since = row.last_ok_at or row.created_at
        stale = not row.manual and row.status == "ok" and now - since > API_STALE_AFTER
        values = {
            name: getattr(row, name)
            for name in cls.model_fields
            if name not in ("stale", "stale_since", "name", "colors")
        }
        brand = BRANDS.get(row.provider)
        pair = Brand("", row.brand_bg, row.brand_fg) if row.brand_bg and row.brand_fg else None
        colors = pair or brand or NEUTRAL
        return cls.model_validate(
            {
                **values,
                "name": row.display_name or (brand.name if brand else None),
                "colors": {"background": colors.background, "foreground": colors.foreground},
                "stale": stale,
                "stale_since": since if stale else None,
            }
        )


class ProviderTotal(BaseModel):
    """What the open accounts of one provider come to in the display currency, each account
    converted once: its own money (a credit card's debt counts negative; pots left out) and what
    is in its pots and jars. `complete` is false when an account had no rate (it is left out)."""

    model_config = _RESPONSE

    provider: str
    display_own_balance_minor: int
    display_pots_minor: int
    display_total_minor: int
    complete: bool


def provider_totals(accounts: Sequence[AccountOut]) -> list[ProviderTotal]:
    found: dict[str, list[int]] = {}
    for item in accounts:
        if item.archived:
            continue
        entry = found.setdefault(item.provider, [0, 0, 1])
        shown = item.display_balance_minor if item.kind == "pot" else item.display_own_balance_minor
        if shown is None:
            entry[2] = 0
        elif item.kind == "pot":
            entry[1] += shown
        else:
            entry[0] += shown
    return [
        ProviderTotal(
            provider=name,
            display_own_balance_minor=entry[0],
            display_pots_minor=entry[1],
            display_total_minor=entry[0] + entry[1],
            complete=bool(entry[2]),
        )
        for name, entry in sorted(found.items())
    ]


class AccountsOut(BaseModel):
    model_config = _RESPONSE

    accounts: list[AccountOut]
    connections: list[ConnectionOut]
    providers: list[ProviderTotal]
    display: DisplayOut


class TransactionOut(BaseModel):
    model_config = _RESPONSE

    id: UUID
    account_id: UUID
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
    internal_transfer: bool  # the counterparty is another account of the same owner
    internal_transfer_by_owner: bool  # the owner set or cleared it: nothing changes it again
    time_known: bool  # false for a statement line that had only a day (booked at noon)
    declined: bool  # refused by the bank: not money that moved, never counted as spent
    settled_at: datetime | None
    category: str  # the owner's override, else the normalised one (never null)
    category_overridden: bool
    display_amount_minor: int | None  # at the latest rate, not the one of the day (yet)
    converted: bool

    @classmethod
    def from_row(cls, row: Any, display: Display | None = None) -> Self:
        derived = (
            "category",
            "category_overridden",
            "display_amount_minor",
            "converted",
            "internal_transfer_by_owner",
        )
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
        values["internal_transfer_by_owner"] = row.transfer_locked
        values["category"] = row.category_override or row.category or "other"
        values["category_overridden"] = row.category_override is not None
        converted = display.convert(row.amount, row.currency) if display else None
        values["display_amount_minor"] = converted
        values["converted"] = bool(display and display.converted(row.currency))
        return cls.model_validate(values)


class TransactionsOut(BaseModel):
    model_config = _RESPONSE

    transactions: list[TransactionOut]
    next_cursor: str | None
    display: DisplayOut


class CurrencySummary(BaseModel):
    """One currency: the balances of the open accounts and this month's movement (`spent` and
    `received` are positive). Moves between the owner's own accounts, declined payments and lines
    called `transfers` are left out; a refund (money in on a spending category) is taken off that
    category's spending, never below 0, and is not `received`. The movement counts every account,
    archived ones too (their balance is not in `balance`), so a line may have `accounts: 0`."""

    model_config = _RESPONSE

    currency: str
    accounts: int
    balance: int
    own_balance: int  # the balance minus the credit limits
    spent: int
    received: int
    display_balance: int | None
    display_own_balance: int | None
    display_spent: int | None
    display_received: int | None
    converted: bool


class SummaryDisplay(DisplayOut):
    """The grand total in the display currency: the converted per-currency parts, each converted
    once, added. `complete` is false when a currency without a rate was left out of them."""

    complete: bool
    balance: int
    own_balance: int
    spent: int
    received: int


class FinanceSummaryOut(BaseModel):
    model_config = _RESPONSE

    month: str  # YYYY-MM, in the configured time zone
    as_of: datetime | None  # the oldest balance among the accounts counted
    # The newest balance among them, and the oldest one left of banks read by their own API
    # (a hand-entered bank's balance is as old as its last statement and is not "stale"): a page
    # says "updated <newest>" and warns only when `as_of_oldest` is far behind.
    as_of_newest: datetime | None
    as_of_oldest: datetime | None
    currencies: list[CurrencySummary]
    display: SummaryDisplay


class CategorySpend(BaseModel):
    model_config = _RESPONSE

    category: str
    spent: int
    previous: int  # the same category the month before, in full
    previous_to_date: int | None  # the month before up to the same day and time as now
    display_spent: int | None
    display_previous: int | None
    display_previous_to_date: int | None


class CurrencyCategories(BaseModel):
    """Money out in one currency, by category, internal transfers and declined payments left
    out; `spent` and `previous` are positive minor units."""

    model_config = _RESPONSE

    currency: str
    spent: int
    previous_spent: int
    previous_to_date_spent: int | None
    categories: list[CategorySpend]
    display_spent: int | None  # the sum of its converted lines
    display_previous_spent: int | None
    display_previous_to_date_spent: int | None
    converted: bool


class DisplayCategory(BaseModel):
    model_config = _RESPONSE

    category: str
    spent: int
    previous: int
    previous_to_date: int | None
    converted: bool  # a currency other than the display currency is in these figures


class CategoriesDisplay(DisplayOut):
    """Every currency's lines converted (each once) and added per category, biggest first; the
    totals are the sums of those lines, so what a page shows always adds up."""

    complete: bool
    spent: int
    previous_spent: int
    previous_to_date_spent: int | None  # null for a month that is over
    categories: list[DisplayCategory]


class CategoriesOut(BaseModel):
    model_config = _RESPONSE

    month: str  # YYYY-MM, in the configured time zone
    previous_month: str
    # The day of the previous month up to which `previous_to_date` is counted (the same day and
    # time of day as now, clamped to the month's length); null unless the month is the current one.
    previous_to_date_day: date | None
    currencies: list[CurrencyCategories]
    display: CategoriesDisplay


class LogoAspect(BaseModel):
    """Width over height of each variant (null when the variant is absent or says no size)."""

    model_config = _RESPONSE

    on_light: float | None
    on_dark: float | None
    mark: float | None


class LogoOut(BaseModel):
    """A bank's logo, for an `<img>`: `on_light` for a light card, `on_dark` for a dark one,
    `mark` the square icon for small places. Each is the address of the image (served with
    caching, `?v=` changes with the picture) or null: only a provider with a connection has them."""

    model_config = _RESPONSE

    on_light: str | None
    on_dark: str | None
    mark: str | None
    aspect: LogoAspect  # so a page can reserve the room before the image arrives
    scale: float  # an optical correction the owner gave (1 when none): enlarge or shrink by it
    mono: bool  # one flat colour: a page may recolour it for a dark card


class ProviderOut(BaseModel):
    model_config = _RESPONSE

    id: str
    name: str | None  # the owner's name for it, else the built-in brand's, else null
    colors: ColorsOut
    logo: LogoOut
    entry: Literal["api", "manual"]  # connected through its API, or entered by hand
    # How a link that needs approving again is mended: `oauth` (open `reconnect_path` in a
    # browser) or `token` (replace the token in the server's settings); null for a bank by hand.
    reconnect: Literal["oauth", "token"] | None
    reconnect_path: str | None


class ProvidersOut(BaseModel):
    model_config = _RESPONSE

    providers: list[ProviderOut]
