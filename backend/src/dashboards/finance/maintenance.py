"""Upkeep of the finance tables: categories, and the owner's own card-to-card moves.

`recompute_categories` works out `category` again from the raw provider code with the rules the
collectors use (`categories.categorize`): for every line that has no category yet, and for every
line that has a provider code and is not a move between own accounts, so a fixed or extended
rule reaches the lines already stored. It runs after the migrations, in batches, writes only the
lines whose category changes, never touches an owner's override, and is a no-op once nothing
changes. `pair_own_transfers` finds the two legs of a move between two accounts of the same owner
at a provider that does not say so.
"""

import uuid
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import and_, bindparam, func, or_, select, update
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
# Legs in two currencies: the converted amount may differ from the other leg by this many percent
# (the bank's own rate and spread are not ours) unless the bank states the other amount itself.
CROSS_TOLERANCE_PERCENT = 3


class _Leg(NamedTuple):
    id: uuid.UUID
    account_id: uuid.UUID
    booked_at: datetime
    amount: int
    currency: str
    original_amount: int | None
    original_currency: str | None
    internal: bool  # already a move between own accounts: counted as a candidate, never changed


Pair = tuple[_Leg, _Leg]  # (out, in)


def _close(out: _Leg, other: _Leg) -> bool:
    near = abs(other.booked_at - out.booked_at) <= PAIR_WINDOW
    return near and other.account_id != out.account_id


async def recompute_categories(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Bring `category` in line with the rules; returns how many lines changed. Lines with an
    owner's override keep it (it is another column); lines that carry no provider code (a
    statement's own category, an owner's choice made before) are left as they are."""
    changed = 0
    last: uuid.UUID | None = None
    statement = (
        update(Transaction)
        .where(Transaction.id == bindparam("row_id"))
        .values(category=bindparam("new_category"))
    )
    while True:
        async with sessions() as session, session.begin():
            query = (
                select(
                    Transaction.id,
                    Account.provider,
                    Transaction.category_code,
                    Transaction.amount,
                    Transaction.internal_transfer,
                    Transaction.category,
                )
                .join(Account, Account.id == Transaction.account_id)
                .where(
                    or_(
                        Transaction.category.is_(None),
                        and_(
                            Transaction.internal_transfer.is_(False),
                            Transaction.category_code.is_not(None),
                        ),
                    )
                )
                .order_by(Transaction.id)
                .limit(BATCH)
            )
            if last is not None:
                query = query.where(Transaction.id > last)
            rows = (await session.execute(query)).all()
            if not rows:
                return changed
            last = rows[-1].id
            changes: list[dict[str, object]] = []
            for row in rows:
                now = categorize(row.provider, row.category_code, row.amount, row.internal_transfer)
                if now != row.category:
                    changes.append({"row_id": row.id, "new_category": now})
            if changes:
                connection = await session.connection()
                await connection.execute(statement, changes)
                changed += len(changes)


async def _horizon(session: AsyncSession, provider: str) -> datetime | None:
    """The moment up to which every open account of the provider has been read; None when one
    has never been read (or there is none): a line seen so far may still have a partner that
    has not arrived."""
    found = (
        await session.execute(
            select(func.min(Account.synced_until), func.count(), func.count(Account.synced_until))
            .where(Account.provider == provider, Account.archived.is_(False))
            .limit(1)
        )
    ).one()
    oldest, total, read = found
    return oldest if total and total == read else None


def _same_currency(
    legs: Sequence[_Leg], ready: Callable[[_Leg], bool]
) -> tuple[list[Pair], set[uuid.UUID]]:
    """The moves of equal and opposite amounts in one currency, and every leg that had a
    candidate of this kind (so the cross-currency pass leaves it alone)."""
    groups: dict[tuple[str, int], list[_Leg]] = defaultdict(list)
    for leg in legs:
        groups[(leg.currency, abs(leg.amount))].append(leg)
    pairs: list[Pair] = []
    contested: set[uuid.UUID] = set()
    for group in groups.values():
        outs = [leg for leg in group if leg.amount < 0]
        ins = [leg for leg in group if leg.amount > 0]
        near_out = {out.id: [other for other in ins if _close(out, other)] for out in outs}
        near_in = {other.id: [o for o in outs if other in near_out[o.id]] for other in ins}
        for out in outs:
            found = near_out[out.id]
            if found:
                contested.add(out.id)
                contested.update(other.id for other in found)
            if len(found) != 1 or len(near_in[found[0].id]) != 1:
                continue
            other = found[0]
            if not (out.internal or other.internal) and ready(out) and ready(other):
                pairs.append((out, other))
    return pairs, contested


def _states_other_amount(first: _Leg, second: _Leg) -> bool:
    """Does the bank's own `original` amount of one leg equal the other leg exactly?"""
    for one, two in ((first, second), (second, first)):
        if (
            one.original_amount is not None
            and one.original_currency == two.currency
            and abs(one.original_amount) == abs(two.amount)
        ):
            return True
    return False


