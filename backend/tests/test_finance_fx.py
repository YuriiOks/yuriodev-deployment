"""Exchange rates: the source, the arithmetic, the rounding, and what the API shows with them."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from mcp import Client
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from src.core.http import UpstreamError
from src.dashboards.collectors.manager import build_finance_collectors
from src.dashboards.finance.fx import (
    MAX_AGE,
    PLACES,
    FxCollector,
    Leg,
    RateBook,
    convert_with,
    exponent,
    pair_rate,
    parse_rates,
)
from src.dashboards.finance.models import FxRate
from tests.collectors_support import json_response
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import NOW, money, rate_row, seed, seed_rates

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"
D = Decimal


def book(**per_unit):
    legs = {name: Leg(D(rate), NOW, "monobank") for name, rate in per_unit.items()}
    return RateBook(legs, NOW)


@pytest.mark.parametrize(
    ("amount", "rate", "expected"),
    [
        (5, "0.5", 2),  # 2.5 goes to the even neighbour
        (7, "0.5", 4),  # 3.5 too
        (-5, "0.5", -2),  # and symmetrically for money out
        (-7, "0.5", -4),
        (3, "0.5", 2),  # 1.5
        (1, "0.4", 0),
        (1, "0.6", 1),
        (0, "123.456", 0),
        (100, "1", 100),
    ],
)
def test_one_rounding_half_even_on_the_minor_unit(amount, rate, expected):
    assert convert_with(amount, D(rate), "EUR", "GBP") == expected


@pytest.mark.parametrize(
    ("amount", "source", "target", "rate", "expected"),
    [
        (1_000, "JPY", "GBP", "0.005", 500),  # 1 000 yen (no minor unit) is 5.00 pounds
        (12_345, "GBP", "JPY", "190", 23_456),  # 123.45 pounds: 23 455.5 yen goes to the even one
        (1_000, "KWD", "GBP", "2.5", 250),  # 1.000 dinar (three decimals) is 2.50 pounds
        (250, "GBP", "KWD", "0.4", 1_000),  # 2.50 pounds is 1.000 dinar
    ],
)
def test_currencies_with_other_minor_units_are_shifted_first(
    amount, source, target, rate, expected
):
    assert convert_with(amount, D(rate), source, target) == expected


def test_the_minor_units_of_the_currencies_we_may_meet():
    assert [exponent(c) for c in ("GBP", "UAH", "USD", "JPY", "KWD", "XXX")] == [2, 2, 2, 0, 3, 2]


def test_a_pair_goes_through_hryvnia_and_carries_the_older_time():
    older = NOW - timedelta(hours=5)
    rates = RateBook(
        {"GBP": Leg(D("50"), NOW, "monobank"), "USD": Leg(D("40"), older, "monobank")}, NOW
    )

    to_pounds = rates.rate("USD", "GBP")
    from_hryvnia = rates.rate("UAH", "GBP")
    to_hryvnia = rates.rate("GBP", "UAH")

    assert (to_pounds.rate, to_pounds.as_of) == (D("0.8"), older)
    assert from_hryvnia.rate == D("0.02")
    assert to_hryvnia.rate == D("50")
    assert rates.convert(12_345, "USD", "GBP") == 9_876  # 98.76 pounds
    assert rates.convert(7, "GBP", "GBP") == 7
    assert rates.rate("GBP", "GBP").as_of is None  # the same currency needs no rate


def test_a_rate_is_kept_to_twelve_places_and_used_as_it_is_shown():
    rates = book(GBP="60.0016", USD="45.4054")

    shown = rates.rate("USD", "GBP")

    assert shown.rate == (D("45.4054") / D("60.0016")).quantize(PLACES)
    assert rates.convert(100_000, "USD", "GBP") == convert_with(100_000, shown.rate, "USD", "GBP")


def test_no_rate_or_a_stale_one_is_no_conversion_never_a_guess():
    rates = RateBook(
        {
            "GBP": Leg(D("50"), NOW, "monobank"),
            "USD": Leg(D("40"), NOW - MAX_AGE, "monobank"),  # exactly three days: still good
            "EUR": Leg(D("43"), NOW - MAX_AGE - timedelta(seconds=1), "monobank"),
        },
        NOW,
    )

    assert rates.rate("USD", "GBP") is not None
    assert rates.rate("EUR", "GBP") is None
    assert rates.convert(100, "EUR", "GBP") is None
    assert rates.convert(100, "PLN", "GBP") is None  # a currency the source never gave
    assert rates.convert(100, "GBP", "PLN") is None
    assert rates.convert(100, "UAH", "UAH") == 100  # nothing to look up


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ({"rateCross": 60.0016}, "60.0016"),
        ({"rateCross": 60.0016, "rateBuy": 1.0, "rateSell": 2.0}, "60.0016"),  # a cross wins
        ({"rateBuy": 45.18, "rateSell": 45.6308}, "45.4054"),  # else the mid of the two
        ({"rateBuy": 40, "rateSell": 41}, "40.5"),
        ({"rateBuy": 45.18}, None),  # one side is never used alone
        ({"rateSell": 45.18}, None),
        ({}, None),
        ({"rateCross": 0}, None),
        ({"rateCross": -1.5}, None),
        ({"rateCross": True}, None),
        ({"rateCross": "60"}, None),
        ({"rateCross": float("inf")}, None),
        ({"rateBuy": 1, "rateSell": -1}, None),
    ],
)
def test_the_rate_of_a_pair_is_its_cross_else_the_mid_never_a_side(row, expected):
    found = pair_rate(row)

    assert (None if found is None else format(found.normalize(), "f")) == expected


def test_only_hryvnia_pairs_with_a_known_code_and_a_sane_time_are_taken():
    answer = [
        rate_row(840, rateBuy=45.18, rateSell=45.6308),
        rate_row(826, rateCross=60.0016),
        {"currencyCodeA": 978, "currencyCodeB": 840, "date": 1, "rateBuy": 1.09, "rateSell": 1.1},
        rate_row(12345, rateCross=1.0),  # a code we have no letters for
        rate_row(980, rateCross=1.0),  # hryvnia against itself
        {**rate_row(985, rateCross=11.2), "date": 0},
        {**rate_row(756, rateCross=54.5), "date": "yesterday"},
        rate_row(203),  # no rate at all
        "not a row",
    ]

    found = parse_rates(answer)

    assert {name: format(rate.normalize(), "f") for name, (rate, _) in found.items()} == {
        "USD": "45.4054",
        "GBP": "60.0016",
    }
    assert found["GBP"][1] == datetime.fromtimestamp(1_795_508_173, UTC)


@pytest.mark.parametrize("body", [{}, "x", None, 5])
def test_an_answer_that_is_not_a_list_is_refused(body):
    with pytest.raises(UpstreamError) as raised:
        parse_rates(body)

    assert raised.value.kind == "bad_json"


async def test_the_collector_stores_exact_rates_and_asks_at_most_every_thirty_minutes(
    db_url, make_dashboards_app, clock
):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.url.path == "/bank/currency"
        assert "x-token" not in request.headers  # a public endpoint: no key goes with it
        return json_response(
            [rate_row(840, rateBuy=45.18, rateSell=45.6308), rate_row(826, rateCross=60.0016)]
        )

    app = make_dashboards_app(db_url)
    async with running(app, AUTH), httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        sessions = app.state.dashboards.sessions
        fx = FxCollector()
        first = await fx.collect(c, sessions, clock.now)
        quiet = await fx.collect(c, sessions, clock.now + timedelta(minutes=29))
        later = await fx.collect(c, sessions, clock.now + timedelta(minutes=31))
        stored = await scalar(
            db_url,
            "SELECT string_agg(base || '=' || rate::text, ',' ORDER BY base) FROM finance.fx_rate",
        )
        source = await scalar(db_url, "SELECT DISTINCT source FROM finance.fx_rate")

    assert (first, quiet, later) == (
        {"calls": 1, "rates": 2},
        {"calls": 0, "rates": 0},
        {"calls": 1, "rates": 2},
    )
    assert len(calls) == 2
    assert stored == "GBP=60.001600000000,USD=45.405400000000"
    assert source == "monobank"


async def test_a_failed_refresh_changes_nothing_and_is_tried_again_in_five_minutes(
    db_url, make_dashboards_app, clock
):
    answers = [json_response({}, 502), json_response([rate_row(826, rateCross=50.0)])]
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: answers.pop(0))
    ) as c:
        sessions = app.state.dashboards.sessions
        fx = FxCollector()
        with pytest.raises(UpstreamError):
            await fx.collect(c, sessions, clock.now)
        none = await scalar(db_url, "SELECT count(*) FROM finance.fx_rate")
        waiting = await fx.collect(c, sessions, clock.now + timedelta(minutes=4))
        again = await fx.collect(c, sessions, clock.now + timedelta(minutes=6))

    assert none == 0
    assert waiting["calls"] == 0
    assert again == {"calls": 1, "rates": 1}


async def test_accounts_show_the_latest_rate_beside_the_original(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        response = await client.get(f"{BASE}/accounts")

    body = response.json()
    by_name = {a["name"]: a for a in body["accounts"]}
    main, euro, old = by_name["Main"], by_name["Euro"], by_name["Old"]
    assert (main["balance"], main["display_balance_minor"]) == (1_250_000, 25_000)
    assert main["display_own_balance_minor"] == 15_000  # 7 500.00 hryvnia is 150.00 pounds
    assert main["display_available_minor"] == 25_000
    assert main["converted"] is True
    assert (euro["balance"], euro["display_balance_minor"]) == (33_300, 29_138)  # 29 137.5: even
    assert old["display_balance_minor"] == 20  # 19.98 pence
    assert body["display"] == {
        "currency": "GBP",
        "rates": {
            "EUR": {"rate": "0.875", "as_of": "2026-11-22T12:00:00Z", "source": "monobank"},
            "UAH": {"rate": "0.02", "as_of": "2026-11-22T12:00:00Z", "source": "monobank"},
        },
        "missing": [],
    }


async def test_a_currency_without_a_usable_rate_keeps_its_original_and_is_named(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        # No euro at all, and the pound three days and a second old: both unusable.
        await seed_rates(app, EUR=None, GBP=None)
        await seed_rates_gbp_stale(app)
        response = await client.get(f"{BASE}/accounts")

    body = response.json()
    by_name = {a["name"]: a for a in body["accounts"]}
    assert (by_name["Euro"]["balance"], by_name["Euro"]["display_balance_minor"]) == (33_300, None)
    assert by_name["Main"]["display_balance_minor"] is None  # hryvnia needs the pound's rate
    assert body["display"]["missing"] == ["EUR", "UAH"]
    assert body["display"]["rates"] == {}


async def seed_rates_gbp_stale(app):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add(
            FxRate(
                base="GBP",
                quote="UAH",
                rate=D("50"),
                as_of=NOW - MAX_AGE - timedelta(seconds=1),
                source="monobank",
                fetched_at=NOW,
            )
        )


async def test_the_display_currency_is_a_setting_and_the_same_currency_is_not_converted(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url, finance_display_currency="UAH")
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        response = await client.get(f"{BASE}/accounts")

    by_name = {a["name"]: a for a in response.json()["accounts"]}
    assert (by_name["Main"]["display_balance_minor"], by_name["Main"]["converted"]) == (
        1_250_000,
        False,
    )
    assert (by_name["Euro"]["display_balance_minor"], by_name["Euro"]["converted"]) == (
        1_456_875,  # 333.00 euro at 43.75 hryvnia
        True,
    )
    assert set(response.json()["display"]["rates"]) == {"EUR"}


async def test_the_summary_has_a_grand_total_made_of_the_converted_parts(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        response = await client.get(f"{BASE}/summary")

    body = response.json()
    eur, uah = body["currencies"]
    assert (uah["display_balance"], uah["display_own_balance"]) == (25_000, 15_000)
    assert (uah["display_spent"], uah["display_received"]) == (1_150, 20_000)
    assert (eur["display_balance"], eur["display_spent"], eur["display_received"]) == (
        29_138,
        2_188,  # 2 187.5, half-even
        8_750,
    )
    assert (eur["converted"], uah["converted"]) == (True, True)
    total = body["display"]
    assert (total["currency"], total["complete"], total["missing"]) == ("GBP", True, [])
    assert (total["balance"], total["own_balance"]) == (25_000 + 29_138, 15_000 + 29_138)
    assert (total["spent"], total["received"]) == (1_150 + 2_188, 20_000 + 8_750)


async def test_a_grand_total_says_when_a_currency_was_left_out(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app, EUR=None)
        response = await client.get(f"{BASE}/summary")

    body = response.json()
    eur, uah = body["currencies"]
    assert (eur["display_balance"], eur["balance"]) == (None, 33_300)
    assert uah["display_balance"] == 25_000
    assert body["display"]["complete"] is False
    assert body["display"]["missing"] == ["EUR"]
    assert body["display"]["balance"] == 25_000  # only what could be converted


async def test_without_any_rate_everything_is_original_only(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        summary = await client.get(f"{BASE}/summary")
        categories = await client.get(f"{BASE}/categories")
        transactions = await client.get(f"{BASE}/transactions")

    assert summary.json()["display"]["complete"] is False
    assert summary.json()["display"]["balance"] == 0
    assert categories.json()["display"]["categories"] == []
    assert {t["display_amount_minor"] for t in transactions.json()["transactions"]} == {None}
    assert money(summary.json())["currencies"][0]["balance"] == 33_300  # the originals are there


async def test_categories_are_also_shown_in_the_display_currency(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        response = await client.get(f"{BASE}/categories")

    body = response.json()
    eur, uah = body["currencies"]
    assert (uah["display_spent"], uah["display_previous_spent"]) == (1_150, 140)
    assert {c["category"]: (c["spent"], c["display_spent"]) for c in uah["categories"]} == {
        "eating_out": (45_000, 900),
        "groceries": (12_000, 240),
        "subscriptions": (500, 10),
        "shopping": (0, 0),
    }
    assert (eur["display_spent"], eur["categories"][0]["display_spent"]) == (2_188, 2_188)
    shown = body["display"]
    assert shown["complete"] is True
    assert [(c["category"], c["spent"], c["previous"]) for c in shown["categories"]] == [
        ("groceries", 240 + 2_188, 0),  # the two currencies' lines, added
        ("eating_out", 900, 0),
        ("subscriptions", 10, 0),
        ("shopping", 0, 140),
    ]
    assert (shown["spent"], shown["previous_spent"]) == (2_428 + 900 + 10, 140)  # they add up


async def test_transactions_are_converted_at_the_current_rate_each_rounded_once(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        response = await client.get(f"{BASE}/transactions")
        patched = await client.patch(
            f"{BASE}/transactions/{uuid.UUID(int=1006)}", json={"category": "health"}
        )

    body = response.json()
    by_name = {t["description"]: t for t in body["transactions"]}
    assert (by_name["Corner Cafe"]["amount"], by_name["Corner Cafe"]["display_amount_minor"]) == (
        -45_000,
        -900,
    )
    assert by_name["Acme Grocery"]["display_amount_minor"] == -2_188  # -2 187.5, half-even
    assert by_name["Refund"]["display_amount_minor"] == 8_750
    assert {t["converted"] for t in body["transactions"]} == {True}
    assert set(body["display"]["rates"]) == {"EUR", "UAH"}
    assert patched.json()["display_amount_minor"] == -2_188


async def test_the_tools_carry_the_converted_figures_too(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        await seed_rates(app)
        accounts = await mcp.call_tool("finance_accounts", {})
        balances = await mcp.call_tool("finance_balances", {})
        found = await mcp.call_tool("finance_transactions", {})
        report = await mcp.call_tool("finance_categories", {})

    assert json.loads(accounts.content[0].text)["display"]["currency"] == "GBP"
    assert '"display_balance_minor":25000' in accounts.content[0].text
    assert json.loads(balances.content[0].text)["display"]["balance"] == 54_138
    assert '"display_amount_minor":-900' in found.content[0].text
    assert json.loads(report.content[0].text)["display"]["spent"] == 3_338


def test_the_display_currency_setting_is_three_capital_letters(make_settings):
    assert make_settings().finance_display_currency == "GBP"
    assert make_settings(finance_display_currency="EUR").finance_display_currency == "EUR"
    for bad in ("gbp", "GB", "GBPX", "12A"):
        with pytest.raises(ValidationError):
            make_settings(finance_display_currency=bad)


async def test_the_rates_table_enforces_its_rules(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        await seed_rates(app)
        for statement in (
            "UPDATE finance.fx_rate SET rate = 0",
            "UPDATE finance.fx_rate SET rate = -1",
            "UPDATE finance.fx_rate SET base = 'gbp' WHERE base = 'GBP'",
        ):
            with pytest.raises(IntegrityError):
                await execute(db_url, statement)


def test_the_rates_collector_exists_only_next_to_a_bank_collector(make_settings):
    key = "k-value"
    with_bank = make_settings(database_url="postgresql://u:p@h/d", monobank_token=key)
    without = make_settings(database_url="postgresql://u:p@h/d")

    assert [c.name for c in build_finance_collectors(with_bank)] == ["monobank", "fx"]
    assert build_finance_collectors(without) == []  # nothing to convert: no outbound call
