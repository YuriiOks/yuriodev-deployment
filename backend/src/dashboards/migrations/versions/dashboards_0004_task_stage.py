"""Task stage: a collector-owned grouping label.

`task.stage` is a short nullable text the collectors write on every sync (a Linear state type,
or `mine` / `review` for GitHub). The user never sets it; manual tasks keep NULL.

Revision ID: dashboards_0004
Revises: dashboards_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0004"
down_revision: str | Sequence[str] | None = "dashboards_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task", sa.Column("stage", sa.String(16), nullable=True))
