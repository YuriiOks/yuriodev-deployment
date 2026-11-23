"""Projects: the registry of user-created projects.

Each project's tasks live in a schema of their own, created by the app when the project is
(`src/dashboards/projects.py`); this migration only adds the registry in the main schema. The
`schema_version` column is how those schemas are migrated later: the app brings every project up
to the code's latest version at startup, under an advisory lock.

Revision ID: dashboards_0005
Revises: dashboards_0004
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0005"
down_revision: str | Sequence[str] | None = "dashboards_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _stamp(name: str) -> sa.Column[datetime]:
    column_type = sa.DateTime(timezone=True)
    return sa.Column(name, column_type, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "project",
        sa.Column("id", sa.String(31), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("archived", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        _stamp("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_project"),
    )
