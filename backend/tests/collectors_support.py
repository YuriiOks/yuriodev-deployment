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


def pr(number: int, title: str = "A change", repo: str = REPO) -> dict[str, Any]:
    return {
        "number": number,
        "title": title,
        "html_url": f"https://github.com/{repo}/pull/{number}",
        "repository_url": f"https://api.github.com/repos/{repo}",
    }


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
) -> dict[str, Any]:
    return {
        "id": f"issue-id-{number}",
        "identifier": f"ENG-{number}",
        "title": title,
        "url": f"https://linear.app/example-team/issue/ENG-{number}",
        "dueDate": due,
        "priority": 2,
        "state": {"name": "Some state", "type": state},
    }


def graphql_body(nodes: Any, has_next: bool, cursor: str | None) -> dict[str, Any]:
    info = {"hasNextPage": has_next, "endCursor": cursor}
    viewer = {"assignedIssues": {"nodes": nodes, "pageInfo": info}}
    return {"data": {"viewer": viewer}}


def issues_page(nodes: list[dict[str, Any]], next_cursor: str | None = None):
    return json_response(graphql_body(nodes, next_cursor is not None, next_cursor))
