"""The finance collector against a real Postgres and a faked bank: refresh, pacing, incremental
windows, the history walk, pages, failures and the link status."""

import logging
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from src.core.http import UpstreamError
from src.dashboards.collectors.manager import (
    FINANCE_LOCK_KEY,
    LOCK,
    CollectorManager,
    lock_statements,
)
from src.dashboards.db import to_async_url
from src.dashboards.finance.base import months_back
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import (
    FakeMonobank,
    client_for,
    collector,
    drive,
    forbidden,
    mono_account,
    mono_item,
    rate_limited,
    server_error,
    ts,
)

pytestmark = pytest.mark.anyio

BLACK = "acc-black-uah"
WHITE = "acc-white-eur"
COUNT = "SELECT count(*) FROM finance.transaction"


def two_accounts():
    return [
        mono_account(BLACK, balance=1_250_000, credit=500_000),
        mono_account(WHITE, currency=978, balance=33_300, kind="white", pan="537541******5678"),
    ]


def back(now, n):
    """A payment n * 10 days before `now`."""
    return mono_item(f"tx-{n}", int((now - timedelta(days=n * 10)).timestamp()), -100 * n)


AMOUNTS = (
    "SELECT string_agg(amount::text, ',' ORDER BY booked_at) FROM finance.transaction t "
    "JOIN finance.account a ON a.id = t.account_id WHERE a.external_id = 'ACCOUNT'"
)
BALANCE = "SELECT balance FROM finance.account WHERE external_id = 'ACCOUNT'"
ARCHIVED = "SELECT archived FROM finance.account WHERE external_id = 'ACCOUNT'"
SYNCED = "SELECT synced_until FROM finance.account WHERE external_id = 'ACCOUNT'"


async def one(db_url, statement, account=BLACK):
    return await scalar(db_url, statement.replace("ACCOUNT", account))


async def test_the_first_ticks_import_the_accounts_then_each_accounts_newest_window(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonobank(
        two_accounts(),
        {
            BLACK: [
                mono_item("tx-1", ts(2026, 11, 20), -45_000, "Corner Cafe"),
                mono_item("tx-2", ts(2026, 11, 10), 1_000_000, "Payroll Example Ltd", mcc=0),
                mono_item("tx-3", ts(2026, 11, 5), -80_000, currency=840, operation=-1_999),
            ],
            WHITE: [mono_item("tx-4", ts(2026, 11, 15), -2_500, "Acme Grocery", currency=978)],
        },
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        results = await drive(collector(0), client, app.state.dashboards.sessions, clock, 4)

    assert [r["calls"] for r in results] == [1, 1, 1, 0]
    assert results[0]["accounts"] == 2
    assert (results[1]["added"], results[2]["added"]) == (3, 1)
    assert [call[0] for call in fake.calls] == ["client-info", "statement", "statement"]
    assert [call[1] for call in fake.statement_calls()] == [BLACK, WHITE]
    assert await one(db_url, AMOUNTS) == "-80000,1000000,-45000"
    assert await one(db_url, AMOUNTS, WHITE) == "-2500"
    first = await scalar(
        db_url,
        "SELECT balance::text || ':' || credit_limit::text || ':' || currency || ':' || "
        "mask_last4 FROM finance.account WHERE external_id = 'acc-black-uah'",
    )
    foreign = await scalar(
        db_url,
        "SELECT original_amount::text || original_currency || ':' || category_code "
        "FROM finance.transaction WHERE external_id = 'tx-3'",
    )
    assert first == "1250000:500000:UAH:1234"
    assert foreign == "-1999USD:5812"
    assert await scalar(db_url, "SELECT status FROM finance.connection") == "ok"


async def test_never_two_requests_inside_the_providers_gap(db_url, make_dashboards_app, clock):
    fake = FakeMonobank(two_accounts(), {})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        results = await drive(
            collector(0), client, app.state.dashboards.sessions, clock, 8, timedelta(seconds=30)
        )

    # t = 0 call, 30 and 60 idle, 90 call (>= 61 s), 120 and 150 idle, 180 call, 210 idle.
    assert [r["calls"] for r in results] == [1, 0, 0, 1, 0, 0, 1, 0]
    assert len(fake.calls) == 3


async def test_balances_refresh_every_twenty_minutes_and_vanished_accounts_are_archived(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonobank(two_accounts(), {})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 4)
        infos = len([c for c in fake.calls if c[0] == "client-info"])
        clock.now += timedelta(minutes=10)
        quiet = await finance.collect(client, sessions, clock.now)
        fake.accounts = [mono_account(BLACK, balance=1_260_000)]  # the white one is gone
        clock.now += timedelta(minutes=10)
        refreshed = await finance.collect(client, sessions, clock.now)

    assert infos == 1
    assert quiet["calls"] == 0
    assert refreshed["accounts"] == 1
    assert await one(db_url, BALANCE) == 1_260_000
    assert await one(db_url, ARCHIVED, WHITE) is True
    assert await one(db_url, ARCHIVED) is False


async def test_an_incremental_window_starts_before_the_last_one_and_dedupes(
    db_url, make_dashboards_app, clock
):
    pending = mono_item("tx-1", ts(2026, 11, 21), -45_000, hold=True)
    old = mono_item("tx-2", ts(2026, 11, 10), -10_000)
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: [pending, old]})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 3)
        synced = await one(db_url, SYNCED)
        # The hold settles for another amount, and a new payment arrives.
        fake.statements[BLACK] = [
            mono_item("tx-1", ts(2026, 11, 21), -45_500, hold=False),
            mono_item("tx-5", ts(2026, 11, 22, 12, 3), -700),
            old,
        ]
        clock.now += timedelta(minutes=20)
        results = await drive(finance, client, sessions, clock, 3)

    incremental = fake.statement_calls()[-1]
    assert incremental[2] == int((synced - timedelta(days=3)).timestamp())
    assert [r["calls"] for r in results] == [1, 1, 0]
    assert (results[1]["added"], results[1]["updated"]) == (1, 1)  # tx-2 is outside the overlap
    assert await scalar(db_url, COUNT) == 3
    settled = await scalar(
        db_url,
        "SELECT amount::text || pending::text FROM finance.transaction WHERE external_id = 'tx-1'",
    )
    assert settled == "-45500false"


