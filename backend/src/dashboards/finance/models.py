"""The tables of the `finance` schema, as migrations `dashboards_0007` to `0009` create them.

The migration also makes two transaction indexes, on `(account_id, booked_at DESC, id DESC)` and
`(booked_at DESC, id DESC)`; they only matter to queries, so they are not declared here.

Kept apart from the task tables: their own declarative base and metadata (schema `finance`), so
nothing here is ever mixed into `src.dashboards.models.Base`. Money is `BigInteger` minor units
plus an ISO 4217 alpha code; there is no float column.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    MetaData,
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
    __table_args__ = (UniqueConstraint("provider", "ref", name="uq_connection_provider_ref"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    ref: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ok")
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(32), nullable=True)
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
