"""Finance: what a page needs to present an account, and a category for every transaction.

Accounts gain a `kind` (current, credit_card, savings, pot, business), a pot's `parent_account_id`
and `goal_amount`, a current account's `overdraft_limit` and a neutral `label`. The rows that are
already there get the kind their `type` and credit limit tell; the rest is filled by the next
refresh of each provider.

Transactions gain `category` (one of the fixed set; null until worked out, which the backend does
at startup for every row that has none) and `category_override` (the owner's choice, written by no
collector).

Revision ID: dashboards_0011
Revises: dashboards_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dashboards_0011"
down_revision: str | Sequence[str] | None = "dashboards_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "finance"
KINDS = "'current', 'credit_card', 'savings', 'pot', 'business'"
CATEGORIES = (
    "'housing_utilities', 'groceries', 'eating_out', 'transport', 'subscriptions', 'health', "
    "'shopping', 'entertainment', 'debt', 'income', 'transfers', 'cash', 'other'"
)


def upgrade() -> None:
    op.add_column(
        "account",
        sa.Column("kind", sa.String(16), server_default="current", nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "account", sa.Column("parent_account_id", sa.Uuid(), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "account", sa.Column("goal_amount", sa.BigInteger(), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "account", sa.Column("overdraft_limit", sa.BigInteger(), nullable=True), schema=SCHEMA
    )
    op.add_column("account", sa.Column("label", sa.String(60), nullable=True), schema=SCHEMA)
    op.create_foreign_key(
        "fk_account_parent_account_id_account",
        "account",
        "account",
        ["parent_account_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_check_constraint("ck_account_kind", "account", f"kind IN ({KINDS})", schema=SCHEMA)
    op.add_column("transaction", sa.Column("category", sa.String(24), nullable=True), schema=SCHEMA)
    op.add_column(
        "transaction", sa.Column("category_override", sa.String(24), nullable=True), schema=SCHEMA
    )
    for column in ("category", "category_override"):
        op.create_check_constraint(
            f"ck_transaction_{column}",
            "transaction",
            f"{column} IS NULL OR {column} IN ({CATEGORIES})",
            schema=SCHEMA,
        )
    op.execute("UPDATE finance.account SET kind = 'pot' WHERE type = 'pot'")
    op.execute("UPDATE finance.account SET kind = 'savings' WHERE type = 'jar'")
    op.execute("UPDATE finance.account SET kind = 'business' WHERE type = 'fop'")
    op.execute(
        "UPDATE finance.account SET kind = 'credit_card' "
        "WHERE provider = 'monobank' AND credit_limit > 0 AND kind = 'current'"
    )
