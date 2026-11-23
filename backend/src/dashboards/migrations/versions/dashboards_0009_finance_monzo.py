"""Finance: what a second provider (Monzo) needs.

Shared tables get three plain columns every provider may fill: `account.opened_at` (where its
history starts), `transaction.declined` (refused by the bank: never money that moved) and
`transaction.settled_at`. Monzo's OAuth state lives in two tables of its own, `monzo_token` and
`monzo_oauth_state`: provider-specific auth never goes in the shared tables.

Revision ID: dashboards_0009
Revises: dashboards_0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0009"
down_revision: str | Sequence[str] | None = "dashboards_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "finance"


def upgrade() -> None:
    op.add_column(
        "account", sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "transaction",
        sa.Column("declined", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "transaction",
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_table(
        "monzo_token",
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approval_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("connection_id", name="pk_monzo_token"),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            [f"{SCHEMA}.connection.id"],
            name="fk_monzo_token_connection_id_connection",
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "monzo_oauth_state",
        sa.Column("state_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("state_hash", name="pk_monzo_oauth_state"),
        schema=SCHEMA,
    )
