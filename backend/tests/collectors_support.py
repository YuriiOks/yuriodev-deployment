"""Fakes for the collector tests: canned GitHub and Linear answers behind httpx.MockTransport.

Names are invented (`example-org/sample-repo`, `ENG-1`): nothing here refers to a real
organisation, repository, person or ticket.
"""

import json
from collections.abc import Callable
from typing import Any

import httpx

REPO = "example-org/sample-repo"


def json_response(data: Any, status: int = 200, headers: dict[str, str] | None = None):
    """A JSON answer as a stream: the collectors read bodies with `aiter_raw`, which a response
    built from `json=` (already consumed) refuses."""
    merged = {"content-type": "application/json", **(headers or {})}
    stream = httpx.ByteStream(json.dumps(data).encode())
    return httpx.Response(status, headers=merged, stream=stream)


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def pr(
    number: int,
    title: str = "A change",
    repo: str = REPO,
    updated_at: str | None = None,
    draft: bool | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "number": number,
        "title": title,
        "html_url": f"https://github.com/{repo}/pull/{number}",
        "repository_url": f"https://api.github.com/repos/{repo}",
    }
    if updated_at is not None:
        row["updated_at"] = updated_at
    if draft is not None:
        row["draft"] = draft
    return row


def team(slug: str, org: str = "example-org") -> dict[str, Any]:
    return {"slug": slug, "name": slug.title(), "organization": {"login": org}}


def search_page(rows: list[dict[str, Any]], total: int | None = None, incomplete: bool = False):
    body = {
        "total_count": len(rows) if total is None else total,
        "incomplete_results": incomplete,
        "items": rows,
    }
    return json_response(body)


def issue(
    number: int,
    title: str = "Do the thing",
    due: str | None = None,
    state: str = "started",
    priority: Any = 2,
    updated: str | None = "2026-11-20T09:00:00.000Z",
) -> dict[str, Any]:
    return {
        "id": f"issue-id-{number}",
        "identifier": f"ENG-{number}",
        "title": title,
        "url": f"https://linear.app/example-team/issue/ENG-{number}",
        "dueDate": due,
        "priority": priority,
        "updatedAt": updated,
        "state": {"name": "Some state", "type": state},
    }


def graphql_body(nodes: Any, has_next: bool, cursor: str | None) -> dict[str, Any]:
    info = {"hasNextPage": has_next, "endCursor": cursor}
    viewer = {"assignedIssues": {"nodes": nodes, "pageInfo": info}}
    return {"data": {"viewer": viewer}}


def issues_page(nodes: list[dict[str, Any]], next_cursor: str | None = None):
    return json_response(graphql_body(nodes, next_cursor is not None, next_cursor))


def github_handler(
    author=(), review=(), reviewed=(), teams=(), team_rows=None, seen=None
) -> Callable[[httpx.Request], httpx.Response]:
    """The GitHub the collector talks to: `/user/teams` (`teams=None` is a token that may not
    read them) and the searches, routed by their qualifier. `team_rows` maps a `<org>/<team>`
    to the rows of its review-requested search."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.path == "/user/teams":
            if teams is None:
                return json_response({"message": "Resource not accessible"}, 403)
            return json_response(list(teams))
        query = request.url.params["q"]
        if "reviewed-by:@me" in query:
            rows = reviewed
        elif "team-review-requested:" in query:
            name = query.split("team-review-requested:")[1].split()[0]
            rows = (team_rows or {}).get(name, ())
        elif "review-requested:@me" in query:
            rows = review
        else:
            rows = author
        return search_page(list(rows))

    return handler


def searches(seen: list[httpx.Request]) -> list[str]:
    """The search queries among the recorded requests, in order."""
    return [r.url.params["q"] for r in seen if r.url.path == "/search/issues"]
