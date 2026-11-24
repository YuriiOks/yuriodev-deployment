"""Finance: what the bank's lines say about a recurring payment.

`last_matched_on` is the date a transaction last matched a payment (the owner saying "paid" is not
a match), `recent_outcomes` the outcome of its last three due dates ("1" matched, "0" not), and
`assumed_installments` the instalments that were only passed by the schedule, kept apart from
`completed_installments`, which only a line or the owner confirms.

Revision ID: dashboards_0017
Revises: dashboards_0016
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0017"
down_revision: str | Sequence[str] | None = "dashboards_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recurring", sa.Column("last_matched_on", sa.Date(), nullable=True), schema="finance"
    )
    op.add_column(
        "recurring",
        sa.Column("assumed_installments", sa.Integer(), server_default="0", nullable=False),
        schema="finance",
    )
    op.add_column(
        "recurring",
        sa.Column("recent_outcomes", sa.String(3), server_default="", nullable=False),
        schema="finance",
    )
    op.execute(
        "UPDATE finance.recurring SET last_matched_on = last_paid_on, recent_outcomes = '1' "
        "WHERE last_transaction_id IS NOT NULL"
    )
