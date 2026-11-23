"""Dashboards schema: spaces, areas, tasks and events, with the seed rows.

Revision ID: dashboards_0001
Revises:
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from src.dashboards.catalog import PERSONAL_AREAS, SPACE_IDS

revision: str = "dashboards_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _stamp(name: str) -> sa.Column[datetime]:
    column_type = sa.DateTime(timezone=True)
    return sa.Column(name, column_type, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    space = op.create_table(
        "space",
        sa.Column("id", sa.String(16), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_space"),
    )
    area = op.create_table(
        "area",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("space_id", sa.String(16), nullable=False),
        sa.Column("name_ru", sa.String(120), nullable=False),
        sa.Column("name_en", sa.String(120), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"], name="fk_area_space_id_space"),
        sa.PrimaryKeyConstraint("id", name="pk_area"),
    )
    op.create_table(
        "task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.String(16), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("area_id", sa.String(64), nullable=True),
        sa.Column("priority", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(8), server_default="open", nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(16), server_default="web", nullable=False),
        sa.Column("source_ref", sa.Text(), nullable=True),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.CheckConstraint("status IN ('open', 'done')", name="ck_task_status"),
        sa.CheckConstraint("source IN ('web', 'mcp', 'telegram', 'import')", name="ck_task_source"),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"], name="fk_task_space_id_space"),
        sa.ForeignKeyConstraint(["area_id"], ["area.id"], name="fk_task_area_id_area"),
        sa.PrimaryKeyConstraint("id", name="pk_task"),
    )
    op.create_index("ix_task_space_id_status", "task", ["space_id", "status"])
    op.create_table(
        "event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.String(16), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("busy_only", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("source", sa.String(16), server_default="web", nullable=False),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.CheckConstraint("ends_at > starts_at", name="ck_event_ends_after_start"),
        sa.CheckConstraint(
            "source IN ('web', 'mcp', 'telegram', 'import')", name="ck_event_source"
        ),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"], name="fk_event_space_id_space"),
        sa.PrimaryKeyConstraint("id", name="pk_event"),
    )
    op.create_index("ix_event_starts_at", "event", ["starts_at"])

    op.bulk_insert(space, [{"id": space_id} for space_id in SPACE_IDS])
    op.bulk_insert(
        area,
        [
            {
                "id": seed.id,
                "space_id": "personal",
                "name_ru": seed.name_ru,
                "name_en": seed.name_en,
                "sort": position,
            }
            for position, seed in enumerate(PERSONAL_AREAS, start=1)
        ],
    )
