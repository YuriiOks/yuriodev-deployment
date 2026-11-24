"""Response shapes of the finance API. Money is an `int` in minor units next to its ISO code."""

from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.dashboards.finance.fx import Display

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
    parent_id: UUID | None  # a pot's current account
    goal_amount: int | None  # a pot's goal, when the provider gives one
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
        available = row.balance + (limit or 0)
        values["overdraft_limit"] = limit
        values["overdraft_limit_bank"] = bank
        source = "owner" if owner is not None else "bank" if bank is not None else None
        values["overdraft_limit_source"] = source
        values["own_balance_minor"] = own
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


class ConnectionOut(BaseModel):
    """One link to a provider. `status` is ok, needs_reconsent or paused."""

    model_config = _RESPONSE

    id: UUID
    provider: str
    status: str
    status_changed_at: datetime | None
    last_ok_at: datetime | None


class AccountsOut(BaseModel):
    model_config = _RESPONSE

    accounts: list[AccountOut]
    connections: list[ConnectionOut]
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
    declined: bool  # refused by the bank: not money that moved, never counted as spent
    settled_at: datetime | None
    category: str  # the owner's override, else the normalised one (never null)
    category_overridden: bool
    display_amount_minor: int | None  # at the latest rate, not the one of the day (yet)
    converted: bool

    @classmethod
    def from_row(cls, row: Any, display: Display | None = None) -> Self:
        derived = ("category", "category_overridden", "display_amount_minor", "converted")
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
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
    `received` are positive; moves between the owner's own accounts count on both sides)."""

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
    currencies: list[CurrencySummary]
    display: SummaryDisplay


class CategorySpend(BaseModel):
    model_config = _RESPONSE

    category: str
    spent: int
    previous: int  # the same category the month before
    display_spent: int | None
    display_previous: int | None


class CurrencyCategories(BaseModel):
    """Money out in one currency, by category, internal transfers and declined payments left
    out; `spent` and `previous` are positive minor units."""

    model_config = _RESPONSE

    currency: str
    spent: int
    previous_spent: int
    categories: list[CategorySpend]
    display_spent: int | None  # the sum of its converted lines
    display_previous_spent: int | None
    converted: bool


class DisplayCategory(BaseModel):
    model_config = _RESPONSE

    category: str
    spent: int
    previous: int


class CategoriesDisplay(DisplayOut):
    """Every currency's lines converted (each once) and added per category, biggest first; the
    totals are the sums of those lines, so what a page shows always adds up."""

    complete: bool
    spent: int
    previous_spent: int
    categories: list[DisplayCategory]


class CategoriesOut(BaseModel):
    model_config = _RESPONSE

    month: str  # YYYY-MM, in the configured time zone
    previous_month: str
    currencies: list[CurrencyCategories]
    display: CategoriesDisplay


class LogoOut(BaseModel):
    """A bank's logo as data URIs, for an `<img>`: `on_light` for a light card, `on_dark` for a
    dark one, `mark` the square icon for small places; each may be null."""

    model_config = _RESPONSE

    on_light: str | None
    on_dark: str | None
    mark: str | None


class ProviderOut(BaseModel):
    model_config = _RESPONSE

    id: str
    logo: LogoOut


class ProvidersOut(BaseModel):
    model_config = _RESPONSE

    providers: list[ProviderOut]
