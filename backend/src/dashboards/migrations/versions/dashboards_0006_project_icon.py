"""Projects: an optional icon key.

`project.icon` is a short key (lower-case letters, digits, hyphens) into the frontend's drawings:
the backend stores it and checks its shape only, so a new drawing needs no migration.

Revision ID: dashboards_0006
Revises: dashboards_0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0006"
down_revision: str | Sequence[str] | None = "dashboards_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project", sa.Column("icon", sa.String(24), nullable=True))