def _cross_currency(
    legs: Sequence[_Leg],
    skip: set[uuid.UUID],
    ready: Callable[[_Leg], bool],
    convert: Callable[[int, str, str], int | None],
) -> list[Pair]:
    """Moves between two currencies: an out and an in leg within the window on two accounts,
    whose amounts agree (the bank states the other amount, or the converted amount is within
    `CROSS_TOLERANCE_PERCENT` of it). Each must be the other's only candidate."""
    outs = [leg for leg in legs if leg.amount < 0 and leg.id not in skip]
    ins = sorted((leg for leg in legs if leg.amount > 0 and leg.id not in skip), key=_when)
    moments = [leg.booked_at for leg in ins]

    def agree(out: _Leg, other: _Leg) -> bool:
        if other.currency == out.currency or not _close(out, other):
            return False
        if _states_other_amount(out, other):
            return True
        shown = convert(abs(out.amount), out.currency, other.currency)
        if shown is None:
            return False
        return abs(shown - other.amount) * 100 <= CROSS_TOLERANCE_PERCENT * other.amount

    near_out: dict[uuid.UUID, list[_Leg]] = {}
    near_in: dict[uuid.UUID, list[_Leg]] = defaultdict(list)
    for out in outs:
        low = bisect_left(moments, out.booked_at - PAIR_WINDOW)
        high = bisect_right(moments, out.booked_at + PAIR_WINDOW)
        near_out[out.id] = [other for other in ins[low:high] if agree(out, other)]
        for other in near_out[out.id]:
            near_in[other.id].append(out)
    pairs: list[Pair] = []
    for out in outs:
        found = near_out[out.id]
        if len(found) != 1 or len(near_in[found[0].id]) != 1:
            continue
        other = found[0]
        if not (out.internal or other.internal) and ready(out) and ready(other):
            pairs.append((out, other))
    return pairs


def _when(leg: _Leg) -> datetime:
    return leg.booked_at


async def pair_own_transfers(
    sessions: async_sessionmaker[AsyncSession],
    provider: str,
    since: datetime | None = None,
    now: datetime | None = None,
) -> int:
    """Mark both legs of a move between two accounts of one provider as internal.

    A leg is a money-transfer line (`TRANSFER_CODES`) that is not declined and not decided by
    the owner (`transfer_locked`, unless the owner made it internal). Two lines are one move when
    their amounts are equal and opposite in one currency, or (the bank states the other amount,
    or the converted amount is close: `CROSS_TOLERANCE_PERCENT`) in two currencies, on two
    different accounts, booked within `PAIR_WINDOW`, and each is the ONLY candidate of the other
    (lines already internal count as candidates): if a line could belong to two moves none of
    them is paired, so a payment to a person is never swallowed by a lookalike.

    Nothing is paired until every open account of the provider has been read past the legs'
    time plus `PAIR_WINDOW`: whichever account is read first must not decide a move whose other
    leg (or a third, rival leg) has not arrived. Both lines become `internal_transfer` with the
    category `transfers` (an owner override is untouched). `since` limits the lines looked at
    (the newest ones, after a refresh). Returns the pairs."""
    async with sessions() as session, session.begin():
        horizon = await _horizon(session, provider)
        if horizon is None:
            return 0
        query = (
            select(
                Transaction.id,
                Transaction.account_id,
                Transaction.booked_at,
                Transaction.amount,
                Transaction.currency,
                Transaction.original_amount,
                Transaction.original_currency,
                Transaction.internal_transfer,
            )
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Account.provider == provider,
                Transaction.category_code.in_(TRANSFER_CODES),
                Transaction.declined.is_(False),
                or_(
                    Transaction.transfer_locked.is_(False),
                    Transaction.internal_transfer.is_(True),
                ),
            )
            .order_by(Transaction.booked_at, Transaction.id)
        )
        if since is not None:
            query = query.where(Transaction.booked_at >= since - PAIR_WINDOW)
        legs = [_Leg(*row) for row in (await session.execute(query)).all()]

        def ready(leg: _Leg) -> bool:
            return leg.booked_at + PAIR_WINDOW <= horizon

        pairs, contested = _same_currency(legs, ready)
        taken = {leg.id for pair in pairs for leg in pair}
        pairs += await _cross_pairs(session, legs, contested | taken, ready, now)
        paired = [leg.id for pair in pairs for leg in pair]
        if paired:
            await session.execute(
                update(Transaction)
                .where(Transaction.id.in_(paired))
                .values(internal_transfer=True, category="transfers")
            )
    return len(pairs)


async def _cross_pairs(
    session: AsyncSession,
    legs: Sequence[_Leg],
    skip: set[uuid.UUID],
    ready: Callable[[_Leg], bool],
    now: datetime | None,
) -> list[Pair]:
    # Imported here: the exchange rates live in a module that imports the collectors, which
    # import this one.
    from src.dashboards.finance.fx import load_rates

    if len({leg.currency for leg in legs}) < 2:
        return []
    book = await load_rates(session, now or datetime.now(UTC))
    return _cross_currency(legs, skip, ready, book.convert)
