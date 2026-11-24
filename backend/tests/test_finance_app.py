"""The finance collector in the running app: off without a token, wired end to end with one."""

import asyncio

import httpx
import pytest
from pydantic import ValidationError

from tests.dashboards_support import AUTH, running
from tests.finance_support import (
    MONO_KEY,
    FakeMonobank,
    mono_account,
    mono_item,
    ts,
)

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"


async def test_without_a_token_there_is_no_collector_and_no_outbound_call(
    db_url, make_dashboards_app
):
    seen: list[httpx.Request] = []

    def refuse(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(500)

    app = make_dashboards_app(db_url, github_token=None, linear_api_key=None)
    app.state.collector_transport = httpx.MockTransport(refuse)
    async with running(app, AUTH) as client:
        await asyncio.sleep(0.2)
        accounts = await client.get(f"{BASE}/accounts")

    assert app.state.finance_collectors is None
    assert app.state.collectors is None
    assert seen == []
    assert (accounts.json()["accounts"], accounts.json()["connections"]) == ([], [])


async def test_a_token_starts_the_collector_and_the_first_tick_lists_the_accounts(
    db_url, make_dashboards_app
):
    fake = FakeMonobank(
        [mono_account("acc-black-uah", balance=1_250_000)],
        {"acc-black-uah": [mono_item("tx-1", ts(2026, 11, 20), -45_000)]},
    )
    app = make_dashboards_app(db_url, monobank_token=MONO_KEY)
    app.state.collector_transport = httpx.MockTransport(fake)
    async with running(app, AUTH) as client:
        manager = app.state.finance_collectors
        await asyncio.wait_for(manager.ticked.wait(), timeout=30)
        accounts = await client.get(f"{BASE}/accounts")

    assert manager.describe() == ["monobank", "fx", "icons"]  # they come with a bank
    assert app.state.collectors is None  # the task collectors have no credential
    assert fake.calls == [("client-info",)]
    (account,) = accounts.json()["accounts"]
    assert (account["name"], account["balance"], account["mask_last4"]) == (
        "Black card UAH",
        1_250_000,
        "1234",
    )
    assert accounts.json()["connections"][0]["status"] == "ok"


def test_the_finance_settings_have_safe_defaults_and_sensible_caps(make_settings):
    settings = make_settings()

    assert settings.monobank_token is None
    assert settings.finance_backfill_months == 12
    assert settings.finance_poll_interval_seconds == 90
    assert settings.finance_enabled is False
    assert make_settings(finance_backfill_months=0).finance_backfill_months == 0
    assert make_settings(finance_backfill_months=36).finance_backfill_months == 36
    for bad in (-1, 37):
        with pytest.raises(ValidationError):
            make_settings(finance_backfill_months=bad)
    for bad in (59, 3601):
        with pytest.raises(ValidationError):
            make_settings(finance_poll_interval_seconds=bad)


def test_the_token_is_a_secret_that_needs_the_database(make_settings):
    padded = f" {MONO_KEY}\n"  # a pasted value often carries a trailing newline
    blank = "  "
    only_token = make_settings(monobank_token=padded)
    both = make_settings(monobank_token=padded, database_url="postgresql://u:p@h/d")

    assert only_token.finance_enabled is False  # no DATABASE_URL: the whole API is off
    assert both.finance_enabled is True
    assert both.monobank_token.get_secret_value() == MONO_KEY
    assert MONO_KEY not in repr(both)
    assert make_settings(monobank_token=blank).monobank_token is None
