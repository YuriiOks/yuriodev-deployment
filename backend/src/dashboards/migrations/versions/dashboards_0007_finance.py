"""Finance: a schema of its own with the bank connections, accounts and transactions.

Static tables in the `finance` schema, never mixed into the task tables. Money is an integer in
minor units (cents, kopiykas) next to an ISO 4217 alpha code; there is no float anywhere.
Provider-specific auth or consent state does not belong here: a provider keeps its own tables.
`connection.status` is the one shared place for "is this link healthy", for the page to show.

Revision ID: dashboards_0007
Revises: dashboards_0006
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0007"
down_revision: str | Sequence[str] | None = "dashboards_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "finance"
UUID_DEFAULT = sa.text("gen_random_uuid()")


def _stamp(name: str) -> sa.Column[datetime]:
    column_type = sa.DateTime(timezone=True)
    return sa.Column(name, column_type, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    op.create_table(
        "connection",
        sa.Column("id", sa.Uuid(), server_default=UUID_DEFAULT, nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("ref", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), server_default="ok", nullable=False),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(32), nullable=True),
        _stamp("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_connection"),
        sa.UniqueConstraint("provider", "ref", name="uq_connection_provider_ref"),
        sa.CheckConstraint(
            "status IN ('ok', 'needs_reconsent', 'paused')", name="ck_connection_status"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "account",
        sa.Column("id", sa.Uuid(), server_default=UUID_DEFAULT, nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", sa.String(32), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("mask_last4", sa.String(4), nullable=True),
        sa.Column("balance", sa.BigInteger(), nullable=False),
        sa.Column("credit_limit", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("balance_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived", sa.Boolean(), server_default=sa.false(), nullable=False),
        # Where the collector stands: everything up to `synced_until` is fetched; everything
        # from `backfilled_from` on is fetched; the history walk is over when `backfill_done`.
        sa.Column("synced_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backfilled_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backfill_done", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("empty_streak", sa.SmallInteger(), server_default="0", nullable=False),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.PrimaryKeyConstraint("id", name="pk_account"),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            [f"{SCHEMA}.connection.id"],
            name="fk_account_connection_id_connection",
        ),
        sa.UniqueConstraint("provider", "external_id", name="uq_account_provider_external_id"),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_account_currency"),
        sa.CheckConstraint("mask_last4 ~ '^[0-9]{4}$'", name="ck_account_mask_last4"),
        schema=SCHEMA,
    )
    op.create_table(
        "transaction",
        sa.Column("id", sa.Uuid(), server_default=UUID_DEFAULT, nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("booked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("original_amount", sa.BigInteger(), nullable=True),
        sa.Column("original_currency", sa.String(3), nullable=True),
        sa.Column("description", sa.String(500), server_default="", nullable=False),
        sa.Column("counterparty", sa.String(200), nullable=True),
        sa.Column("category_code", sa.String(16), nullable=True),
        sa.Column("balance_after", sa.BigInteger(), nullable=True),
        sa.Column("pending", sa.Boolean(), server_default=sa.false(), nullable=False),
        _stamp("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_transaction"),
        sa.ForeignKeyConstraint(
            ["account_id"], [f"{SCHEMA}.account.id"], name="fk_transaction_account_id_account"
        ),
        sa.UniqueConstraint(
            "account_id", "external_id", name="uq_transaction_account_id_external_id"
        ),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_transaction_currency"),
        sa.CheckConstraint(
            "original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'",
            name="ck_transaction_original_currency",
        ),
        sa.CheckConstraint(
            "(original_amount IS NULL) = (original_currency IS NULL)",
            name="ck_transaction_original_pair",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_transaction_account_booked",
        "transaction",
        ["account_id", sa.text("booked_at DESC"), sa.text("id DESC")],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_transaction_booked",
        "transaction",
        [sa.text("booked_at DESC"), sa.text("id DESC")],
        schema=SCHEMA,
    )
