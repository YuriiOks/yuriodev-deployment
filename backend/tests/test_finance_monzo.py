"""The Monzo collector against a real Postgres and a faked Monzo: the approval wait, the five
minutes of full history, the 90-day limit after them, token refresh (ahead, raced, refused) and
the steady loop."""

import asyncio
from datetime import datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError
from src.dashboards.finance.base import FinanceCollector
from src.dashboards.finance.monzo import MonzoProvider
from src.dashboards.finance.monzo_auth import TokenPair, store_consent, usable_token
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import drive
from tests.monzo_support import (
    ACCOUNT,
    MZ_ID,
    MZ_KEY,
    POT,
    FakeMonzo,
    monzo_tx,
    no_sleep,
    stamp,
)

pytestmark = pytest.mark.anyio

COUNT = "SELECT count(*) FROM finance.transaction"
BASE = "/api/dashboards/v1/finance"
ACCOUNT_FIELD = "SELECT FIELD FROM finance.account WHERE external_id = 'ACCOUNT'"
TX_FIELD = "SELECT FIELD FROM finance.transaction WHERE external_id = 'EXT'"


def collector_for(app, clock, months=12):
    provider = MonzoProvider(
        SecretStr(MZ_ID), SecretStr(MZ_KEY), app.state.dashboards.sessions, clock, no_sleep
    )
    return FinanceCollector(provider, months, no_sleep)


async def consent(app, fake, clock):
    await store_consent(app.state.dashboards.sessions, fake.new_pair(), clock.now)


def client_for(fake):
    return httpx.AsyncClient(transport=httpx.MockTransport(fake))


async def account_field(db_url, field):
    return await scalar(db_url, ACCOUNT_FIELD.replace("FIELD", field).replace("ACCOUNT", ACCOUNT))


async def tx_field(db_url, field, number):
    statement = TX_FIELD.replace("FIELD", field).replace("EXT", f"tx_{number:022d}")
    return await scalar(db_url, statement)


def long_history(clock):
    """Three years of payments: 250 in the last five days, then one every four days."""
    now = clock.now
    recent = [monzo_tx(n, now - timedelta(hours=1, minutes=30 * n), -100 - n) for n in range(250)]
    older = [monzo_tx(1000 + n, now - timedelta(days=20 + 4 * n), -500) for n in range(270)]
    return recent + older


def odd_ones(clock):
    now = clock.now
    return [
        monzo_tx(
            2001, now - timedelta(days=2), -9_999, decline="INSUFFICIENT_FUNDS", settled=False
        ),
        monzo_tx(2002, now - timedelta(days=1), -2_500, settled=False),
        monzo_tx(2003, now - timedelta(days=3), -1_300, local=(-1_500, "EUR")),
        monzo_tx(2004, now - timedelta(days=4), -10_000, POT, merchant=None, pot=True),
    ]


