"""Finance: tell a name the code made up from a name a person gave.

`account.name_generated` is true when the collector built the name itself ("Black card UAH",
"Pot GBP"), so a page can write its own words from `type`, `label` and `currency` instead of
showing an English sentence. Rows already stored keep false until the next refresh rewrites them.

Revision ID: dashboards_0020
Revises: dashboards_0019
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0020"
down_revision: str | Sequence[str] | None = "dashboards_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "account",
        sa.Column("name_generated", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="finance",
    )