async def test_the_history_walk_goes_back_in_31_day_windows_to_the_configured_depth(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    items = [back(now, n) for n in range(1, 13)]
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: items})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        results = await drive(collector(3), client, sessions, clock, 12)

    windows = fake.statement_calls()
    assert len(windows) == 3  # the newest 31 days, the 31 before, and a last partial one
    for _, _, start, end in windows:
        assert end - start <= 2_682_000
    for newer, older in zip(windows, windows[1:], strict=False):
        assert older[3] == newer[2]  # each window ends where the one before it began
    depth = int(months_back(now, 3).timestamp())
    assert abs(windows[-1][2] - depth) < 3600  # the walk stops at the configured depth
    stored = await scalar(db_url, COUNT)
    expected = len([i for i in items if i["time"] >= windows[-1][2]])
    assert stored == expected
    assert stored < len(items)  # what is older than the depth is not fetched
    assert await scalar(db_url, "SELECT backfill_done FROM finance.account") is True
    assert results[-1]["calls"] == 0  # a finished walk is silent


async def test_a_failure_in_the_history_walk_changes_nothing_and_the_walk_resumes(
    db_url, make_dashboards_app, clock
):
    now = clock.now
    items = [back(now, n) for n in range(1, 19)]
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: items})
    fake.failures = [None, None, None, server_error()]  # the fourth statement request fails
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(6)
        await drive(finance, client, sessions, clock, 4)  # refresh, newest, two backward windows
        before = (
            await scalar(db_url, COUNT),
            await scalar(db_url, "SELECT backfilled_from::text FROM finance.account"),
        )
        with pytest.raises(UpstreamError) as raised:
            await finance.collect(client, sessions, clock.now)
        after = (
            await scalar(db_url, COUNT),
            await scalar(db_url, "SELECT backfilled_from::text FROM finance.account"),
        )
        clock.now += timedelta(seconds=90)
        await drive(finance, client, sessions, clock, 10)

    assert raised.value.kind == "http_5xx"
    assert after == before
    assert await scalar(db_url, "SELECT backfill_done FROM finance.account") is True
    last_start = fake.statement_calls()[-1][2]
    assert await scalar(db_url, COUNT) == len([i for i in items if i["time"] >= last_start])


async def test_a_full_page_continues_the_same_window_and_nothing_is_stored_until_it_is_whole(
    db_url, make_dashboards_app, clock
):
    base = ts(2026, 11, 22, 11)
    items = [mono_item(f"tx-{n}", base - n * 1000, -100) for n in range(1200)]
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: items})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 2)  # refresh, first page of 500
        first_page = await scalar(db_url, COUNT)
        await drive(finance, client, sessions, clock, 1)  # second page
        second_page = await scalar(db_url, COUNT)
        last = (await drive(finance, client, sessions, clock, 1))[0]

    calls = fake.statement_calls()
    assert len(calls) == 3
    assert calls[1][3] == base - 499 * 1000  # the next page starts at the oldest item seen
    assert (first_page, second_page) == (0, 0)
    assert last["windows"] == 1
    assert await scalar(db_url, COUNT) == 1200
    distinct = await scalar(db_url, "SELECT count(DISTINCT external_id) FROM finance.transaction")
    assert distinct == 1200


async def test_a_page_that_fails_halfway_through_a_window_stores_nothing_and_it_is_asked_again(
    db_url, make_dashboards_app, clock
):
    base = ts(2026, 11, 22, 11)
    items = [mono_item(f"tx-{n}", base - n * 1000, -100) for n in range(700)]
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: items})
    fake.failures = [None, server_error()]  # the second page of the first window fails
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 2)
        with pytest.raises(UpstreamError):
            await finance.collect(client, sessions, clock.now)
        clock.now += timedelta(seconds=90)
        during = await scalar(db_url, COUNT)
        await drive(finance, client, sessions, clock, 3)

    calls = fake.statement_calls()
    assert during == 0
    assert len(calls) == 4  # page one, the failed page two, then the window again: 500 + 200
    assert calls[2][3] >= calls[0][3]  # a fresh window, asked for from the start
    assert await scalar(db_url, COUNT) == 700


