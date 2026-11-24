"""Finance: an overdraft limit the owner sets by hand.

`account.overdraft_limit_override` is written only by the owner (PATCH or the MCP tool), never by a
collector, so a refresh keeps it. A bank that sends no limit (Monzo sends none) leaves
`overdraft_limit` empty; the owner's value is what the page shows and what `available_minor` uses.

Revision ID: dashboards_0013
Revises: dashboards_0012
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0013"
down_revision: str | Sequence[str] | None = "dashboards_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "account",
        sa.Column("overdraft_limit_override", sa.BigInteger(), nullable=True),
        schema="finance",
    )
    op.create_check_constraint(
        "ck_account_overdraft_limit_override",
        "account",
        "overdraft_limit_override IS NULL OR overdraft_limit_override >= 0",
        schema="finance",
    )
