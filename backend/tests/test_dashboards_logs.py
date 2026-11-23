"""Nothing a client sends, and no credential, ever reaches the log (at DEBUG, the loudest level)."""

import json
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from mcp import Client
from sqlalchemy.exc import SQLAlchemyError

from src.core.errors import AppError
from src.dashboards import service
from tests.collectors_support import json_response
from tests.dashboards_support import AUTH, CRED, running
from tests.finance_support import (
    MONO_KEY,
    FakeMonobank,
    forbidden,
    mono_account,
    mono_item,
    ts,
)
from tests.monzo_support import MZ_BASE, MZ_ID, MZ_KEY, FakeMonzo, monzo_tx, no_sleep

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
TITLE = "TITLE-SENTINEL-8841"
NOTES = "NOTES-SENTINEL-5520"
OTHER = "OTHER-SENTINEL-3917"
# Finance: none of these may ever reach a log line (the key is MONO_KEY). The amounts are long
# numbers so that no request id or timestamp can contain them by chance.
DESCRIPTION = "DESCRIPTION-SENTINEL-7714"
COUNTERPARTY = "COUNTERPARTY-SENTINEL-2086"
CARD_NUMBER = "537541******6173"
IBAN = "UA55SENTINEL3322001000002620999"
AMOUNT = 7351984
BALANCE = 9183746
# Monzo: the code and the pot's name are sentinels too; the tokens are "access-token-N" and
# "refresh-token-N" (FakeMonzo), the user id "user_00009sample".
CODE = "CODE-SENTINEL-6602"
POT_NAME = "POT-NAME-SENTINEL-4091"
FINANCE = "/api/dashboards/v1/finance"


def everything_logged(caplog, capsys):
    """Every record in every shape it can take: message, extra fields, traceback and the JSON
    line the stdout handler wrote."""
    parts = [caplog.text, capsys.readouterr().out]
    for record in caplog.records:
        parts.append(record.getMessage())
        parts.append(str(vars(record)))
    return "\n".join(parts)


async def test_titles_notes_and_tokens_stay_out_of_the_log(
    db_url, make_dashboards_app, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url, log_level="DEBUG", log_format="json")
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        created = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": TITLE, "notes": NOTES}
        )
        task_id = created.json()["id"]
        await client.patch(f"{BASE}/tasks/{task_id}", json={"title": OTHER, "notes": OTHER})
        await client.get(f"{BASE}/spaces/personal/tasks")
        await client.get(f"{BASE}/summary")
        rejected = await client.post(f"{BASE}/spaces/personal/tasks", json={"title": TITLE * 40})
        bad_area = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": TITLE, "area_id": OTHER}
        )
        wrong_token = await client.get(f"{BASE}/summary", headers={"X-Dashboards-Token": OTHER})
        await mcp.call_tool("add_task", {"space": "personal", "title": TITLE, "notes": NOTES})
        await mcp.call_tool("add_task", {"space": "personal", "title": TITLE, "area": OTHER})
        await mcp.call_tool("add_task", {"space": OTHER, "title": TITLE})
        await mcp.call_tool("update_task", {"id": task_id, "title": TITLE * 40})
        await mcp.call_tool("list_tasks", {"space": "personal", "status": OTHER})
        await client.delete(f"{BASE}/tasks/{task_id}")

    assert created.status_code == 201
    assert (rejected.status_code, bad_area.status_code, wrong_token.status_code) == (422, 422, 401)
    logged = everything_logged(caplog, capsys)
    assert "http.request" in logged  # the access lines are there: the check can see logs
    for secret in (TITLE, NOTES, OTHER, CRED):
        assert secret not in logged, secret