async def test_the_whole_history_is_fetched_in_the_five_minutes_after_approval(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.transactions = long_history(clock)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as http, client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        results = await drive(collector_for(app, clock), client, sessions, clock, 3)
        accounts = await http.get(f"{BASE}/accounts")

    oldest = datetime.fromisoformat(min(row["created"] for row in fake.transactions))
    assert results[0]["calls"] > 10  # one burst did the lot
    assert [r["calls"] for r in results[1:]] == [0, 0]
    assert await scalar(db_url, COUNT) == len(fake.transactions)
    assert await account_field(db_url, "backfill_done") is True
    assert await scalar(db_url, "SELECT min(booked_at) FROM finance.transaction") == oldest
    types = await scalar(db_url, "SELECT string_agg(type, ',' ORDER BY type) FROM finance.account")
    assert types == "pot,uk_retail"
    # A pot has a balance and no statement: only the current account was asked for transactions.
    assert {p["account_id"] for p in fake.transaction_calls()} == {ACCOUNT}
    current = next(a for a in accounts.json()["accounts"] if a["type"] == "uk_retail")
    assert current["history_from"] == oldest.strftime("%Y-%m-%dT%H:%M:%SZ")  # "history from"
    assert current["opened_at"] == "2023-11-22T00:00:00Z"
    assert (current["balance"], current["name"]) == (150_000, "Current account GBP")


async def test_declined_pending_foreign_and_pot_transfers_are_mapped_and_a_decline_is_not_spent(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.transactions = odd_ones(clock)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as http, client_for(fake) as client:
        await consent(app, fake, clock)
        await drive(collector_for(app, clock), client, app.state.dashboards.sessions, clock, 1)
        summary = await http.get(f"{BASE}/summary")

    assert await tx_field(db_url, "declined::text || pending::text", 2001) == "truefalse"
    assert await tx_field(db_url, "pending", 2002) is True
    assert await tx_field(db_url, "settled_at IS NULL", 2002) is True
    assert await tx_field(db_url, "original_amount::text || original_currency", 2003) == "-1500EUR"
    assert await tx_field(db_url, "internal_transfer", 2004) is True
    assert await tx_field(db_url, "internal_transfer", 2003) is False
    assert await tx_field(db_url, "counterparty", 2003) == "Corner Cafe Ltd"
    assert await tx_field(db_url, "category_code", 2003) == "eating_out"
    gbp = next(c for c in summary.json()["currencies"] if c["currency"] == "GBP")
    # Neither the declined 99.99 nor the 100.00 moved into a pot is spending.
    assert gbp["spent"] == 2_500 + 1_300
    assert gbp["balance"] == 150_000 + 50_000  # the account and its pot, counted once each
    private = await scalar(
        db_url,
        "SELECT count(*) FROM finance.transaction "
        "WHERE description || coalesce(counterparty, '') LIKE '%SENTINEL%'",
    )
    assert private == 0  # no note, address or coordinates reached the table


async def test_the_collector_waits_for_the_in_app_approval(db_url, make_dashboards_app, clock):
    fake = FakeMonzo(clock)
    fake.approve_after = 3  # the API says 403 three times before the owner approves
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        result = await collector_for(app, clock).collect(
            client, app.state.dashboards.sessions, clock.now
        )

    assert result["accounts"] == 2  # the account and its pot
    assert fake.accounts_calls == 5  # three refusals, the answer, the joint accounts
    approved = await scalar(db_url, "SELECT approved_at IS NOT NULL FROM finance.monzo_token")
    assert approved is True


async def test_an_approval_that_never_comes_ends_in_needs_reconsent(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.approve_after = None
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        with pytest.raises(UpstreamError) as waiting:
            await finance.collect(client, sessions, clock.now)
        status_then = await scalar(db_url, "SELECT status FROM finance.connection")
        clock.now += timedelta(minutes=16)  # the deadline has passed
        with pytest.raises(UpstreamError) as gave_up:
            await finance.collect(client, sessions, clock.now)

    assert waiting.value.kind == "awaiting_approval"
    assert status_then == "ok"  # still hoping
    assert gave_up.value.kind == "auth"
    assert await scalar(db_url, "SELECT status FROM finance.connection") == "needs_reconsent"


async def test_after_the_five_minutes_only_the_last_90_days_are_asked_for(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.transactions = long_history(clock)
    fake.approved_at = clock.now - timedelta(minutes=10)  # approved a while ago
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        approved = (clock.now - timedelta(minutes=10)).isoformat()
        await execute(
            db_url,
            "UPDATE finance.monzo_token SET approved_at = 'STAMP'".replace("STAMP", approved),
        )
        await drive(collector_for(app, clock), client, app.state.dashboards.sessions, clock, 3)

    floor = clock.now - timedelta(days=90)
    asked = [datetime.fromisoformat(p["since"]) for p in fake.transaction_calls()]
    assert asked
    assert all(since >= floor for since in asked)  # the API would have refused older
    assert await account_field(db_url, "backfill_done") is True
    stored = await scalar(db_url, COUNT)
    assert 0 < stored < len(fake.transactions)


async def test_a_new_consent_restarts_a_walk_that_stopped_short(db_url, make_dashboards_app, clock):
    fake = FakeMonzo(clock)
    fake.transactions = long_history(clock)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        await drive(collector_for(app, clock), client, sessions, clock, 1)
        await consent(app, fake, clock)
        finished = await account_field(db_url, "backfill_done")  # a finished walk stays so
        await execute(
            db_url,
            "UPDATE finance.account SET backfill_done = true, "
            "backfilled_from = opened_at + interval '30 days'",
        )  # one that stopped short of the opening date does not
        await consent(app, fake, clock)
        done = await account_field(db_url, "backfill_done")

    assert (finished, done) == (True, False)


async def test_the_token_is_refreshed_ahead_of_its_expiry_once(db_url, make_dashboards_app, clock):
    fake = FakeMonzo(clock)
    app = make_dashboards_app(db_url)
    mz = (SecretStr(MZ_ID), SecretStr(MZ_KEY))
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        first = await usable_token(client, sessions, *mz, clock.now)
        first_issued = fake.access
        clock.now += timedelta(hours=5, minutes=45)  # inside the half hour before it expires
        refreshed = await usable_token(client, sessions, *mz, clock.now)
        again = await usable_token(client, sessions, *mz, clock.now)

    assert first.access_token == first_issued
    assert (refreshed.access_token, again.access_token) == (fake.access, fake.access)
    assert fake.access != first_issued
    assert fake.refresh_calls == 1
    stored = await scalar(db_url, "SELECT refresh_token FROM finance.monzo_token")
    assert stored == fake.refresh  # the new pair replaced the one that was spent


async def test_two_processes_cannot_both_spend_the_one_time_refresh_token(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    app = make_dashboards_app(db_url)
    mz = (SecretStr(MZ_ID), SecretStr(MZ_KEY))
    async with running(app, AUTH), client_for(fake) as one, client_for(fake) as two:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        clock.now += timedelta(hours=5, minutes=50)
        views = await asyncio.gather(
            *(usable_token(client, sessions, *mz, clock.now) for client in (one, two, one, two))
        )

    assert fake.refresh_calls == 1  # the others waited for the row, then found the new pair
    assert {view.access_token for view in views} == {fake.access}
    assert await scalar(db_url, "SELECT revoked_at IS NULL FROM finance.monzo_token") is True


async def test_a_refused_refresh_stops_all_calls_until_the_owner_consents_again(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        await finance.collect(client, sessions, clock.now)
        fake.fail_refresh = True
        clock.now += timedelta(hours=5, minutes=45)
        with pytest.raises(UpstreamError) as refused:
            await finance.collect(client, sessions, clock.now)
        status = await scalar(db_url, "SELECT status FROM finance.connection")
        calls = len(fake.calls)
        for minutes in (30, 60):  # nothing is sent while the token is revoked
            clock.now += timedelta(minutes=minutes)
            with pytest.raises(UpstreamError):
                await finance.collect(client, sessions, clock.now)
        silent = len(fake.calls) == calls
        fake.fail_refresh = False
        fake.approved_at = None  # the owner consents and approves in the app once more
        await consent(app, fake, clock)
        recovered = await finance.collect(client, sessions, clock.now)

    assert refused.value.kind == "auth"
    assert status == "needs_reconsent"
    assert silent
    assert recovered["calls"] > 0
    assert await scalar(db_url, "SELECT status FROM finance.connection") == "ok"


async def test_a_client_without_refresh_tokens_must_consent_again_when_the_token_expires(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    only = "access-without-refresh"
    app = make_dashboards_app(db_url)
    mz = (SecretStr(MZ_ID), SecretStr(MZ_KEY))
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        await store_consent(sessions, TokenPair(only, None, 7_200, "user_1"), clock.now)
        clock.now += timedelta(hours=1, minutes=45)  # nearly expired, but still good
        still = await usable_token(client, sessions, *mz, clock.now)
        clock.now += timedelta(hours=1)
        with pytest.raises(UpstreamError) as expired:
            await usable_token(client, sessions, *mz, clock.now)

    assert still.access_token == only
    assert expired.value.kind == "auth"
    assert fake.refresh_calls == 0
    assert await scalar(db_url, "SELECT revoked_at IS NOT NULL FROM finance.monzo_token") is True


async def test_a_consent_wakes_a_collector_that_was_waiting_for_one(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        with pytest.raises(UpstreamError) as nothing:  # no consent yet: wait twenty minutes
            await finance.collect(client, sessions, clock.now)
        clock.now += timedelta(minutes=1)
        idle = await finance.collect(client, sessions, clock.now)
        await consent(app, fake, clock)
        clock.now += timedelta(minutes=1)
        woken = await finance.collect(client, sessions, clock.now)

    assert nothing.value.kind == "auth"
    assert idle["calls"] == 0
    assert woken["accounts"] == 2  # not twenty minutes later: the five minutes would be gone


async def test_the_steady_loop_keeps_recent_days_fresh_and_updates_what_settles(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    pending = monzo_tx(1, now - timedelta(days=1), -2_500, settled=False)
    fake = FakeMonzo(clock)
    fake.transactions = [pending, monzo_tx(2, now - timedelta(days=30), -700)]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        await drive(finance, client, sessions, clock, 2)
        fake.transactions = [
            monzo_tx(1, now - timedelta(days=1), -2_500, settled=True),  # it settled
            monzo_tx(2, now - timedelta(days=30), -700),
            monzo_tx(3, clock.now + timedelta(minutes=20), -300),  # and a new one arrived
        ]
        clock.now += timedelta(minutes=25)
        results = await drive(finance, client, sessions, clock, 2)

    assert await scalar(db_url, COUNT) == 3
    assert await tx_field(db_url, "pending", 1) is False
    assert results[0]["accounts"] == 2
    assert sum(r["added"] for r in results) == 1
    assert sum(r["updated"] for r in results) >= 1


async def test_a_quiet_stretch_does_not_end_the_walk_of_an_account_with_an_opening_date(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    fake = FakeMonzo(clock)
    fake.accounts[0]["created"] = stamp(now - timedelta(days=700))
    # Nothing at all for the first 600 days, then two payments near the opening.
    fake.transactions = [
        monzo_tx(1, now - timedelta(days=650), -900),
        monzo_tx(2, now - timedelta(days=690), -800),
    ]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        results = await drive(collector_for(app, clock), client, sessions, clock, 2)

    assert await scalar(db_url, COUNT) == 2  # the old payments were found past 6 empty windows
    assert await account_field(db_url, "backfill_done") is True
    reached = await account_field(db_url, "backfilled_from <= opened_at")
    assert reached is True  # it walked back to the opening date
    assert results[1]["calls"] == 0  # and then it is silent


async def test_a_new_consent_resumes_only_the_accounts_that_stopped_short_of_their_opening(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    fake = FakeMonzo(clock)
    fake.transactions = [
        monzo_tx(1, now - timedelta(days=10), -100),
        monzo_tx(2, now - timedelta(days=300), -200),
        monzo_tx(3, now - timedelta(days=500), -300),
    ]
    fake.accounts[0]["created"] = stamp(now - timedelta(days=600))
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        await drive(finance, client, sessions, clock, 1)
        complete = await scalar(db_url, COUNT)
        await consent(app, fake, clock)  # a walk that is finished stays finished
        kept = await account_field(db_url, "backfill_done")
        # The walk stopped early, as it did on dev: only the newest 100 days were fetched.
        cut = (now - timedelta(days=100)).isoformat()
        await execute(
            db_url,
            "UPDATE finance.account SET backfill_done = true, empty_streak = 3, "
            "backfilled_from = 'CUT' WHERE type = 'uk_retail'".replace("CUT", cut),
        )
        await execute(
            db_url,
            "DELETE FROM finance.transaction WHERE booked_at < 'CUT'".replace("CUT", cut),
        )
        fake.approved_at = None  # the owner consents and approves again
        await consent(app, fake, clock)
        cleared = await account_field(db_url, "backfill_done")
        await drive(finance, client, sessions, clock, 1)
        resumed = await scalar(db_url, COUNT)

    assert (complete, kept) == (3, True)
    assert cleared is False  # stopped short of its opening date: walked again
    assert resumed == 3  # from where it stopped, inside the new window
    assert await account_field(db_url, "backfill_done") is True


async def test_a_slow_answer_while_waiting_for_the_approval_does_not_end_the_wait(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.approve_after = 1
    fake.accounts_errors = [httpx.ReadTimeout("slow")]  # the first ask times out
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        result = await collector_for(app, clock).collect(
            client, app.state.dashboards.sessions, clock.now
        )

    assert result["accounts"] == 2  # it asked again, was refused once, then approved
    assert await scalar(db_url, "SELECT approved_at IS NOT NULL FROM finance.monzo_token") is True


async def test_the_edge_of_the_five_minutes_is_not_a_refused_token(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    fake = FakeMonzo(clock)
    # Monzo's five minutes ended a minute before we noticed the approval.
    fake.approved_at = now - timedelta(minutes=6)
    fake.transactions = [
        monzo_tx(1, now - timedelta(days=10), -100),
        monzo_tx(2, now - timedelta(days=200), -200),
    ]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        with pytest.raises(UpstreamError) as closed:
            await finance.collect(client, sessions, clock.now)
        status = await scalar(db_url, "SELECT status FROM finance.connection")
        clock.now += timedelta(seconds=90)
        again = await finance.collect(client, sessions, clock.now)

    assert closed.value.kind == "history_closed"
    assert status == "ok"  # the link is fine, the history beyond 90 days is just gone
    assert again["calls"] == 0  # the walk ended at the 90-day limit, nothing is retried
    assert await scalar(db_url, COUNT) == 1
    assert await account_field(db_url, "backfill_done") is True


async def test_accounts_are_presented_with_kind_label_pot_parent_goal_and_overdraft(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.accounts[0]["account_number"] = "12345678"
    fake.balance = {"balance": -74_782, "currency": "GBP", "overdraft_limit": 100_000}
    fake.pots[0]["goal_amount"] = 300_000
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as http, client_for(fake) as client:
        await consent(app, fake, clock)
        await drive(collector_for(app, clock), client, app.state.dashboards.sessions, clock, 1)
        accounts = (await http.get(f"{BASE}/accounts")).json()["accounts"]

    current = next(a for a in accounts if a["kind"] == "current")
    pot = next(a for a in accounts if a["kind"] == "pot")
    assert (current["label"], current["mask_last4"]) == ("Personal", "5678")
    assert (current["balance"], current["overdraft_limit"]) == (-74_782, 100_000)
    assert current["available_minor"] == 25_218  # what is left of the overdraft
    assert (pot["name"], pot["goal_amount"]) == ("Holiday", 300_000)
    assert pot["parent_id"] == current["id"]
    assert (current["parent_id"], current["goal_amount"]) == (None, None)
