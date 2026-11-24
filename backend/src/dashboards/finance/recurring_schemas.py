"""Response shapes of the recurring payments, upcoming and attention endpoints. Money is an
integer in minor units next to its ISO code; `display_*` is the same at the latest rate."""

from datetime import date, datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.dashboards.finance.fx import Display
from src.dashboards.finance.recurring import (
    Frequency,
    Kind,
    RowError,
    ScheduleState,
    grace_end,
    schedule_state,
)
from src.dashboards.finance.schemas import DisplayOut

_RESPONSE = ConfigDict(extra="forbid", frozen=True, from_attributes=True)

AttentionKind = Literal[
    "due_not_covered",
    "missed_payment",
    "amount_changed",
    "credit_high",
    "overdraft",
    "overdrawn",
    "reconsent",
    "stale_statement",
    "stale_connection",
]
Severity = Literal["high", "medium", "info"]
ItemState = Literal["active", "snoozed", "dismissed"]
Fact = str | int | bool | None


class EvidenceOut(BaseModel):
    """What the bank's own lines say about a payment whose paying account we collect: the last
    transaction that matched it, and how many of its last three due dates had a match (a date
    that has passed with none counts as a miss). The owner's "paid" is not evidence."""

    model_config = _RESPONSE

    last_matched_on: date | None
    last_matched_amount: int | None
    matched_of_last: int
    checked: int  # how many of the last three due dates the bank could show (not his "paid")


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
    # The image itself, a PNG or SVG data URI the server fetched from icon_url (null until it has,
    # and when the address could not be had or was not a safe image): the page shows this one.
    icon_data: str | None
    color: str | None  # #rrggbb
    is_installment: bool
    total_installments: int | None
    completed_installments: int | None
    remaining_installments: int | None  # the total less the confirmed ones
    assumed_installments: int  # passed by the schedule only, never seen in a line
    # The balance left if every assumed instalment had been paid at `amount` (an estimate: the
    # confirmed `remaining_balance` less assumed times amount, never below 0); null without one.
    scheduled_remaining_balance: int | None
    scheduled_installments: int | None  # confirmed plus assumed, at most the total
    schedule_state: ScheduleState | None  # null for a payment that is switched off
    evidence: EvidenceOut | None  # null when no account of ours pays it
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
    def from_row(cls, row: Any, display: Display | None, today: date) -> Self:
        derived = (
            "icon_data",
            "remaining_installments",
            "scheduled_installments",
            "scheduled_remaining_balance",
            "schedule_state",
            "evidence",
            "display_amount",
            "display_total_owed",
            "display_remaining_balance",
            "converted",
        )
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
        total, done = row.total_installments, row.completed_installments
        values["icon_data"] = shown_icon(row)
        values["remaining_installments"] = None if total is None else max(total - (done or 0), 0)
        values["scheduled_installments"] = (
            None if total is None else min(total, (done or 0) + row.assumed_installments)
        )
        left = row.remaining_balance
        values["scheduled_remaining_balance"] = (
            None if left is None else max(left - row.assumed_installments * row.amount, 0)
        )
        values["schedule_state"] = state = schedule_state(row, today)
        values["evidence"] = None
        if row.account_id is not None:
            outcomes = row.recent_outcomes
            late = row.next_payment_date is not None and today > grace_end(row.next_payment_date)
            if row.is_active and late and state != "ended_by_schedule":
                outcomes += "0"  # the date has passed and nothing matched
            outcomes = outcomes[-3:]
            seen = sum(1 for outcome in outcomes if outcome in "01")  # "p" is only his word
            values["evidence"] = EvidenceOut(
                last_matched_on=row.last_matched_on,
                last_matched_amount=row.last_charged_amount if row.last_matched_on else None,
                matched_of_last=outcomes.count("1"),
                checked=seen,
            )

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


def shown_icon(row: Any) -> str | None:
    """The fetched image of a payment, only while it is the one for the address it has now."""
    if row.icon_url is not None and row.icon_checked_url == row.icon_url:
        return str(row.icon_data) if row.icon_data else None
    return None


class RowErrorOut(BaseModel):
    model_config = _RESPONSE

    row: int  # 1 is the first row (the first data row of a CSV file); 0 is the file itself
    field: str | None
    message: str
    code: str | None  # stable: date_ambiguous, amount_format, wrong_currency, required, ...

    @classmethod
    def of(cls, error: RowError) -> Self:
        return cls(row=error.row, field=error.field, message=error.message, code=error.code)


class ImportOut(BaseModel):
    """What a bulk load or a CSV import did. Any error means nothing was written."""

    model_config = _RESPONSE

    dry_run: bool
    created: int
    updated: int
    skipped: int  # rows whose `external_ref` already exists (with `on_conflict` skip)
    # Rows created that look like a payment already there (same name, currency, amount and
    # cadence) under another reference: a file edited by hand, or loaded another way before.
    probable_duplicates: int
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
    icon_data: str | None
    color: str | None
    # Can the paying account cover it (balance plus overdraft, or a card's room), counting the
    # earlier payments of the window from the same account? null when no account of ours pays,
    # or the amount cannot be told in the account's currency (no rate).
    covered: bool | None
    # When not covered: how much of THIS payment is missing (at most its amount), and how much the
    # account is short in all by then, counting the earlier payments of the window; both in the
    # account's currency.
    shortfall: int | None
    account_short_total: int | None
    account_currency: str | None
    overdue: bool  # already due and not seen paid: listed first, counted in the totals


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
    severity: Severity  # high: act now; medium: look soon; info: a plain fact
    title: str  # for logs and tools: a page writes its own sentence from `kind` and `facts`
    subject_type: Literal["recurring", "account", "connection"]
    subject_id: UUID
    subject_name: str  # the payment's, the account's, the bank's name: the row is self-contained
    provider: str | None  # of an account or connection item
    due_date: date | None
    amount: int | None
    currency: str | None
    display_amount: int | None
    converted: bool
    facts: dict[str, Fact]
    state: ItemState
    snoozed_until: datetime | None


class AttentionBulkOut(BaseModel):
    model_config = _RESPONSE

    items: list[AttentionItem]  # the items that were found, as they are now
    missing: list[str]  # keys that are not an item right now: nothing was done for them
    accepted: list[str]  # with `accept`: the keys whose charged amount became the amount


class AttentionOut(BaseModel):
    model_config = _RESPONSE

    items: list[AttentionItem]
    hidden: int  # dismissed or snoozed items left out (all shown with `include_hidden`)
    display: DisplayOut
