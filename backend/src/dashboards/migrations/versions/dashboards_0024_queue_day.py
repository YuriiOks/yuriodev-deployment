"""The streak of cleared queues: one row per page and local day.

Revision ID: dashboards_0024
Revises: dashboards_0023
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0024"
down_revision: str | Sequence[str] | None = "dashboards_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "queue_day",
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("opened", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("cleared_after_open", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("empty_now", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("scope", "day", name="pk_queue_day"),
    )
