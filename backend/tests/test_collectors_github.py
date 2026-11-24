"""The GitHub collector against canned answers (no network)."""

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError
from src.dashboards.collectors.base import MAX_PAGES, PAGE_SIZE, pause_seconds
from src.dashboards.collectors.github import MAX_TEAMS, GitHubCollector
from tests.collectors_support import (
    REPO,
    client_for,
    github_handler,
    json_response,
    pr,
    search_page,
    searches,
    team,
)

pytestmark = pytest.mark.anyio

SECRET = SecretStr("gh-secret-value-4417")


def collector(scope=""):
    return GitHubCollector(SECRET, "work-1", scope)


def only_searches(handler):
    """Wrap a handler so the `/user/teams` call is answered with no teams."""

    def wrapper(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/teams":
            return json_response([])
        return handler(request)

    return wrapper


async def test_the_searches_become_items_with_role_titles_and_stages():
    seen = []
    handler = github_handler(
        author=[pr(1, "Fix the thing")],
        review=[pr(2, "Add the other thing")],
        reviewed=[pr(3, "Tidy up")],
        seen=seen,
    )

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == [
        f"{REPO}#1:author",
        f"{REPO}#2:review",
        f"{REPO}#3:reviewed",
    ]
    assert [item.title for item in items] == [
        "PR #1: Fix the thing",
        "Review PR #2: Add the other thing",
        "Reviewed PR #3: Tidy up",
    ]
    assert [item.stage for item in items] == ["mine", "review", "reviewed"]
    assert items[0].url == f"https://github.com/{REPO}/pull/1"
    assert all(item.due_date is None and item.priority is None for item in items)
    assert len(searches(seen)) == 3  # the reviewed list costs one query


async def test_the_queries_are_for_the_token_owner_and_carry_the_scope():
    seen = []

    async with client_for(github_handler(seen=seen)) as client:
        await collector("org:example-org").fetch(client)

    assert searches(seen) == [
        "is:pr is:open archived:false author:@me org:example-org",
        "is:pr is:open archived:false review-requested:@me org:example-org",
        "is:pr is:open archived:false reviewed-by:@me -author:@me -review-requested:@me "
        "org:example-org",
    ]
    for request in seen:
        assert request.url.host == "api.github.com"
        assert request.headers["authorization"] == "Bearer gh-secret-value-4417"
        assert request.headers["x-github-api-version"] == "2022-11-28"
        assert "gh-secret-value-4417" not in str(request.url)
    assert {r.url.path for r in seen} == {"/user/teams", "/search/issues"}


async def test_without_a_scope_the_query_has_no_trailing_space():
    seen = []

    async with client_for(github_handler(seen=seen)) as client:
        await collector().fetch(client)

    assert searches(seen)[0] == "is:pr is:open archived:false author:@me"


async def test_a_pull_request_in_two_roles_is_two_items():
    handler = github_handler(author=[pr(7)], review=[pr(7)])

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == [f"{REPO}#7:author", f"{REPO}#7:review"]


async def test_review_requests_to_the_owners_teams_are_asked_for_too():
    seen = []
    handler = github_handler(
        review=[pr(1)],
        teams=[team("platform"), team("security")],
        team_rows={
            "example-org/platform": [pr(1), pr(2, "Team only")],
            "example-org/security": [pr(3, "Another team")],
        },
        seen=seen,
    )

    async with client_for(handler) as client:
        items = await collector("org:example-org").fetch(client)

    ids = [item.external_id for item in items]
    assert ids == [f"{REPO}#1:review", f"{REPO}#2:review", f"{REPO}#3:review"]  # #1 once
    assert {item.stage for item in items} == {"review"}
    assert items[1].title == "Review PR #2: Team only"
    assert (
        "is:pr is:open archived:false team-review-requested:example-org/platform org:example-org"
        in searches(seen)
    )
    assert sum("team-review-requested:" in q for q in searches(seen)) == 2


async def test_only_the_teams_of_the_scopes_organisations_are_searched_and_ten_at_most():
    seen = []
    many = [team(f"team-{n}") for n in range(15)]
    handler = github_handler(teams=[team("elsewhere", "other-org"), *many], seen=seen)

    async with client_for(handler) as client:
        await collector("org:example-org").fetch(client)
        wide = len(searches(seen))
        seen.clear()
        await collector().fetch(client)  # no organisation named: any team, still ten

    team_queries = [q for q in searches(seen) if "team-review-requested:" in q]
    assert wide == 3 + MAX_TEAMS  # author, review, reviewed and ten teams of example-org
    assert len(team_queries) == MAX_TEAMS
    assert any("other-org/elsewhere" in q for q in team_queries)  # no organisation named: any


async def test_a_malformed_team_is_skipped():
    teams = [{"slug": "x"}, {"organization": {"login": "o"}}, "text", 5, None]
    teams += [team("bad slug"), team("ok-team", "bad org!"), team("fine", "example-org")]
    seen = []

    async with client_for(github_handler(teams=teams, seen=seen)) as client:
        await collector().fetch(client)

    queries = [q for q in searches(seen) if "team-review-requested:" in q]
    assert queries == ["is:pr is:open archived:false team-review-requested:example-org/fine"]


@pytest.mark.parametrize("status", [403, 404, 401])
async def test_a_token_that_may_not_read_teams_still_gets_its_direct_requests(status):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/teams":
            return json_response({"message": "no"}, status)
        return github_handler(review=[pr(1)])(request)

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert [item.external_id for item in items] == [f"{REPO}#1:review"]


@pytest.mark.parametrize(
    "answer",
    [
        json_response({"message": "slow down"}, 403, {"retry-after": "90"}),
        json_response({"message": "slow down"}, 429),
        json_response({}, 502),
        json_response({"not": "a list"}),
    ],
)
async def test_any_other_failure_of_the_teams_call_fails_the_whole_fetch(answer):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/teams":
            return answer
        return github_handler()(request)

    async with client_for(handler) as client:
        with pytest.raises(UpstreamError):
            await collector().fetch(client)  # never a partial list: it would close tasks


async def test_the_update_time_and_the_draft_flag_come_with_the_hit():
    handler = github_handler(
        author=[
            pr(1, updated_at="2026-11-20T09:30:00Z", draft=True),
            pr(2, updated_at="not a time", draft=False),
            pr(3),
        ]
    )

    async with client_for(handler) as client:
        items = await collector().fetch(client)

    assert items[0].updated_at.isoformat() == "2026-11-20T09:30:00+00:00"
    assert items[0].draft is True
    assert (items[1].updated_at, items[1].draft) == (None, False)
    assert (items[2].updated_at, items[2].draft) == (None, False)


async def test_pages_are_followed_until_a_short_one():
    pages = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        if "author:@me" not in request.url.params["q"] or "reviewed-by" in request.url.params["q"]:
            return search_page([])
        pages.append(page)
        count = PAGE_SIZE if page == 1 else 3
        rows = [pr(page * 1000 + n) for n in range(count)]
        return search_page(rows, total=PAGE_SIZE + 3)

    async with client_for(only_searches(handler)) as client:
        items = await collector().fetch(client)

    assert pages == [1, 2]
    assert len(items) == PAGE_SIZE + 3


async def test_more_pages_than_we_read_is_incomplete():
    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        return search_page([pr(page * 1000 + n) for n in range(PAGE_SIZE)], total=1000)

    async with client_for(only_searches(handler)) as client:
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
    async with client_for(only_searches(lambda request: answer)) as client:
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
    async with client_for(only_searches(lambda request: json_response(body))) as client:
        with pytest.raises(UpstreamError) as raised:
            await collector().fetch(client)

    assert raised.value.kind == "bad_json"


async def test_titles_and_links_are_cleaned():
    row = pr(5, "Line one\nline two\x07")
    row["html_url"] = "http://github.example/insecure"
    long_row = pr(6, "x" * 1000)

    async with client_for(github_handler(author=[row, long_row])) as client:
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
