"""Finance: mark a transaction as a transfer between the owner's own accounts.

Only the data: `transaction.internal_transfer` is set by a provider when it can tell that the
counterparty is another account of the same owner. Nothing reads it yet; a later summary can leave
such rows out of spent and received.

Revision ID: dashboards_0008
Revises: dashboards_0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0008"
down_revision: str | Sequence[str] | None = "dashboards_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transaction",
        sa.Column("internal_transfer", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="finance",
    )