async def test_the_access_line_has_ids_and_status_only(db_url, make_dashboards_app, capsys):
    app = make_dashboards_app(db_url, log_format="json")
    async with running(app, AUTH) as client:
        created = await client.post(f"{BASE}/spaces/personal/tasks", json={"title": TITLE})
        capsys.readouterr()
        await client.get(f"{BASE}/spaces/personal/tasks", params={"status": "all"})

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line]
    (access,) = [line for line in lines if line.get("event") == "http.request"]
    assert created.status_code == 201
    assert access["path"] == f"{BASE}/spaces/personal/tasks"
    assert access["status"] == 200
    assert "status=all" not in json.dumps(access)  # no query string


class BrokenSession:
    def __init__(self, error):
        self.error = error

    async def scalars(self, *args, **kwargs):
        raise self.error


@pytest.mark.parametrize(
    "error",
    [
        SQLAlchemyError(f"statement failed [parameters: ('{TITLE}', '{NOTES}')]"),
        ConnectionRefusedError(f"connect to user {OTHER} failed"),
    ],
)
async def test_a_database_failure_is_503_and_only_its_class_is_logged(error, caplog):
    caplog.set_level(logging.DEBUG)

    with pytest.raises(AppError) as raised:
        await service.list_spaces(BrokenSession(error))

    assert (raised.value.status, raised.value.code) == (503, "dashboards_unavailable")
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "dashboards.db_error"]
    assert record.operation == "list_spaces"
    assert record.error == type(error).__name__
    assert record.exc_info is None
    logged = "\n".join([caplog.text, str(vars(record))])
    for secret in (TITLE, NOTES, OTHER):
        assert secret not in logged


async def test_other_errors_are_not_swallowed():
    with pytest.raises(KeyError):
        await service.list_spaces(BrokenSession(KeyError("a bug")))


async def test_an_unexpected_tool_failure_is_logged_by_class_only(
    db_url, make_dashboards_app, caplog, monkeypatch
):
    async def broken(*args, **kwargs):
        raise RuntimeError(f"a bug that mentions {TITLE}")

    monkeypatch.setattr(service, "list_tasks", broken)
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        result = await mcp.call_tool("list_tasks", {"space": "personal"})

    assert result.is_error
    assert "Internal error" in result.content[0].text
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "dashboards.tool_error"]
    assert (record.tool, record.error) == ("list_tasks", "RuntimeError")
    assert TITLE not in "\n".join([caplog.text, result.content[0].text, str(vars(record))])


