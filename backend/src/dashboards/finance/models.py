"""The tables of the `finance` schema, as migrations `dashboards_0007` to `0009` create them.

The migration also makes two transaction indexes, on `(account_id, booked_at DESC, id DESC)` and
`(booked_at DESC, id DESC)`; they only matter to queries, so they are not declared here.

Kept apart from the task tables: their own declarative base and metadata (schema `finance`), so
nothing here is ever mixed into `src.dashboards.models.Base`. Money is `BigInteger` minor units
plus an ISO 4217 alpha code; there is no float column.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "finance"
CONNECTION_STATUSES = ("ok", "needs_reconsent", "paused")
ACCOUNT_KINDS = ("current", "credit_card", "savings", "pot", "business")


class FinanceBase(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


class Connection(FinanceBase):
    """One link to a provider (one token, one consent). `status` is for the page to show."""

    __tablename__ = "connection"
    __table_args__ = (
        UniqueConstraint("provider", "ref", name="uq_connection_provider_ref"),
        CheckConstraint(
            "(brand_bg IS NULL) = (brand_fg IS NULL) AND "
            "(brand_bg IS NULL OR (brand_bg ~ '^#[0-9a-f]{6}$' AND brand_fg ~ '^#[0-9a-f]{6}$'))",
            name="ck_connection_brand",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    ref: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ok")
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Entered by hand (migration `dashboards_0015`): no collector reads it, `last_ok_at` is the
    # date its newest data is as of, and the owner may name it and colour it himself.
    manual: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    display_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    brand_bg: Mapped[str | None] = mapped_column(String(7), nullable=True)
    brand_fg: Mapped[str | None] = mapped_column(String(7), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Account(FinanceBase):
    __tablename__ = "account"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_account_provider_external_id"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_account_currency"),
        CheckConstraint("mask_last4 ~ '^[0-9]{4}$'", name="ck_account_mask_last4"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.connection.id"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    mask_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False)
    credit_limit: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    balance_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How a page presents it (migration `dashboards_0011`): the kind, a pot's current account and
    # goal, a current account's overdraft, a neutral sub-type label.
    kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="current")
    parent_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.account.id"), nullable=True
    )
    goal_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    overdraft_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # The owner's own figure (migration `dashboards_0013`), written by no collector: it wins over
    # whatever the bank sends.
    overdraft_limit_override: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    synced_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    backfilled_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    backfill_done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    empty_streak: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Transaction(FinanceBase):
    __tablename__ = "transaction"
    __table_args__ = (
        UniqueConstraint("account_id", "external_id", name="uq_transaction_account_id_external_id"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_transaction_currency"),
        CheckConstraint(
            "original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'",
            name="ck_transaction_original_currency",
        ),
        CheckConstraint(
            "(original_amount IS NULL) = (original_currency IS NULL)",
            name="ck_transaction_original_pair",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.account.id"), nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    booked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    original_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    original_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False, server_default="")
    counterparty: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    balance_after: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    pending: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    internal_transfer: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    declined: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The normalised category (null until worked out) and the owner's override, which no collector
    # writes: what a page shows is the override, else the category, else "other".
    category: Mapped[str | None] = mapped_column(String(24), nullable=True)
    category_override: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FxRate(FinanceBase):
    """The latest rate of a currency against hryvnia (`quote`): units of `quote` per one `base`.
    One row per currency, replaced on every refresh; `as_of` is the source's own time."""

    __tablename__ = "fx_rate"

    base: Mapped[str] = mapped_column(String(3), primary_key=True)
    quote: Mapped[str] = mapped_column(String(3), primary_key=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(24, 12), nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MonzoToken(FinanceBase):
    """Monzo's OAuth state for one connection: owned by the Monzo provider, never selected by the
    API. The tokens are stored as the provider issued them (see deploy/README.md, "Finance")."""

    __tablename__ = "monzo_token"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.connection.id"), primary_key=True
    )
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Set when the API first answered: the owner approved the client in the app. The five
    # minutes in which the whole history can be read start then.
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MonzoOAuthState(FinanceBase):
    """A consent `state` that was handed out: only its hash is kept, single use, short lived."""

    __tablename__ = "monzo_oauth_state"

    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


RECURRING_KINDS = (
    "subscription",
    "debt",
    "utility",
    "insurance",
    "housing",
    "service",
    "one_time",
)
RECURRING_FREQUENCIES = ("once", "daily", "weekly", "monthly", "yearly")


class Recurring(FinanceBase):
    """A payment the owner makes again and again (or once, on a date), entered by hand: through
    the API, the MCP tools or an import. Amounts are minor units of `currency`; `amount` is what
    is paid (positive). `next_payment_date` moves on by itself once a matching transaction is
    seen (see `recurring_service.roll_forward`). Nothing here is ever sent to a bank."""

    __tablename__ = "recurring"
    __table_args__ = (
        UniqueConstraint("external_ref", name="uq_recurring_external_ref"),
        CheckConstraint(
            "kind IN ('subscription', 'debt', 'utility', 'insurance', 'housing', 'service', "
            "'one_time')",
            name="ck_recurring_kind",
        ),
        CheckConstraint(
            "frequency IN ('once', 'daily', 'weekly', 'monthly', 'yearly')",
            name="ck_recurring_frequency",
        ),
        CheckConstraint(
            "frequency_interval BETWEEN 1 AND 366",
            name="ck_recurring_frequency_interval",
        ),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_recurring_currency"),
        CheckConstraint("amount >= 0", name="ck_recurring_amount"),
        CheckConstraint(
            "color IS NULL OR color ~ '^#[0-9a-f]{6}$'",
            name="ck_recurring_color",
        ),
        CheckConstraint(
            "icon_url IS NULL OR icon_url ~ '^https://'",
            name="ck_recurring_icon_url",
        ),
        CheckConstraint(
            "reminder_days IS NULL OR reminder_days BETWEEN 0 AND 90",
            name="ck_recurring_reminder_days",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    external_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    frequency: Mapped[str] = mapped_column(String(8), nullable=False)
    frequency_interval: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="1"
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payment_mode: Mapped[str | None] = mapped_column(String(40), nullable=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    auto_renew: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    payment_method: Mapped[str | None] = mapped_column(String(80), nullable=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.account.id", ondelete="SET NULL"), nullable=True
    )
    match_text: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reminder_days: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_installment: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    total_installments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_installments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_owed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    remaining_balance: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    creditor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    current_saved: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    recipient: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Written by the roll-forward (migration `dashboards_0017`): the date a transaction last
    # matched (not the owner saying "paid"), how many instalments were only passed by the schedule
    # (never confirmed by a line), and the outcome of the last three due dates ("1" matched).
    last_matched_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    assumed_installments: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    recent_outcomes: Mapped[str] = mapped_column(String(3), nullable=False, server_default="")
    last_charged_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.transaction.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AttentionState(FinanceBase):
    """What the owner did with an attention item (`key` names the condition and its occasion, so a
    new occasion is a new key): dismissed for good, or snoozed until a time."""

    __tablename__ = "attention_state"
    __table_args__ = (
        CheckConstraint("state IN ('dismissed', 'snoozed')", name="ck_attention_state_state"),
        CheckConstraint(
            "state = 'dismissed' OR until IS NOT NULL",
            name="ck_attention_state_until",
        ),
    )

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    state: Mapped[str] = mapped_column(String(10), nullable=False)
    until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