async def test_empty_windows_in_a_row_end_the_walk_before_the_configured_depth(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonobank([mono_account(BLACK)], {BLACK: [mono_item("tx-1", ts(2026, 11, 20), -1)]})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        results = await drive(collector(36), client, app.state.dashboards.sessions, clock, 12)

    assert len(fake.statement_calls()) == 4  # the newest window, then three empty ones
    assert await scalar(db_url, "SELECT backfill_done FROM finance.account") is True
    assert await scalar(db_url, "SELECT empty_streak FROM finance.account") == 3
    assert results[-1]["calls"] == 0


async def test_the_provider_refusing_the_key_marks_the_link_and_the_next_try_waits(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    fake = FakeMonobank([mono_account(BLACK)], {})
    fake.client_info_failures = [forbidden()]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        with pytest.raises(UpstreamError) as raised:
            await finance.collect(client, sessions, clock.now)
        status = await scalar(db_url, "SELECT status FROM finance.connection")
        error = await scalar(db_url, "SELECT last_error FROM finance.connection")
        clock.now += timedelta(minutes=5)
        waiting = await finance.collect(client, sessions, clock.now)
        clock.now += timedelta(minutes=16)
        recovered = await finance.collect(client, sessions, clock.now)

    assert raised.value.kind == "auth"
    assert (status, error) == ("needs_reconsent", "auth")
    assert waiting["calls"] == 0
    assert recovered["accounts"] == 1
    assert await scalar(db_url, "SELECT status FROM finance.connection") == "ok"
    assert await scalar(db_url, "SELECT last_error IS NULL FROM finance.connection") is True
    changes = [r for r in caplog.records if getattr(r, "event", "") == "finance.connection_status"]
    assert [r.status for r in changes] == ["needs_reconsent", "ok"]


async def test_a_paused_link_makes_no_request(db_url, make_dashboards_app, clock):
    fake = FakeMonobank([mono_account(BLACK)], {})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await finance.collect(client, sessions, clock.now)
        await execute(db_url, "UPDATE finance.connection SET status = 'paused'")
        clock.now += timedelta(hours=1)
        result = await finance.collect(client, sessions, clock.now)

    assert result["calls"] == 0
    assert len(fake.calls) == 1
    assert await scalar(db_url, "SELECT status FROM finance.connection") == "paused"


async def test_a_rate_limited_answer_pauses_the_collector_through_the_manager(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    fake = FakeMonobank([mono_account(BLACK)], {})
    fake.client_info_failures = [rate_limited()]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), client_for(fake) as client:
        manager = CollectorManager(
            app.state.dashboards,
            [collector(0)],
            client,
            clock,
            interval=1,
            lock_key=FINANCE_LOCK_KEY,
        )
        await manager.tick()
        clock.now += timedelta(seconds=30)
        await manager.tick()
        clock.now += timedelta(seconds=40)
        await manager.tick()

    events = [getattr(r, "event", "") for r in caplog.records]
    refusals = [r for r in caplog.records if getattr(r, "event", "") == "collector.upstream_error"]
    (limited,) = refusals
    assert (limited.collector, limited.kind, limited.status, limited.paused_s) == (
        "monobank",
        "rate_limited",
        429,
        60,
    )
    assert events.count("collector.paused") == 1
    assert len([c for c in fake.calls if c[0] == "client-info"]) == 2


async def test_the_finance_loop_takes_its_own_lock_and_idle_ticks_log_quietly(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    fake = FakeMonobank([mono_account(BLACK)], {})
    app = make_dashboards_app(db_url)
    engine = create_async_engine(to_async_url(db_url), poolclass=NullPool)
    async with running(app, AUTH), client_for(fake) as client:
        manager = CollectorManager(
            app.state.dashboards,
            [collector(0)],
            client,
            clock,
            interval=1,
            lock_key=FINANCE_LOCK_KEY,
        )
        async with engine.connect() as holder:
            assert (await holder.execute(LOCK)).scalar_one() is True  # the task loop's lock
            await manager.tick()
            clock.now += timedelta(seconds=90)
            await manager.tick()
            clock.now += timedelta(seconds=90)
            await manager.tick()  # nothing is due: no request
            finance_lock, _ = lock_statements(FINANCE_LOCK_KEY)
            assert (await holder.execute(finance_lock)).scalar_one() is True  # free again
    await engine.dispose()

    synced = [r for r in caplog.records if getattr(r, "event", "") == "collector.synced"]
    assert [(r.levelno, r.calls) for r in synced] == [
        (logging.INFO, 1),
        (logging.INFO, 1),
        (logging.DEBUG, 0),
    ]
    assert not [r for r in caplog.records if getattr(r, "event", "") == "collectors.skipped"]
