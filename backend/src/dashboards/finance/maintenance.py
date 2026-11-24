"""Startup upkeep of the finance tables: the category of every transaction that has none.

Transactions imported before categories existed (or by a provider that did not name one) have a
null `category`; this works it out from the raw provider code with the same rules the collectors
use (`categories.categorize`). It runs after the migrations, in batches, and is a no-op once
nothing is left.
"""

from sqlalchemy import bindparam, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.dashboards.finance.categories import categorize
from src.dashboards.finance.models import Account, Transaction

BATCH = 1000


async def fill_categories(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Give every transaction without a category one; returns how many were filled."""
    total = 0
    statement = (
        update(Transaction)
        .where(Transaction.id == bindparam("row_id"))
        .values(category=bindparam("new_category"))
    )
    while True:
        async with sessions() as session, session.begin():
            rows = (
                await session.execute(
                    select(
                        Transaction.id,
                        Account.provider,
                        Transaction.category_code,
                        Transaction.amount,
                        Transaction.internal_transfer,
                    )
                    .join(Account, Account.id == Transaction.account_id)
                    .where(Transaction.category.is_(None))
                    .limit(BATCH)
                )
            ).all()
            if not rows:
                return total
            changes = [
                {
                    "row_id": row.id,
                    "new_category": categorize(
                        row.provider, row.category_code, row.amount, row.internal_transfer
                    ),
                }
                for row in rows
            ]
            connection = await session.connection()
            await connection.execute(statement, changes)
            total += len(rows)
