"""A move between the owner's own cards is two lines the bank does not connect: they are paired
(equal and opposite, two accounts, two minutes, each the other's only candidate); a payment to a
person keeps its own category. Every name and amount is invented."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.dashboards.finance.maintenance import pair_own_transfers, recompute_categories
from src.dashboards.finance.models import Transaction
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import (
    ACC_A,
    ACC_B,
    ACC_C,
    FakeMonobank,
    account,
    at,
    client_for,
    collector,
    drive,
    mono_account,
    mono_item,
    seed,
    seed_rates,
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
ACC_D = uuid.UUID(int=13)  # UAH, open, added by the tests that need a third account
SYNCED = "UPDATE finance.account SET synced_until = '2026-11-22T12:00:00Z'"


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
        await execute(db_url, SYNCED)
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
        await execute(db_url, SYNCED)
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
        await execute(db_url, SYNCED)
        same_provider = await pair_own_transfers(sessions, "sample")
        other_provider = await pair_own_transfers(sessions, "elsewhere")

    assert (same_provider, other_provider) == (0, 0)


async def test_a_changed_rule_reaches_the_lines_already_stored_and_leaves_the_rest(
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
            tx(43, ACC_A, NOON, -900, "Pets", category_code="5995", category="other"),
            tx(
                44,
                ACC_A,
                NOON,
                -800,
                "Own pick",
                category_code="5995",
                category="other",
                category_override="health",
            ),
            tx(45, ACC_A, NOON, -700, "From a file", category="entertainment"),  # no code
        )
        changed = await recompute_categories(sessions)
        again = await recompute_categories(sessions)
        state = await stored(app, 40, 41, 42, 43, 44, 45)
        override = await scalar(
            db_url, "SELECT category_override FROM finance.transaction WHERE external_id = 'ext-44'"
        )

    assert (changed, again) == (4, 0)
    assert state == {
        40: (False, "transfers_out"),
        41: (False, "income"),
        42: (True, "transfers"),
        43: (False, "shopping"),
        44: (False, "shopping"),  # the shown category is the override, kept apart
        45: (False, "entertainment"),
    }
    assert override == "health"


async def test_nothing_is_paired_until_every_account_has_been_read_past_the_legs(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(app, account(ACC_D, "Third", "UAH", 1))
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000),
            leg(41, ACC_C, NOON + timedelta(seconds=10), 50_000),
        )
        await execute(db_url, SYNCED)
        await execute(db_url, "UPDATE finance.account SET synced_until = NULL WHERE name = 'Third'")
        never = await pair_own_transfers(sessions, "sample")  # one account was never read
        await execute(db_url, "UPDATE finance.account SET synced_until = '2026-11-20T12:01:00Z'")
        short = await pair_own_transfers(sessions, "sample")  # read to 12:01, window to 12:02:10
        await execute(db_url, "UPDATE finance.account SET synced_until = '2026-11-20T12:03:00Z'")
        done = await pair_own_transfers(sessions, "sample")

    assert (never, short, done) == (0, 0, 1)


async def test_a_late_rival_leg_stops_a_pair_that_looked_certain(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(app, account(ACC_D, "Third", "UAH", 1))
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000),
            leg(41, ACC_C, NOON + timedelta(seconds=10), 50_000),
            leg(42, ACC_D, NOON + timedelta(seconds=20), 50_000),  # read last: a rival
        )
        await execute(db_url, SYNCED)
        found = await pair_own_transfers(sessions, "sample")
        state = await stored(app, 40, 41, 42)

    assert found == 0
    assert {internal for internal, _ in state.values()} == {False}


async def test_a_line_already_paired_still_counts_as_a_candidate(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(app, account(ACC_D, "Third", "UAH", 1))
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000, internal_transfer=True, category="transfers"),
            leg(
                41,
                ACC_C,
                NOON + timedelta(seconds=10),
                50_000,
                internal_transfer=True,
                category="transfers",
            ),
            leg(42, ACC_D, NOON + timedelta(seconds=20), -50_000),  # a lookalike out
        )
        await execute(db_url, SYNCED)
        found = await pair_own_transfers(sessions, "sample")
        state = await stored(app, 42)

    assert (found, state) == (0, {42: (False, "transfers_out")})


async def test_the_owners_decision_is_never_overturned_by_pairing(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -50_000, transfer_locked=True),  # the owner said: not mine
            leg(41, ACC_C, NOON + timedelta(seconds=10), 50_000),
        )
        await execute(db_url, SYNCED)
        found = await pair_own_transfers(sessions, "sample")

    assert found == 0


async def test_a_move_between_two_currencies_is_paired_by_the_banks_own_amount(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await add(
            app,
            leg(40, ACC_A, NOON, -43_700, original_amount=-1_000, original_currency="EUR"),
            leg(41, ACC_B, NOON + timedelta(seconds=10), 1_000),
            leg(42, ACC_A, NOON + timedelta(hours=1), -43_700),  # no amount stated, no rates
            leg(43, ACC_B, NOON + timedelta(hours=1, seconds=10), 1_000),
        )
        await execute(db_url, SYNCED)
        found = await pair_own_transfers(sessions, "sample")
        state = await stored(app, 40, 41, 42, 43)

    assert found == 1
    assert state[40] == state[41] == (True, "transfers")
    assert state[42][0] is False
    assert state[43][0] is False


async def test_a_move_between_two_currencies_is_paired_when_the_converted_amount_is_close(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        sessions = app.state.dashboards.sessions
        await seed(app)
        await seed_rates(app)  # one euro is 43.75 hryvnia
        await add(
            app,
            leg(40, ACC_A, NOON, -44_000),  # 1 005.7 euro cents-wise: within 3%
            leg(41, ACC_B, NOON + timedelta(seconds=10), 1_000),
            leg(42, ACC_A, NOON + timedelta(hours=1), -60_000),  # far from 1 000 euro
            leg(43, ACC_B, NOON + timedelta(hours=1, seconds=10), 1_000),
        )
        await execute(db_url, SYNCED)
        found = await pair_own_transfers(sessions, "sample", now=NOON)
        state = await stored(app, 40, 41, 42, 43)

    assert found == 1
    assert (state[40][0], state[41][0]) == (True, True)
    assert (state[42][0], state[43][0]) == (False, False)


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
