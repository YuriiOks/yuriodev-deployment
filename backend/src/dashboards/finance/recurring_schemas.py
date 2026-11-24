"""Response shapes of the recurring payments, upcoming and attention endpoints. Money is an
integer in minor units next to its ISO code; `display_*` is the same at the latest rate."""

from datetime import date, datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.dashboards.finance.fx import Display
from src.dashboards.finance.recurring import Frequency, Kind, RowError
from src.dashboards.finance.schemas import DisplayOut

_RESPONSE = ConfigDict(extra="forbid", frozen=True, from_attributes=True)

AttentionKind = Literal[
    "due_not_covered", "missed_payment", "amount_changed", "credit_high", "overdraft", "reconsent"
]
ItemState = Literal["active", "snoozed", "dismissed"]
Fact = str | int | bool | None


class RecurringOut(BaseModel):
    model_config = _RESPONSE

    id: UUID
    external_ref: str | None
    name: str
    kind: Kind
    amount: int  # what is paid each time, positive
    currency: str
    frequency: Frequency
    frequency_interval: int
    start_date: date | None
    next_payment_date: date | None
    payment_type: str | None
    payment_mode: str | None
    category: str | None
    notes: str | None
    is_active: bool
    auto_renew: bool
    payment_method: str | None  # the free-text source when no account of ours pays
    account_id: UUID | None  # the paying account, when it is one we collect
    match_text: str | None
    reminder_days: int | None
    icon_url: str | None  # an https URL, served only when it passed the checks on the way in
    color: str | None  # #rrggbb
    is_installment: bool
    total_installments: int | None
    completed_installments: int | None
    remaining_installments: int | None
    total_owed: int | None
    remaining_balance: int | None
    creditor: str | None
    target_amount: int | None
    current_saved: int | None
    recipient: str | None
    last_paid_on: date | None
    last_charged_amount: int | None
    created_at: datetime
    updated_at: datetime
    display_amount: int | None
    display_total_owed: int | None
    display_remaining_balance: int | None
    converted: bool

    @classmethod
    def from_row(cls, row: Any, display: Display | None = None) -> Self:
        derived = (
            "remaining_installments",
            "display_amount",
            "display_total_owed",
            "display_remaining_balance",
            "converted",
        )
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
        total, done = row.total_installments, row.completed_installments
        values["remaining_installments"] = None if total is None else max(total - (done or 0), 0)

        def shown(amount: int | None) -> int | None:
            if amount is None or display is None:
                return None
            return display.convert(amount, row.currency)

        values["display_amount"] = shown(row.amount)
        values["display_total_owed"] = shown(row.total_owed)
        values["display_remaining_balance"] = shown(row.remaining_balance)
        values["converted"] = bool(display and display.converted(row.currency))
        return cls.model_validate(values)


class RecurringListOut(BaseModel):
    model_config = _RESPONSE

    recurring: list[RecurringOut]
    display: DisplayOut


class RowErrorOut(BaseModel):
    model_config = _RESPONSE

    row: int  # 1 is the first row (the first data row of a CSV file); 0 is the file itself
    field: str | None
    message: str

    @classmethod
    def of(cls, error: RowError) -> Self:
        return cls(row=error.row, field=error.field, message=error.message)


class ImportOut(BaseModel):
    """What a bulk load or a CSV import did. Any error means nothing was written."""

    model_config = _RESPONSE

    dry_run: bool
    created: int
    updated: int
    skipped: int  # rows whose `external_ref` already exists (with `on_conflict` skip)
    errors: list[RowErrorOut]
    ignored_columns: list[str]
    recurring: list[RecurringOut]


class UpcomingItem(BaseModel):
    """One occurrence of a payment inside the window."""

    model_config = _RESPONSE

    recurring_id: UUID
    name: str
    kind: Kind
    due_date: date
    days_until: int
    amount: int
    currency: str
    display_amount: int | None
    converted: bool
    account_id: UUID | None
    payment_method: str | None
    icon_url: str | None
    color: str | None
    # Can the paying account cover it (balance plus overdraft, or a card's room), counting the
    # earlier payments of the window from the same account? null when no account of ours pays,
    # or the amount cannot be told in the account's currency (no rate).
    covered: bool | None
    shortfall: int | None  # how much is missing, in the account's currency, when not covered
    account_currency: str | None


class UpcomingTotal(BaseModel):
    model_config = _RESPONSE

    currency: str
    amount: int
    display_amount: int | None
    converted: bool


class UpcomingDisplay(DisplayOut):
    """The grand total, in the display currency: the per-currency totals, each converted once,
    added. `complete` is false when a currency without a rate was left out."""

    complete: bool
    total: int


class UpcomingOut(BaseModel):
    model_config = _RESPONSE

    from_date: date
    to_date: date
    items: list[UpcomingItem]
    totals: list[UpcomingTotal]
    display: UpcomingDisplay


class AttentionItem(BaseModel):
    model_config = _RESPONSE

    key: str  # names the condition and its occasion; what dismiss and snooze take
    kind: AttentionKind
    title: str
    subject_type: Literal["recurring", "account", "connection"]
    subject_id: UUID
    due_date: date | None
    amount: int | None
    currency: str | None
    display_amount: int | None
    converted: bool
    facts: dict[str, Fact]
    state: ItemState
    snoozed_until: datetime | None


class AttentionOut(BaseModel):
    model_config = _RESPONSE

    items: list[AttentionItem]
    hidden: int  # dismissed or snoozed items left out (all shown with `include_hidden`)
    display: DisplayOut
