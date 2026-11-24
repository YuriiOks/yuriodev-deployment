"""Names of accounts and providers, reconnect hints and emoji in names. Invented data."""

import pytest

from src.dashboards.finance.monzo import parse_pots
from src.dashboards.finance.parsing import text
from tests.dashboards_support import AUTH, running
from tests.finance_support import seed

pytestmark = pytest.mark.anyio

FINANCE = "/api/dashboards/v1/finance"
FAMILY = "\U0001f468‍\U0001f469‍\U0001f467"  # a family: three people joined
ENGLAND = "\U0001f3f4" + "".join(chr(0xE0000 + ord(c)) for c in "gbeng") + "\U000e007f"


def test_emoji_sequences_keep_their_joiners_and_tags_but_other_format_characters_go():
    assert text(f"Trip {FAMILY}", 100) == f"Trip {FAMILY}"
    assert text(f"Away {ENGLAND}", 100) == f"Away {ENGLAND}"
    assert text("Heart ❤️", 100) == "Heart ❤️"
    assert text("a‮b​c\x07d", 100) == "abcd"  # bidi, zero-width space, control


def test_a_pot_with_a_name_is_not_generated_and_one_without_is():
    body = {
        "pots": [
            {"id": "pot_1", "name": f"Holiday {FAMILY}", "balance": 5, "currency": "GBP"},
            {"id": "pot_2", "balance": 7, "currency": "GBP"},
        ]
    }

    named, unnamed = parse_pots(body)

    assert (named.name, named.name_generated) == (f"Holiday {FAMILY}", False)
    assert (unnamed.name, unnamed.name_generated) == ("Pot GBP", True)


async def test_a_provider_with_no_name_has_none_and_the_api_banks_say_how_to_reconnect(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        found = (await client.get(f"{FINANCE}/providers")).json()["providers"]
        accounts = (await client.get(f"{FINANCE}/accounts")).json()["accounts"]

    by_id = {row["id"]: row for row in found}
    assert by_id["sample"]["name"] is None  # neither the owner's nor a built-in brand's
    assert by_id["monzo"]["name"] == "Monzo"
    assert (by_id["monzo"]["reconnect"], by_id["monzo"]["reconnect_path"]) == (
        "oauth",
        f"{FINANCE}/monzo/connect",
    )
    assert (by_id["monobank"]["reconnect"], by_id["monobank"]["reconnect_path"]) == ("token", None)
    assert by_id["barclays"]["reconnect"] is None
    assert {row["name_generated"] for row in accounts} == {False}
