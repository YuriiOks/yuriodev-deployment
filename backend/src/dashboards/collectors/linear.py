"""Linear: open issues assigned to the API key's user (not completed, canceled or duplicate).

One GraphQL query over the viewer's assigned issues, paged by cursor.

    external id   the issue's id (stable when an issue moves between teams)
    title         "<IDENTIFIER>: <title>"
    due date      the issue's own, applied when the task is first created

A GraphQL `errors` answer, or more pages than we read, fails the whole fetch.
"""

from datetime import date
from typing import Any

import httpx
from pydantic import SecretStr

from src.core.http import UpstreamError, post_json_capped
from src.dashboards.collectors.base import MAX_PAGES, ExternalItem, clean_title, safe_url
from src.dashboards.collectors.sync import TaskCollector

# The open workflow state types: the filter excludes completed, canceled and duplicate (an issue
# marked as a duplicate of another is closed), so anything else is unknown to us and gets no stage.
STATE_TYPES = ("started", "unstarted", "backlog", "triage")
GRAPHQL_URL = "https://api.linear.app/graphql"
# `first` is 100: the largest page Linear serves.
QUERY = """
query Open($after: String) {
  viewer {
    assignedIssues(
      first: 100
      after: $after
      filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }
    ) {
      nodes { id identifier title url dueDate priority state { name type } }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""


class LinearCollector(TaskCollector):
    name = "linear"
    source = "linear"

    def __init__(self, api_key: SecretStr, space: str) -> None:
        self.space = space
        # A personal API key is sent as is: the "Bearer" prefix is for OAuth tokens only.
        self._headers = {"Authorization": api_key.get_secret_value()}

    async def fetch(self, client: httpx.AsyncClient) -> list[ExternalItem]:
        items: dict[str, ExternalItem] = {}
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            payload = {"query": QUERY, "variables": {"after": cursor}}
            body, _headers = await post_json_capped(
                client, GRAPHQL_URL, headers=self._headers, json_body=payload
            )
            nodes, has_next, cursor = _page(body)
            for node in nodes:
                item = _item(node)
                items[item.external_id] = item
            if not has_next:
                return list(items.values())
        raise UpstreamError("incomplete")  # more pages than we are willing to read


def _page(body: Any) -> tuple[list[Any], bool, str | None]:
    if not isinstance(body, dict) or body.get("errors"):
        raise UpstreamError("graphql")
    try:
        issues = body["data"]["viewer"]["assignedIssues"]
        nodes = issues["nodes"]
        info = issues["pageInfo"]
        has_next = info["hasNextPage"]
        cursor = info["endCursor"]
    except KeyError, TypeError:
        raise UpstreamError("bad_json") from None
    if not isinstance(nodes, list) or not isinstance(has_next, bool):
        raise UpstreamError("bad_json")
    if has_next and not isinstance(cursor, str):
        raise UpstreamError("bad_json")
    return nodes, has_next, cursor if isinstance(cursor, str) else None


def _item(node: Any) -> ExternalItem:
    if not isinstance(node, dict):
        raise UpstreamError("bad_json")
    issue_id = node.get("id")
    identifier = node.get("identifier")
    if not isinstance(issue_id, str) or not isinstance(identifier, str) or not identifier:
        raise UpstreamError("bad_json")
    return ExternalItem(
        external_id=issue_id,
        title=clean_title(f"{clean_title('', identifier)}: ", node.get("title")),
        url=safe_url(node.get("url")),
        due_date=_due(node.get("dueDate")),
        stage=_stage(node.get("state")),
    )


def _due(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _stage(state: object) -> str | None:
    """The workflow state's TYPE when it is one of the open ones, else None."""
    state_type = state.get("type") if isinstance(state, dict) else None
    if isinstance(state_type, str) and state_type in STATE_TYPES:
        return state_type
    return None
