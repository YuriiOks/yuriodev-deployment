"""Collected tasks: the source's own priority, last-update time and draft flag.

Three collector-owned columns on `task`, for ordering and marking collected tasks (they are
written on every sync and never by the user; manual tasks keep NULL / false). They are separate
from the user's `priority` flag, which is the hand-picked Priority panel: an urgent Linear issue
must not appear there on its own.

- `source_priority`: `urgent`, `high`, `medium`, `low` or `none` (Linear), else NULL.
- `source_updated_at`: when the item was last updated at the source.
- `draft`: a GitHub pull request that is still a draft.

Revision ID: dashboards_0010
Revises: dashboards_0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0010"
down_revision: str | Sequence[str] | None = "dashboards_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task", sa.Column("source_priority", sa.String(8), nullable=True))
    op.add_column(
        "task", sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "task", sa.Column("draft", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    levels = "'urgent', 'high', 'medium', 'low', 'none'"
    op.create_check_constraint(
        "ck_task_source_priority",
        "task",
        f"source_priority IS NULL OR source_priority IN ({levels})",
    )
