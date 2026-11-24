"""Finance: a category of its own for money sent to other people.

`transfers` is now only a move between the owner's own accounts (internal, left out of spending);
what a money-transfer code (MCC 4829, 6538-6540) sends to someone else is `transfers_out`. The
check constraints of `category` and `category_override` take the new value; rows already stored
are re-worked at startup (`maintenance.recategorize_transfers`).

Revision ID: dashboards_0016
Revises: dashboards_0015
"""

from collections.abc import Sequence

from alembic import op

revision: str = "dashboards_0016"
down_revision: str | Sequence[str] | None = "dashboards_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORIES = (
    "'housing_utilities', 'groceries', 'eating_out', 'transport', 'subscriptions', 'health', "
    "'shopping', 'entertainment', 'debt', 'income', 'transfers', 'transfers_out', 'cash', 'other'"
)
DROP = (
    "DO $$ DECLARE name text; BEGIN "
    "FOR name IN SELECT conname FROM pg_constraint "
    "WHERE conrelid = 'finance.transaction'::regclass AND contype = 'c' "
    "AND pg_get_constraintdef(oid) LIKE '%' || 'COLUMN' || ' IS NULL%' LOOP "
    "EXECUTE format('ALTER TABLE finance.transaction DROP CONSTRAINT %I', name); END LOOP; END $$"
)


def upgrade() -> None:
    for column in ("category", "category_override"):
        op.execute(DROP.replace("COLUMN", column))
        op.execute(
            f"ALTER TABLE finance.transaction ADD CONSTRAINT ck_transaction_{column}_set "
            f"CHECK ({column} IS NULL OR {column} IN ({CATEGORIES}))"
        )
