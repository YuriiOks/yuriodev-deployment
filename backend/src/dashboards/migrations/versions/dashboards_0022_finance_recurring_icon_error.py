"""Finance: why an icon could not be fetched, and an icon set by hand.

`recurring.icon_error` is a short code (not_public, timeout, blocked_status_403, too_large,
not_an_image, unsafe_svg, no_icon_found, ...) kept with a failed fetch so it can be diagnosed
without logs. `recurring.icon_manual` is true when the owner uploaded the icon: the fetcher leaves
such a payment alone.

Revision ID: dashboards_0022
Revises: dashboards_0021
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0022"
down_revision: str | Sequence[str] | None = "dashboards_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recurring", sa.Column("icon_error", sa.String(40), nullable=True), schema="finance"
    )
    op.add_column(
        "recurring",
        sa.Column("icon_manual", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="finance",
    )
