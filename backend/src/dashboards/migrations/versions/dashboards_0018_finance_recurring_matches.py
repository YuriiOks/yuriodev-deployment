"""Finance: matches of recurring payments kept for good, and the day a payment keeps.

`finance.recurring_match` records which transaction paid which due date of which payment (one
transaction can pay one payment once; a due date is settled once), so a match can no longer be
taken twice when the payment's latest transaction id moves on. `recurring.anchor_day` is the day
of the month the dates keep, so 31 January stays 31 through February instead of drifting to 28.
The references of rows loaded from a CSV file no longer contain the row number: the old
`csv:<name>:<currency>:<row>` become `csv:<name>:<currency>:<n>`, `n` counting from 1 among the
rows with that name and currency.

Revision ID: dashboards_0018
Revises: dashboards_0017
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0018"
down_revision: str | Sequence[str] | None = "dashboards_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PICK = "SELECT id, external_ref FROM finance.recurring WHERE external_ref ~ '^csv:.*:[0-9]+$'"
PARK = (
    "UPDATE finance.recurring SET external_ref = 'tmp:' || id::text "
    "WHERE external_ref ~ '^csv:.*:[0-9]+$'"
)


def upgrade() -> None:
    op.create_table(
        "recurring_match",
        sa.Column("recurring_id", sa.Uuid(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("recurring_id", "due_date", name="pk_recurring_match"),
        sa.ForeignKeyConstraint(
            ["recurring_id"],
            ["finance.recurring.id"],
            name="fk_recurring_match_recurring_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["finance.transaction.id"],
            name="fk_recurring_match_transaction_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("transaction_id", name="uq_recurring_match_transaction"),
        schema="finance",
    )
    op.add_column(
        "recurring", sa.Column("anchor_day", sa.SmallInteger(), nullable=True), schema="finance"
    )
    op.execute(
        "UPDATE finance.recurring "
        "SET anchor_day = EXTRACT(DAY FROM COALESCE(start_date, next_payment_date))::smallint "
        "WHERE COALESCE(start_date, next_payment_date) IS NOT NULL"
    )
    # The last match of every payment that has one (what the old roll-forward kept).
    op.execute(
        "INSERT INTO finance.recurring_match (recurring_id, due_date, transaction_id) "
        "SELECT r.id, COALESCE(r.last_matched_on, r.last_paid_on, r.next_payment_date), "
        "r.last_transaction_id FROM finance.recurring r "
        "WHERE r.last_transaction_id IS NOT NULL "
        "AND COALESCE(r.last_matched_on, r.last_paid_on, r.next_payment_date) IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    )
    # The references of CSV rows, off the row number: through a temporary name, so no two rows
    # ever hold the same reference, even for a moment.
    bind = op.get_bind()
    rows = bind.execute(sa.text(PICK)).all()
    by_base: dict[str, list[tuple[int, object]]] = {}
    for row_id, ref in rows:
        base, _, number = ref.rpartition(":")
        by_base.setdefault(base, []).append((int(number), row_id))
    renames = [
        (row_id, f"{base}:{rank}")
        for base, items in by_base.items()
        for rank, (_, row_id) in enumerate(sorted(items, key=lambda item: item[0]), start=1)
    ]
    bind.execute(sa.text(PARK))
    for row_id, new in renames:
        bind.execute(
            sa.text("UPDATE finance.recurring SET external_ref = :ref WHERE id = :id"),
            {"ref": new, "id": row_id},
        )
