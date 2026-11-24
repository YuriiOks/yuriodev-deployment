"""The Linear collector against canned GraphQL answers (no network)."""

import json
from datetime import date

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError
from src.dashboards.collectors.base import MAX_PAGES
from src.dashboards.collectors.linear import LinearCollector
from tests.collectors_support import (
    client_for,
    graphql_body,
    issue,
    issues_page,
    json_response,
)

pytestmark = pytest.mark.anyio

KEY = SecretStr("lin-key-value-9082")


def collector():
    return LinearCollector(KEY, "work-1")


async def test_assigned_issues_become_items():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return issues_page([issue(1, "Do it", due="2026-12-24"), issue(2, "Later")])

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == ["issue-id-1", "issue-id-2"]
    assert [item.title for item in items] == ["ENG-1: Do it", "ENG-2: Later"]
    assert items[0].url == "https://linear.app/example-team/issue/ENG-1"
    assert items[0].due_date == date(2026, 12, 24)
    assert items[1].due_date is None
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == "https://api.linear.app/graphql"


async def test_the_key_is_sent_as_is_and_the_query_excludes_closed_states():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return issues_page([])

    async with client_for(handler) as client:
        await collector().fetch(client)

    request = seen[0]
    body = json.loads(request.content)
    assert request.headers["authorization"] == "lin-key-value-9082"
    assert body["variables"] == {"after": None}
    assert "assignedIssues" in body["query"]
    assert '"completed"' in body["query"]
    assert '"canceled"' in body["query"]
    assert '"duplicate"' in body["query"]
    assert "lin-key-value-9082" not in body["query"]


async def test_pages_are_followed_by_cursor():
    cursors = []

    def handler(request: httpx.Request) -> httpx.Response:
        after = json.loads(request.content)["variables"]["after"]
        cursors.append(after)
        if after is None:
            return issues_page([issue(1)], next_cursor="cursor-1")
        return issues_page([issue(2)])

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert cursors == [None, "cursor-1"]
    assert [item.external_id for item in items] == ["issue-id-1", "issue-id-2"]


async def test_more_pages_than_we_read_is_incomplete():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return issues_page([issue(len(calls))], next_cursor="more")

    async with client_for(handler) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == "incomplete"
    assert len(calls) == MAX_PAGES


@pytest.mark.parametrize(
    ("body", "kind"),
    [
        ({"errors": [{"message": "nope"}]}, "graphql"),
        ({"data": None, "errors": [{"message": "nope"}]}, "graphql"),
        ([], "graphql"),
        ({"data": {}}, "bad_json"),
        ({"data": {"viewer": {"assignedIssues": {"nodes": "x", "pageInfo": {}}}}}, "bad_json"),
        (graphql_body("x", False, None), "bad_json"),
        (graphql_body([], True, None), "bad_json"),
        (graphql_body(["not an issue"], False, None), "bad_json"),
        (graphql_body([{"id": "x"}], False, None), "bad_json"),
    ],
)
async def test_an_unexpected_answer_fails_the_fetch(body, kind):
    async with client_for(lambda request: json_response(body)) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == kind


async def test_a_bad_due_date_or_link_is_dropped_not_fatal():
    node = issue(3, "Odd\nones", due="not-a-date")
    node["url"] = "http://linear.example/insecure"

    async with client_for(lambda request: issues_page([node])) as client:
        (item,) = await collector().fetch(client)

    assert item.title == "ENG-3: Odd ones"
    assert item.due_date is None
    assert item.url is None


async def test_a_rate_limited_answer_is_an_upstream_error():
    headers = {"retry-after": "90"}

    async with client_for(lambda request: json_response({}, 429, headers)) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert (raised.value.kind, raised.value.status) == ("rate_limited", 429)
    assert raised.value.headers["retry-after"] == "90"


@pytest.mark.parametrize(
    ("state", "stage"),
    [
        ("started", "started"),
        ("unstarted", "unstarted"),
        ("backlog", "backlog"),
        ("triage", "triage"),
        ("completed", None),
        ("canceled", None),
        ("something-new", None),
    ],
)
async def test_the_stage_is_the_state_type_when_it_is_an_open_one(state, stage):
    async with client_for(lambda request: issues_page([issue(1, state=state)])) as client:
        (item,) = await collector().fetch(client)

    assert item.stage == stage


@pytest.mark.parametrize("state", [None, "started", {"name": "No type"}, {"type": 5}, []])
async def test_a_missing_or_odd_state_means_no_stage(state):
    node = issue(1)
    node["state"] = state

    async with client_for(lambda request: issues_page([node])) as client:
        (item,) = await collector().fetch(client)

    assert item.stage is None


async def test_the_query_asks_for_the_state_and_the_priority():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["query"])
        return issues_page([])

    async with client_for(handler) as client:
        await collector().fetch(client)

    assert "state { name type }" in seen[0]
    assert "priority" in seen[0]


@pytest.mark.parametrize(
    ("number", "label"),
    [(0, "none"), (1, "urgent"), (2, "high"), (3, "medium"), (4, "low")],
)
async def test_linears_priority_number_becomes_a_label(number, label):
    async with client_for(lambda request: issues_page([issue(1, priority=number)])) as client:
        (item,) = await collector().fetch(client)

    assert item.priority == label


@pytest.mark.parametrize("odd", [5, -1, True, "1", 1.5, None, []])
async def test_an_unknown_priority_is_no_priority_not_an_error(odd):
    async with client_for(lambda request: issues_page([issue(1, priority=odd)])) as client:
        (item,) = await collector().fetch(client)

    assert item.priority is None


async def test_the_update_time_is_asked_for_and_read():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["query"])
        rows = [issue(1, updated="2026-11-20T09:15:00.000Z"), issue(2, updated="soon")]
        return issues_page([*rows, issue(3, updated=None)])

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert "updatedAt" in seen[0]
    assert items[0].updated_at.isoformat() == "2026-11-20T09:15:00+00:00"
    assert items[1].updated_at is None
    assert items[2].updated_at is None