async def test_bank_data_and_the_key_stay_out_of_the_log(
    db_url, make_dashboards_app, clock, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    leaking = f"{DESCRIPTION} {COUNTERPARTY} {CARD_NUMBER} {IBAN} {MONO_KEY} {AMOUNT}"
    fake = FakeMonobank(
        [mono_account(balance=BALANCE, pan=CARD_NUMBER, iban=IBAN)],
        {
            "acc-black-uah": [
                mono_item(
                    "tx-1",
                    ts(2026, 11, 20),
                    -AMOUNT,
                    DESCRIPTION,
                    counter=COUNTERPARTY,
                    balance=BALANCE,
                )
            ]
        },
    )
    app = make_dashboards_app(
        db_url,
        log_level="DEBUG",
        log_format="json",
        monobank_token=MONO_KEY,
        finance_backfill_months=6,
    )
    app.state.collector_transport = httpx.MockTransport(fake)
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        manager = app.state.finance_collectors
        await manager.ticked.wait()
        for failure in (None, json_response({"errorDescription": leaking}, 500), None, None):
            fake.failures = [failure]
            clock.now += timedelta(seconds=90)
            await manager.tick()  # the newest window, a failing one, the walk back
        fake.client_info_failures = [forbidden(), json_response({"errorDescription": leaking}, 429)]
        for _ in range(2):  # the key refused, then the rate limit
            clock.now += timedelta(minutes=21)
            await manager.tick()
        clock.now += timedelta(minutes=21)
        await manager.tick()
        await client.get("/api/dashboards/v1/finance/accounts")
        await client.get("/api/dashboards/v1/finance/transactions", params={"q": DESCRIPTION})
        await client.get("/api/dashboards/v1/finance/summary")
        await client.get("/api/dashboards/v1/finance/transactions", params={"cursor": leaking})
        await mcp.call_tool("finance_accounts", {})
        await mcp.call_tool("finance_balances", {})
        await mcp.call_tool("finance_transactions", {"query": DESCRIPTION, "min_amount": -AMOUNT})
        await mcp.call_tool("finance_transactions", {"account": leaking})
        await mcp.call_tool("finance_transactions", {"cursor": leaking})

    logged = everything_logged(caplog, capsys)
    events = {getattr(r, "event", "") for r in caplog.records}
    assert {"collector.synced", "collector.upstream_error", "finance.connection_status"} <= events
    assert "http.request" in logged  # the access lines are there: the check can see logs
    for secret in (DESCRIPTION, COUNTERPARTY, CARD_NUMBER, IBAN, MONO_KEY, str(AMOUNT)):
        assert secret not in logged, secret
    assert str(BALANCE) not in logged
    for record in caplog.records:
        if getattr(record, "collector", "") == "monobank":
            assert set(vars(record)) & {"amount", "description", "counterparty", "balance"} == set()


async def test_monzo_tokens_codes_and_bank_data_stay_out_of_the_log_and_the_answers(
    db_url, make_dashboards_app, clock, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    fake = FakeMonzo(clock)
    fake.code = CODE
    fake.pots[0]["name"] = POT_NAME
    fake.transactions = [
        monzo_tx(1, clock.now - timedelta(days=1), -AMOUNT, DESCRIPTION, merchant=COUNTERPARTY)
    ]
    app = make_dashboards_app(
        db_url,
        log_level="DEBUG",
        log_format="json",
        monzo_client_id=MZ_ID,
        monzo_client_secret=MZ_KEY,
        dashboards_public_base_url=MZ_BASE,
    )
    app.state.collector_transport = httpx.MockTransport(fake)
    app.state.finance_sleep = no_sleep
    answers = []
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        manager = app.state.finance_collectors
        await manager.ticked.wait()
        for attempt in (CODE + "-forged", CODE):  # a refused code first, then the real one
            redirect = await client.get(f"{FINANCE}/monzo/connect")
            state = parse_qs(urlsplit(redirect.headers["location"]).query)["state"][0]
            params = {"code": attempt, "state": state}
            callback = await client.get(f"{FINANCE}/monzo/callback", params=params)
            answers += [redirect.headers["location"], callback.headers["location"]]
        await client.get(f"{FINANCE}/monzo/callback", params={"code": CODE, "state": CODE})
        clock.now += timedelta(seconds=90)
        await manager.tick()  # the history, in the five minutes
        fake.fail_refresh = True
        clock.now += timedelta(hours=5, minutes=45)
        await manager.tick()  # the refresh is refused
        for path in ("accounts", "transactions", "summary"):
            answers.append((await client.get(f"{FINANCE}/{path}")).text)
        for tool in ("finance_accounts", "finance_balances", "finance_transactions"):
            answers.append((await mcp.call_tool(tool, {})).content[0].text)

    logged = everything_logged(caplog, capsys)
    events = {getattr(r, "event", "") for r in caplog.records}
    assert {"finance.monzo_consent", "finance.monzo_refused", "collector.synced"} <= events
    assert "http.request" in logged
    shown = "\n".join(answers)
    assert DESCRIPTION in shown  # the data is served to the owner: only the log must stay clean
    tokens = (CODE, MZ_KEY, "access-token-", "refresh-token-")
    unseen = ("NOTE-SENTINEL", "ADDRESS-SENTINEL")  # stored nowhere, so shown nowhere
    bank = (DESCRIPTION, COUNTERPARTY, POT_NAME, str(AMOUNT), "user_00009sample")
    for secret in tokens + unseen + bank:
        assert secret not in logged, secret
    for secret in tokens + unseen:
        assert secret not in shown, secret  # not in a redirect or an API answer either
