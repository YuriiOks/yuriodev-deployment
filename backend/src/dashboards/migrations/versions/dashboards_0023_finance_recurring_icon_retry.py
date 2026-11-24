"""Finance: when to look for a payment's icon again after a failure.

`recurring.icon_retry_at` is set when a fetch fails (hours ahead) and while a payment is claimed
by the icon worker (minutes ahead), so a site that refused or timed out is not asked every
minute and two workers never take the same payment.

Revision ID: dashboards_0023
Revises: dashboards_0022
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0023"
down_revision: str | Sequence[str] | None = "dashboards_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recurring",
        sa.Column("icon_retry_at", sa.DateTime(timezone=True), nullable=True),
        schema="finance",
    )
