"""The Monzo consent flow behind the gate: connect, callback, single-use state, no secrets in any
URL, and the settings that switch it on."""

from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from tests.dashboards_support import AUTH, running, scalar
from tests.monzo_support import MZ_BASE, MZ_ID, MZ_REDIRECT, MZ_KEY, FakeMonzo, no_sleep

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance/monzo"
STATES = "SELECT count(*) FROM finance.monzo_oauth_state"
RAW_STATE = "SELECT count(*) FROM finance.monzo_oauth_state WHERE state_hash = 'STATE'"
TOKENS = "SELECT count(*) FROM finance.monzo_token"


def monzo_app(make_dashboards_app, db_url, fake):
    app = make_dashboards_app(
        db_url,
        monzo_client_id=MZ_ID,
        monzo_client_secret=MZ_KEY,
        dashboards_public_base_url=MZ_BASE,
    )
    app.state.collector_transport = httpx.MockTransport(fake)
    app.state.finance_sleep = no_sleep
    return app


async def connect(http):
    response = await http.get(f"{BASE}/connect")
    query = parse_qs(urlsplit(response.headers["location"]).query)
    return response, query["state"][0]


def where_to(response):
    return response.headers["location"]


async def test_connect_sends_the_owner_to_monzo_with_a_single_use_state(
    db_url, make_dashboards_app, clock
):
    app = monzo_app(make_dashboards_app, db_url, FakeMonzo(clock))
    async with running(app, AUTH) as http:
        await app.state.finance_collectors.ticked.wait()
        response, state = await connect(http)
        raw_rows = await scalar(db_url, RAW_STATE.replace("STATE", state))
        rows = await scalar(db_url, STATES)

    target = urlsplit(where_to(response))
    query = parse_qs(target.query)
    assert response.status_code == 303
    assert (target.scheme, target.netloc, target.path) == ("https", "auth.monzo.com", "/")
    assert query["client_id"] == [MZ_ID]
    assert query["redirect_uri"] == [MZ_REDIRECT]  # derived from the public base URL
    assert query["response_type"] == ["code"]
    assert len(state) >= 32
    assert MZ_KEY not in where_to(response)
    assert response.headers["cache-control"] == "no-store"
    assert (rows, raw_rows) == (1, 0)  # only a hash is kept, never the state itself


