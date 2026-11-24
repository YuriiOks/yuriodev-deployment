"""Finance: whether a line's time is known, and the owner's say on a move between own accounts.

`transaction.time_known` is false for a statement line that carried only a day (it is booked at
noon of that day), so a page does not show a time it does not have. Every line already stored is
true: the time of an earlier statement line cannot be told from one that really is 12:00.
`transaction.transfer_locked` is true once the owner set or cleared `internal_transfer` by hand:
neither a collector's refetch nor the pairing of own-card moves changes such a line again.

Revision ID: dashboards_0019
Revises: dashboards_0018
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0019"
down_revision: str | Sequence[str] | None = "dashboards_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transaction",
        sa.Column("time_known", sa.Boolean(), server_default=sa.true(), nullable=False),
        schema="finance",
    )
    op.add_column(
        "transaction",
        sa.Column("transfer_locked", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="finance",
    )
