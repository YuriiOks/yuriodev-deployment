"""The GitHub collector against canned search answers (no network)."""

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError
from src.dashboards.collectors.base import MAX_PAGES, PAGE_SIZE, pause_seconds
from src.dashboards.collectors.github import GitHubCollector
from tests.collectors_support import REPO, client_for, json_response, pr, search_page

pytestmark = pytest.mark.anyio

SECRET = SecretStr("gh-secret-value-4417")


def collector(scope=""):
    return GitHubCollector(SECRET, "work-1", scope)


def by_role(author_rows, review_rows, seen=None):
    """A handler answering the author search and the review-requested search differently."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        query = request.url.params["q"]
        rows = author_rows if "author:@me" in query else review_rows
        return search_page(rows)

    return handler


async def test_both_searches_become_items_with_role_titles():
    seen = []
    handler = by_role([pr(1, "Fix the thing")], [pr(2, "Add the other thing")], seen)

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == [f"{REPO}#1:author", f"{REPO}#2:review"]
    assert [item.title for item in items] == [
        "PR #1: Fix the thing",
        "Review PR #2: Add the other thing",
    ]
    assert [item.stage for item in items] == ["mine", "review"]
    assert items[0].url == f"https://github.com/{REPO}/pull/1"
    assert all(item.due_date is None for item in items)
    assert len(seen) == 2


async def test_the_queries_are_for_the_token_owner_and_carry_the_scope():
    seen = []

    async with client_for(by_role([], [], seen)) as client:
        await collector("org:example-org").fetch(client)

    queries = [request.url.params["q"] for request in seen]
    assert queries == [
        "is:pr is:open archived:false author:@me org:example-org",
        "is:pr is:open archived:false review-requested:@me org:example-org",
    ]
    for request in seen:
        assert request.url.path == "/search/issues"
        assert request.url.params["per_page"] == "100"
        assert request.headers["authorization"] == "Bearer gh-secret-value-4417"
        assert request.headers["x-github-api-version"] == "2022-11-28"
        assert "gh-secret-value-4417" not in str(request.url)


async def test_without_a_scope_the_query_has_no_trailing_space():
    seen = []

    async with client_for(by_role([], [], seen)) as client:
        await collector().fetch(client)

    assert seen[0].url.params["q"] == "is:pr is:open archived:false author:@me"


async def test_a_pull_request_in_both_roles_is_two_items():
    handler = by_role([pr(7)], [pr(7)])

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == [f"{REPO}#7:author", f"{REPO}#7:review"]


async def test_pages_are_followed_until_a_short_one():
    pages = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        if "author:@me" not in request.url.params["q"]:
            return search_page([])
        pages.append(page)
        count = PAGE_SIZE if page == 1 else 3
        rows = [pr(page * 1000 + n) for n in range(count)]
        return search_page(rows, total=PAGE_SIZE + 3)

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert pages == [1, 2]
    assert len(items) == PAGE_SIZE + 3


async def test_more_pages_than_we_read_is_incomplete():
    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        return search_page([pr(page * 1000 + n) for n in range(PAGE_SIZE)], total=1000)

    async with client_for(handler) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == "incomplete"
    assert MAX_PAGES == 10


@pytest.mark.parametrize(
    "answer",
    [
        search_page([pr(1)], incomplete=True),
        search_page([pr(1)], total=1001),
    ],
)
async def test_an_incomplete_search_fails_the_whole_fetch(answer):
    async with client_for(lambda request: answer) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == "incomplete"


@pytest.mark.parametrize(
    "body",
    [
        [],
        {"items": "nope"},
        {"total_count": 1},
        {"items": ["not a hit"]},
        {"items": [{"title": "no number", "repository_url": "https://api.github.com/repos/a/b"}]},
        {"items": [{"number": 1, "title": "t", "repository_url": 5}]},
        {"items": [{"number": 1, "title": "t", "repository_url": "https://api.github.com/x"}]},
        {"items": [{"number": 1, "title": "t", "repository_url": "https://x/repos/only-owner"}]},
    ],
)
async def test_an_unexpected_answer_fails_the_fetch(body):
    async with client_for(lambda request: json_response(body)) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == "bad_json"


async def test_titles_and_links_are_cleaned():
    row = pr(5, "Line one\nline two\x07")
    row["html_url"] = "http://github.example/insecure"
    long_row = pr(6, "x" * 1000)

    async with client_for(by_role([row, long_row], [])) as client:
        items = await collector().fetch(client)

    assert items[0].title == "PR #5: Line one line two"
    assert items[0].url is None
    assert len(items[1].title) == 300


async def test_a_rate_limit_answer_keeps_what_the_manager_needs():
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response({"message": "limit"}, 403, {"retry-after": "120"})

    async with client_for(handler) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.status == 403
    assert pause_seconds(raised.value, 0) == 120
    assert "gh-secret-value-4417" not in str(raised.value)


@pytest.mark.parametrize(("status", "kind"), [(401, "auth"), (404, "not_found"), (502, "http_5xx")])
async def test_failures_are_reduced_to_a_kind(status, kind):
    async with client_for(lambda request: json_response({}, status)) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == kind
    assert pause_seconds(raised.value, 0) is None
