"""Upkeep of the finance tables: categories, and the owner's own card-to-card moves.

Transactions imported before categories existed (or by a provider that did not name one) have a
null `category`; `fill_categories` works it out from the raw provider code with the same rules the
collectors use (`categories.categorize`). It runs after the migrations, in batches, and is a no-op
once nothing is left. `recategorize_transfers` redoes the rows once called `transfers` that were
not between the owner's own accounts (they are `transfers_out` now). `pair_own_transfers` finds
the two legs of a move between two accounts of the same owner at a provider that does not say so.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import NamedTuple

from sqlalchemy import bindparam, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.dashboards.finance.categories import categorize
from src.dashboards.finance.models import Account, Transaction

BATCH = 1000
# The codes (ISO 18245) a money transfer carries, the only lines that can be one leg of a move
# between the owner's own cards: a card payment never is.
TRANSFER_CODES = ("4829", "6538", "6539", "6540")
# Both legs of one move are booked within seconds; two minutes is wide enough for the bank's own
# delays and narrow enough that an unrelated payment of the same amount rarely falls inside.
PAIR_WINDOW = timedelta(minutes=2)
PAIRING_PROVIDERS = ("monobank",)


class _Leg(NamedTuple):
    id: uuid.UUID
    account_id: uuid.UUID
    booked_at: datetime
    amount: int
    currency: str


def _close(out: _Leg, other: _Leg) -> bool:
    near = abs(other.booked_at - out.booked_at) <= PAIR_WINDOW
    return near and other.account_id != out.account_id


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


async def recategorize_transfers(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Rework the lines stored as `transfers` that are not internal: the same rules, which now
    call a payment to another person `transfers_out` (money in becomes `income`). Idempotent."""
    changed = 0
    statement = (
        update(Transaction)
        .where(Transaction.id == bindparam("row_id"))
        .values(category=bindparam("new_category"))
    )
    async with sessions() as session, session.begin():
        rows = (
            await session.execute(
                select(
                    Transaction.id,
                    Account.provider,
                    Transaction.category_code,
                    Transaction.amount,
                )
                .join(Account, Account.id == Transaction.account_id)
                .where(
                    Transaction.category == "transfers",
                    Transaction.internal_transfer.is_(False),
                )
            )
        ).all()
        changes: list[dict[str, object]] = []
        for row in rows:
            now = categorize(row.provider, row.category_code, row.amount, False)
            if now != "transfers":
                changes.append({"row_id": row.id, "new_category": now})
        if changes:
            connection = await session.connection()
            await connection.execute(statement, changes)
            changed = len(changes)
    return changed


async def pair_own_transfers(
    sessions: async_sessionmaker[AsyncSession], provider: str, since: datetime | None = None
) -> int:
    """Mark both legs of a move between two accounts of one provider as internal.

    A leg is a money-transfer line (`TRANSFER_CODES`) that is not declined and not yet internal.
    Two lines are one move when their amounts are equal and opposite, in one currency, on two
    different accounts, booked within `PAIR_WINDOW` of each other, and each is the ONLY candidate
    of the other: if a line could belong to two moves (two equal sends and one receipt, say) none
    of them is paired, so a payment to a person is never swallowed by a lookalike. Both lines
    become `internal_transfer` with the category `transfers` (an owner override is untouched).
    `since` limits the lines looked at (the newest ones, after a refresh). Returns the pairs."""
    async with sessions() as session, session.begin():
        query = (
            select(
                Transaction.id,
                Transaction.account_id,
                Transaction.booked_at,
                Transaction.amount,
                Transaction.currency,
            )
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Account.provider == provider,
                Transaction.category_code.in_(TRANSFER_CODES),
                Transaction.internal_transfer.is_(False),
                Transaction.declined.is_(False),
            )
            .order_by(Transaction.booked_at, Transaction.id)
        )
        if since is not None:
            query = query.where(Transaction.booked_at >= since)
        legs = [_Leg(*row) for row in (await session.execute(query)).all()]
        groups: dict[tuple[str, int], list[_Leg]] = defaultdict(list)
        for leg in legs:
            groups[(leg.currency, abs(leg.amount))].append(leg)
        paired: list[uuid.UUID] = []
        for group in groups.values():
            outs = [leg for leg in group if leg.amount < 0]
            ins = [leg for leg in group if leg.amount > 0]
            near_out = {out.id: [other for other in ins if _close(out, other)] for out in outs}
            near_in = {other.id: [o for o in outs if other in near_out[o.id]] for other in ins}
            for out in outs:
                found = near_out[out.id]
                if len(found) == 1 and len(near_in[found[0].id]) == 1:
                    paired.extend([out.id, found[0].id])
        if paired:
            await session.execute(
                update(Transaction)
                .where(Transaction.id.in_(paired))
                .values(internal_transfer=True, category="transfers")
            )
    return len(paired) // 2