async def test_the_callback_exchanges_the_code_keeps_the_pair_and_goes_back_to_the_page(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    app = monzo_app(make_dashboards_app, db_url, fake)
    async with running(app, AUTH) as http:
        await app.state.finance_collectors.ticked.wait()
        _, state = await connect(http)
        response = await http.get(f"{BASE}/callback", params={"code": "code-1", "state": state})
        stored = await scalar(db_url, TOKENS)
        waiting = await scalar(db_url, "SELECT approved_at IS NULL FROM finance.monzo_token")
        status = await scalar(db_url, "SELECT status FROM finance.connection")

    assert response.status_code == 303
    assert where_to(response) == "/dashboards?monzo=connected"
    assert fake.exchange_calls == 1
    assert (stored, waiting, status) == (1, True, "ok")
    shown = str(response.headers) + response.text
    for private in ("code-1", fake.access, fake.refresh, MZ_KEY):
        assert private not in shown


async def test_a_state_works_once(db_url, make_dashboards_app, clock):
    fake = FakeMonzo(clock)
    app = monzo_app(make_dashboards_app, db_url, fake)
    async with running(app, AUTH) as http:
        await app.state.finance_collectors.ticked.wait()
        _, state = await connect(http)
        params = {"code": "code-1", "state": state}
        first = await http.get(f"{BASE}/callback", params=params)
        replay = await http.get(f"{BASE}/callback", params=params)

    assert where_to(first) == "/dashboards?monzo=connected"
    assert where_to(replay) == "/dashboards?monzo=invalid_state"
    assert fake.exchange_calls == 1  # the replayed code never went to Monzo


async def test_a_stale_missing_or_unknown_state_is_refused_before_anything_is_exchanged(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    app = monzo_app(make_dashboards_app, db_url, fake)
    async with running(app, AUTH) as http:
        await app.state.finance_collectors.ticked.wait()
        _, stale = await connect(http)
        clock.now += timedelta(minutes=11)
        late = await http.get(f"{BASE}/callback", params={"code": "code-1", "state": stale})
        none = await http.get(f"{BASE}/callback", params={"code": "code-1"})
        wrong = await http.get(f"{BASE}/callback", params={"code": "code-1", "state": "guess"})
        long = await http.get(f"{BASE}/callback", params={"code": "code-1", "state": "x" * 256})

    for response in (late, none, wrong, long):
        assert where_to(response) == "/dashboards?monzo=invalid_state"
    assert fake.exchange_calls == 0


async def test_a_denied_or_failed_consent_stores_nothing(db_url, make_dashboards_app, clock):
    fake = FakeMonzo(clock)
    app = monzo_app(make_dashboards_app, db_url, fake)
    async with running(app, AUTH) as http:
        await app.state.finance_collectors.ticked.wait()
        _, one = await connect(http)
        denied = await http.get(f"{BASE}/callback", params={"error": "access_denied", "state": one})
        _, two = await connect(http)
        no_code = await http.get(f"{BASE}/callback", params={"state": two})
        _, three = await connect(http)
        failed = await http.get(f"{BASE}/callback", params={"code": "forged", "state": three})
        stored = await scalar(db_url, TOKENS)

    assert where_to(denied) == "/dashboards?monzo=denied"
    assert where_to(no_code) == "/dashboards?monzo=denied"
    assert where_to(failed) == "/dashboards?monzo=failed"
    assert fake.exchange_calls == 1  # only the forged code went to Monzo, which refused it
    assert stored == 0


async def test_monzo_routes_need_the_gate_and_the_setup(db_url, make_dashboards_app, clock):
    app = monzo_app(make_dashboards_app, db_url, FakeMonzo(clock))
    plain = make_dashboards_app(db_url)
    async with running(app) as anonymous:
        no_token = [await anonymous.get(f"{BASE}/{leg}") for leg in ("connect", "callback")]
    async with running(plain, AUTH) as http:
        unset = [await http.get(f"{BASE}/{leg}") for leg in ("connect", "callback")]

    assert [r.status_code for r in no_token] == [401, 401]
    assert [r.status_code for r in unset] == [503, 503]
    assert {r.json()["error"] for r in unset} == {"monzo_not_configured"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://dev.example.test", "https://dev.example.test"),
        ("https://dev.example.test/", "https://dev.example.test"),
        ("  https://dev.example.test/  ", "https://dev.example.test"),
        ("http://localhost:8000", "http://localhost:8000"),
        ("http://example.test", None),  # an OAuth redirect over plain http: no
        ("https://example.test/path", None),
        ("https://user@example.test", None),
        ("https://example.test?x=1", None),
        ("ftp://example.test", None),
        ("https://", None),
        ("not a url", None),
        ("", None),
    ],
)
def test_the_public_base_url_is_an_https_origin_or_nothing(make_settings, raw, expected):
    assert make_settings(dashboards_public_base_url=raw).public_base_url == expected


def test_monzo_needs_the_database_both_client_values_and_a_good_base_url(make_settings):
    database = "postgresql://u:p@h/d"
    full = {
        "database_url": database,
        "monzo_client_id": MZ_ID,
        "monzo_client_secret": MZ_KEY,
        "dashboards_public_base_url": MZ_BASE,
    }

    assert make_settings(**full).monzo_enabled is True
    assert make_settings(**full).monzo_redirect_uri == MZ_REDIRECT
    assert make_settings(**full).finance_enabled is True
    for missing in ("database_url", "monzo_client_id", "monzo_client_secret"):
        assert make_settings(**{**full, missing: None}).monzo_enabled is False
    broken = make_settings(**{**full, "dashboards_public_base_url": "http://example.test"})
    assert broken.monzo_enabled is False
    assert broken.finance_enabled is False
    assert MZ_KEY not in repr(make_settings(**full))
    assert make_settings().monzo_client_id is None
