"""Finance: exchange rates, for showing every amount in one display currency.

One row per currency against hryvnia (the pivot of the source, Monobank's public rates): the rate
is an exact decimal, `as_of` is the source's own time for the pair, `source` says where it came
from. Stored amounts are never touched; a rate is only used to show a converted figure beside the
original.

Revision ID: dashboards_0012
Revises: dashboards_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0012"
down_revision: str | Sequence[str] | None = "dashboards_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fx_rate",
        sa.Column("base", sa.String(3), nullable=False),
        sa.Column("quote", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(24, 12), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("base", "quote", name="pk_fx_rate"),
        sa.CheckConstraint("rate > 0", name="ck_fx_rate_positive"),
        sa.CheckConstraint("base ~ '^[A-Z]{3}$' AND quote ~ '^[A-Z]{3}$'", name="ck_fx_rate_codes"),
        schema="finance",
    )
