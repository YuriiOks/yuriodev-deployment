"""A move between the owner's own cards is two lines the bank does not connect: they are paired
(equal and opposite, two accounts, two minutes, each the other's only candidate); a payment to a
person keeps its own category. Every name and amount is invented."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from src.dashboards.finance.maintenance import pair_own_transfers, recategorize_transfers
from src.dashboards.finance.models import Transaction
from tests.dashboards_support import AUTH, running, scalar
from tests.finance_support import (
    ACC_A,
    ACC_B,
    ACC_C,
    FakeMonobank,
    at,
    client_for,
    collector,
    drive,
    mono_account,
    mono_item,
    seed,
    ts,
    tx,
)

pytestmark = pytest.mark.anyio

MOVE = {"category_code": "4829", "category": "transfers_out"}
MOVES = (
    "SELECT string_agg(external_id || ':' || internal_transfer::text || ':' || category, ',' "
    "ORDER BY external_id) FROM finance.transaction WHERE external_id IN ('out-1', 'in-1')"
)
NOON = at(11, 20, 12, 0)


def leg(n, account, when, amount, **extra):
    return tx(n, account, when, amount, "Card to card", **{**MOVE, **extra})


async def add(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def stored(app, *numbers):
    """(internal, category) of the numbered test transactions."""
    async with app.state.dashboards.sessions() as session:
        found = await session.scalars(select(Transaction))
        return {
            int(row.id) - 1000: (row.internal_transfer, row.category)
            for row in found
            if int(row.id) - 1000 in numbers
        }


async def test_two_equal_opposite_lines_on_two_accounts_within_two_minutes_are_one_move(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000),
            leg(41, ACC_C, NOON + timedelta(seconds=100), 50_000),
            leg(42, ACC_A, NOON + timedelta(hours=2), -7_000),  # the other leg is too late
            leg(43, ACC_C, NOON + timedelta(hours=2, minutes=30), 7_000),
            leg(44, ACC_A, NOON + timedelta(hours=3), -3_000),  # no other leg at all
            tx(45, ACC_A, NOON + timedelta(hours=4), -2_000, "Card", category="other"),
            leg(46, ACC_C, NOON + timedelta(hours=4, seconds=5), 2_000),  # the other is a purchase
            leg(47, ACC_A, NOON + timedelta(hours=5), -1_000),  # both on one account
            leg(48, ACC_A, NOON + timedelta(hours=5, seconds=5), 1_000),
            leg(49, ACC_A, NOON + timedelta(hours=6), -9_000),  # two sends, one receipt
            leg(50, ACC_A, NOON + timedelta(hours=6, seconds=10), -9_000),
            leg(51, ACC_C, NOON + timedelta(hours=6, seconds=5), 9_000),
            leg(52, ACC_A, NOON + timedelta(hours=7), -800, declined=True),  # refused
            leg(53, ACC_C, NOON + timedelta(hours=7, seconds=5), 800),
        )
        first = await pair_own_transfers(sessions, "sample")
        again = await pair_own_transfers(sessions, "sample")
        state = await stored(app, *range(40, 54))

    assert (first, again) == (1, 0)
    assert state[40] == state[41] == (True, "transfers")
    others = {value for number, value in state.items() if number not in (40, 41)}
    assert others == {(False, "transfers_out"), (False, "other")}


async def test_the_pairing_can_look_at_the_newest_lines_only_and_keeps_the_owners_category(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000),
            leg(41, ACC_C, NOON + timedelta(seconds=10), 50_000, category_override="health"),
        )
        too_new = await pair_own_transfers(sessions, "sample", since=NOON + timedelta(days=1))
        found = await pair_own_transfers(sessions, "sample", since=NOON - timedelta(days=1))
        override = await scalar(
            db_url,
            "SELECT category_override FROM finance.transaction WHERE category_override IS NOT NULL",
        )

    assert (too_new, found, override) == (0, 1, "health")


async def test_a_different_currency_or_provider_is_never_paired(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -5_000),
            leg(41, ACC_B, NOON + timedelta(seconds=5), 5_000),  # euros
        )
        same_provider = await pair_own_transfers(sessions, "sample")
        other_provider = await pair_own_transfers(sessions, "elsewhere")

    assert (same_provider, other_provider) == (0, 0)


async def test_old_transfers_that_were_not_between_own_accounts_get_their_new_category(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -5_000, category="transfers"),  # to a person
            leg(41, ACC_C, NOON, 5_000, category="transfers"),  # from a person
            leg(42, ACC_A, NOON, -3_000, category="transfers", internal_transfer=True),
        )
        changed = await recategorize_transfers(sessions)
        again = await recategorize_transfers(sessions)
        state = await stored(app, 40, 41, 42)

    assert (changed, again) == (2, 0)
    assert state == {40: (False, "transfers_out"), 41: (False, "income"), 42: (True, "transfers")}


async def test_the_collector_pairs_own_card_moves_and_a_refetch_keeps_them(
    db_url, make_dashboards_app, clock
):
    own = [
        mono_account("acc-black", balance=1_000_000),
        mono_account("acc-grey", balance=500_000, kind="white", pan="537541******5678"),
    ]
    moved = ts(2026, 11, 20)
    fake = FakeMonobank(
        own,
        {
            "acc-black": [
                mono_item("out-1", moved, -50_000, "To card", mcc=4829),
                mono_item("out-2", moved - 86_400, -1_000, "To a friend", mcc=4829),
                mono_item("shop", moved, -450, "Corner Cafe", mcc=5812),
            ],
            "acc-grey": [mono_item("in-1", moved + 8, 50_000, "From card", mcc=4829)],
        },
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 5)
        first = await scalar(db_url, MOVES)
        clock.now += timedelta(minutes=25)
        await drive(finance, client, sessions, clock, 4)  # the same windows again
        second = await scalar(db_url, MOVES)
        friend = await scalar(
            db_url,
            "SELECT category || ':' || internal_transfer::text FROM finance.transaction "
            "WHERE external_id = 'out-2'",
        )

    assert first == "in-1:true:transfers,out-1:true:transfers"
    assert second == first
    assert friend == "transfers_out:false"
