"""The refusals a page words by code: the `issues` of a 422, the `reason` of a business refusal
and the `limits` of /bootstrap. Everything is invented."""

import ast
import pathlib
import uuid

import pytest

from src.core.refusals import REFUSALS, reason_for, value_rule
from tests.dashboards_support import AUTH, running

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
SRC = pathlib.Path(__file__).resolve().parent.parent / "src"
UNKNOWN = "00000000-0000-0000-0000-0000000000aa"


def issue_of(body, field):
    (found,) = [i for i in body["issues"] if i["field"] == field]
    return found


async def test_a_too_long_title_names_the_field_the_code_and_the_limit(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        limits = (await client.get(f"{BASE}/bootstrap")).json()["limits"]
        response = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": "x" * (limits["task"]["title"] + 1)}
        )

    body = response.json()
    assert response.status_code == 422
    assert body["error"] == "validation_error"
    assert body["fields"] == ["title"]
    assert issue_of(body, "title") == {
        "field": "title",
        "code": "too_long",
        "limit": limits["task"]["title"],
        "bound": None,
        "type": "string_too_long",
        "reason": "Too long",
    }


async def test_each_kind_of_validation_failure_has_its_own_code(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        missing = (await client.post(f"{BASE}/spaces/personal/tasks", json={})).json()
        extra = (
            await client.post(f"{BASE}/spaces/personal/tasks", json={"title": "a", "nope": 1})
        ).json()
        date = (
            await client.post(
                f"{BASE}/spaces/personal/tasks", json={"title": "a", "due_date": "tomorrow"}
            )
        ).json()
        wrong = (await client.post(f"{BASE}/spaces/personal/tasks", json={"title": 5})).json()
        status = (await client.get(f"{BASE}/spaces/personal/tasks", params={"status": "x"})).json()
        short = (await client.post(f"{BASE}/spaces/personal/tasks", json={"title": ""})).json()
        broken = await client.post(
            f"{BASE}/spaces/personal/tasks",
            content=b"{not json",
            headers={"content-type": "application/json"},
        )
        snooze = (
            await client.post(f"{BASE}/finance/attention/snooze", json={"key": "k", "days": 999})
        ).json()
        float_days = (
            await client.post(f"{BASE}/finance/attention/snooze", json={"key": "k", "days": "x"})
        ).json()

    assert issue_of(missing, "title")["code"] == "required"
    assert issue_of(extra, "nope")["code"] == "unknown_field"
    assert issue_of(date, "due_date")["code"] == "bad_format"
    assert issue_of(wrong, "title")["code"] == "wrong_type"
    assert issue_of(status, "status")["code"] == "unknown_value"
    assert issue_of(short, "title")["code"] == "too_short"
    assert issue_of(short, "title")["limit"] == 1
    assert issue_of(broken.json(), "body")["code"] == "bad_json"
    out = issue_of(snooze, "days")
    assert (out["code"], out["limit"], out["bound"]) == ("out_of_range", 90, "max")
    assert issue_of(float_days, "days")["code"] in ("not_a_number", "wrong_type")


async def test_a_rule_the_service_words_carries_a_field_and_a_reason(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        nothing = await client.patch(f"{BASE}/finance/transactions/{UNKNOWN}", json={})
        nothing_account = await client.patch(f"{BASE}/finance/accounts/{UNKNOWN}", json={})
        area = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": "a", "area_id": "no-such-area"}
        )
        order = await client.post(
            f"{BASE}/spaces/personal/events",
            json={
                "title": "e",
                "starts_at": "2026-11-22T10:00:00Z",
                "ends_at": "2026-11-22T09:00:00Z",
            },
        )

    assert nothing.json()["reason"] == nothing_account.json()["reason"] == "nothing_to_change"
    assert area.json()["reason"] == "unknown_value"
    assert issue_of(area.json(), "area_id")["code"] == "unknown_value"
    # A request model's own validator: the table names the field and the rule.
    assert order.status_code == 422
    assert order.json()["fields"] == ["ends_at"]
    assert issue_of(order.json(), "ends_at")["code"] == "ends_before_start"


async def test_a_missing_thing_says_which_thing(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        task = await client.patch(f"{BASE}/tasks/{uuid.uuid4()}", json={"title": "x"})
        payment = await client.get(f"{BASE}/finance/recurring/{uuid.uuid4()}")
        account = await client.patch(
            f"{BASE}/finance/accounts/{uuid.uuid4()}", json={"overdraft_limit": 0}
        )

    assert (task.status_code, task.json()["error"], task.json()["reason"]) == (
        404,
        "not_found",
        "task_not_found",
    )
    assert payment.json()["reason"] == "recurring_payment_not_found"
    assert account.json()["reason"] == "account_not_found"


async def test_a_conflict_says_which(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    body = {
        "name": "Gym",
        "amount": 1000,
        "currency": "GBP",
        "frequency": "monthly",
        "next_payment_date": "2026-12-01",
        "external_ref": "ref-1",
    }
    async with running(app, AUTH) as client:
        await client.post(f"{BASE}/finance/recurring", json=body)
        again = await client.post(f"{BASE}/finance/recurring", json=body)

    assert (again.status_code, again.json()["error"]) == (409, "conflict")
    assert again.json()["reason"] == "payment_reference_exists"


async def test_the_limits_are_the_ones_the_server_enforces(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        limits = (await client.get(f"{BASE}/bootstrap")).json()["limits"]
        name = await client.post(
            f"{BASE}/projects", json={"name": "p" * (limits["project"]["name"] + 1)}
        )
        ask = await client.post(
            f"{BASE}/assistant/ask",
            json={"scope": "personal", "question": "q" * (limits["assistant"]["question"] + 1)},
        )
        keys = await client.post(
            f"{BASE}/finance/attention/bulk",
            json={"keys": ["k"] * (limits["attention"]["bulk_keys"] + 1), "action": "dismiss"},
        )

    assert issue_of(name.json(), "name")["limit"] == limits["project"]["name"]
    assert issue_of(ask.json(), "question")["limit"] == limits["assistant"]["question"]
    assert issue_of(keys.json(), "keys")["limit"] == limits["attention"]["bulk_keys"]
    assert limits["statement"]["bytes"] == 1024 * 1024
    assert limits["icon"]["bytes"] == 256 * 1024
    assert all(isinstance(v, int) for group in limits.values() for v in group.values())


def test_every_sentence_a_service_raises_has_a_reason():
    used = set()
    for path in SRC.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", getattr(node.func, "attr", ""))
            if name in ("invalid", "_invalid") and node.args:
                last = node.args[-1]
            elif (
                name == "AppError"
                and len(node.args) == 3
                and isinstance(node.args[1], ast.Constant)
                and node.args[1].value in ("validation_error", "conflict")
            ):
                last = node.args[2]
            else:
                continue
            if isinstance(last, ast.Constant) and isinstance(last.value, str):
                used.add((path.name, last.value))
    sentences = {sentence for _, sentence in used}
    assert len(sentences) > 30
    assert sentences <= set(REFUSALS), sorted(sentences - set(REFUSALS))
    assert set(REFUSALS) - sentences == set()  # a stale row is as wrong as a missing one


def test_every_sentence_a_request_model_raises_has_a_rule():
    seen = set()
    for path in SRC.rglob("*.py"):
        if path.parts[-2] in ("feed", "core") or path.name in ("db.py", "projects.py"):
            continue  # settings and the feed are not request models of these routes
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Raise)
                and isinstance(node.exc, ast.Call)
                and getattr(node.exc.func, "id", "") == "ValueError"
                and node.exc.args
                and isinstance(node.exc.args[0], ast.Constant)
            ):
                seen.add(node.exc.args[0].value)
    assert len(seen) >= 10
    assert all(value_rule(sentence) is not None for sentence in seen), sorted(
        s for s in seen if value_rule(s) is None
    )


def test_the_reason_of_an_unknown_validation_sentence_is_invalid():
    assert reason_for("validation_error", "something new") == (None, "invalid")
    assert reason_for("not_found", "Task not found") == (None, "task_not_found")
    assert reason_for("not_found", "Not found") == (None, None)
    assert reason_for("conflict", "something new") == (None, None)
    assert reason_for("project_exists", "A project with this id exists") == (None, None)
