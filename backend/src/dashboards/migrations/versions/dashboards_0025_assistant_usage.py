"""What the assistant used each local day, for its daily caps.

Revision ID: dashboards_0025
Revises: dashboards_0024
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0025"
down_revision: str | Sequence[str] | None = "dashboards_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_usage",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("requests", sa.Integer(), server_default="0", nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("day", name="pk_assistant_usage"),
    )
