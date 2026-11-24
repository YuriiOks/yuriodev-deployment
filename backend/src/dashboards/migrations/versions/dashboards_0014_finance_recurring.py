"""Finance: recurring payments and what the owner did with attention items.

`finance.recurring` holds payments the owner enters by hand (the API, the MCP tools or an
import): amount in minor units of its currency, cadence, next date, the paying account (one we
collect, deleting it only unlinks) or a free-text source, and the debt and instalment fields.
`finance.attention_state` remembers a dismissed or snoozed attention item by its key.

Revision ID: dashboards_0014
Revises: dashboards_0013
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0014"
down_revision: str | Sequence[str] | None = "dashboards_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recurring",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("external_ref", sa.String(80), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("frequency", sa.String(8), nullable=False),
        sa.Column("frequency_interval", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("next_payment_date", sa.Date(), nullable=True),
        sa.Column("payment_type", sa.String(40), nullable=True),
        sa.Column("payment_mode", sa.String(40), nullable=True),
        sa.Column("category", sa.String(40), nullable=True),
        sa.Column("notes", sa.String(2000), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("auto_renew", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("payment_method", sa.String(80), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("match_text", sa.String(80), nullable=True),
        sa.Column("reminder_days", sa.SmallInteger(), nullable=True),
        sa.Column("icon_url", sa.String(500), nullable=True),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("is_installment", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("total_installments", sa.Integer(), nullable=True),
        sa.Column("completed_installments", sa.Integer(), nullable=True),
        sa.Column("total_owed", sa.BigInteger(), nullable=True),
        sa.Column("remaining_balance", sa.BigInteger(), nullable=True),
        sa.Column("creditor", sa.String(120), nullable=True),
        sa.Column("target_amount", sa.BigInteger(), nullable=True),
        sa.Column("current_saved", sa.BigInteger(), nullable=True),
        sa.Column("recipient", sa.String(120), nullable=True),
        sa.Column("last_paid_on", sa.Date(), nullable=True),
        sa.Column("last_charged_amount", sa.BigInteger(), nullable=True),
        sa.Column("last_transaction_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_recurring"),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["finance.account.id"],
            name="fk_recurring_account_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["last_transaction_id"],
            ["finance.transaction.id"],
            name="fk_recurring_last_transaction_id",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("external_ref", name="uq_recurring_external_ref"),
        sa.CheckConstraint(
            "kind IN ('subscription', 'debt', 'utility', 'insurance', 'housing', 'service', "
            "'one_time')",
            name="ck_recurring_kind",
        ),
        sa.CheckConstraint(
            "frequency IN ('once', 'daily', 'weekly', 'monthly', 'yearly')",
            name="ck_recurring_frequency",
        ),
        sa.CheckConstraint(
            "frequency_interval BETWEEN 1 AND 366", name="ck_recurring_frequency_interval"
        ),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_recurring_currency"),
        sa.CheckConstraint("amount >= 0", name="ck_recurring_amount"),
        sa.CheckConstraint("color IS NULL OR color ~ '^#[0-9a-f]{6}$'", name="ck_recurring_color"),
        sa.CheckConstraint(
            "icon_url IS NULL OR icon_url ~ '^https://'", name="ck_recurring_icon_url"
        ),
        sa.CheckConstraint(
            "reminder_days IS NULL OR reminder_days BETWEEN 0 AND 90",
            name="ck_recurring_reminder_days",
        ),
        schema="finance",
    )
    op.create_table(
        "attention_state",
        sa.Column("key", sa.String(200), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("key", name="pk_attention_state"),
        sa.CheckConstraint("state IN ('dismissed', 'snoozed')", name="ck_attention_state_state"),
        sa.CheckConstraint(
            "state = 'dismissed' OR until IS NOT NULL", name="ck_attention_state_until"
        ),
        schema="finance",
    )
