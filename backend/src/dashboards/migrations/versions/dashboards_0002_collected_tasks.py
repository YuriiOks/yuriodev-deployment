"""Collected tasks: a link, one row per external item, and a tombstone for deleted ones.

`task.source` gains `github` and `linear`; `task.source_ref` (already there) holds the external id
and becomes unique per source; `task.url` is new; `task_tombstone` remembers a collected task the
user deleted, so the collector does not bring it back while the external item is unchanged.

Revision ID: dashboards_0002
Revises: dashboards_0001
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0002"
down_revision: str | Sequence[str] | None = "dashboards_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCES = "'web', 'mcp', 'telegram', 'import', 'github', 'linear'"


def _stamp(name: str) -> sa.Column[datetime]:
    column_type = sa.DateTime(timezone=True)
    return sa.Column(name, column_type, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.add_column("task", sa.Column("url", sa.Text(), nullable=True))
    op.drop_constraint("ck_task_source", "task", type_="check")
    op.create_check_constraint("ck_task_source", "task", f"source IN ({SOURCES})")
    op.create_index(
        "uq_task_source_source_ref",
        "task",
        ["source", "source_ref"],
        unique=True,
        postgresql_where=sa.text("source_ref IS NOT NULL"),
    )
    op.create_table(
        "task_tombstone",
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("source_ref", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        _stamp("deleted_at"),
        sa.PrimaryKeyConstraint("source", "source_ref", name="pk_task_tombstone"),
    )
