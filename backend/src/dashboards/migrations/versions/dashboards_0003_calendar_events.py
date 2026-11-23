"""Calendar events: the external id of a collected event, one row per id.

`event.source` gains `calendar`; `event.source_ref` (new) holds the calendar collector's id for the
event (space, iCal UID and the occurrence's original start) and is unique per source.

Revision ID: dashboards_0003
Revises: dashboards_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0003"
down_revision: str | Sequence[str] | None = "dashboards_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCES = "'web', 'mcp', 'telegram', 'import', 'calendar'"


def upgrade() -> None:
    op.add_column("event", sa.Column("source_ref", sa.Text(), nullable=True))
    op.drop_constraint("ck_event_source", "event", type_="check")
    op.create_check_constraint("ck_event_source", "event", f"source IN ({SOURCES})")
    op.create_index(
        "uq_event_source_source_ref",
        "event",
        ["source", "source_ref"],
        unique=True,
        postgresql_where=sa.text("source_ref IS NOT NULL"),
    )
