"""Response shapes of the finance API. Money is an `int` in minor units next to its ISO code."""

from datetime import datetime
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

_RESPONSE = ConfigDict(extra="forbid", frozen=True, from_attributes=True)


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

    @classmethod
    def from_row(cls, row: Any, history_from: datetime | None = None) -> Self:
        derived = ("own_balance_minor", "history_from")
        values = {name: getattr(row, name) for name in cls.model_fields if name not in derived}
        values["own_balance_minor"] = row.balance - row.credit_limit
        values["history_from"] = history_from
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


class TransactionsOut(BaseModel):
    model_config = _RESPONSE

    transactions: list[TransactionOut]
    next_cursor: str | None


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


class FinanceSummaryOut(BaseModel):
    model_config = _RESPONSE

    month: str  # YYYY-MM, in the configured time zone
    as_of: datetime | None  # the oldest balance among the accounts counted
    currencies: list[CurrencySummary]
