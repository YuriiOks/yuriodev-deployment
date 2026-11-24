"""Finance: banks without an API, entered by hand.

A manual connection has no collector (`manual`), may carry a display name and its own brand colour
pair (for a bank that is not one of the built-in brands), and its `last_ok_at` is the date its
newest data (a balance or a statement) is as of.

Revision ID: dashboards_0015
Revises: dashboards_0014
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0015"
down_revision: str | Sequence[str] | None = "dashboards_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "connection",
        sa.Column("manual", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="finance",
    )
    op.add_column("connection", sa.Column("display_name", sa.String(60)), schema="finance")
    op.add_column("connection", sa.Column("brand_bg", sa.String(7)), schema="finance")
    op.add_column("connection", sa.Column("brand_fg", sa.String(7)), schema="finance")
    op.create_check_constraint(
        "ck_connection_brand",
        "connection",
        "(brand_bg IS NULL) = (brand_fg IS NULL) AND "
        "(brand_bg IS NULL OR (brand_bg ~ '^#[0-9a-f]{6}$' AND brand_fg ~ '^#[0-9a-f]{6}$'))",
        schema="finance",
    )
