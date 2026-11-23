"""GitHub: open pull requests you authored, and open pull requests waiting for your review.

Two searches through the REST search API, both for the token's own user (`@me`), both with the
optional GITHUB_SEARCH_SCOPE appended (for example an `org:` qualifier). Each pull request is one
item per role, so a task never changes identity when the role does:

    external id   <owner>/<repo>#<number>:author   or   ...:review
    title         "PR #<number>: <title>"          or   "Review PR #<number>: <title>"

The search API returns at most 1000 results and may flag its answer incomplete; either makes the
whole fetch fail rather than let the sync close tasks that were only cut off.
"""

from typing import Any

import httpx
from pydantic import SecretStr

from src.core.http import UpstreamError, get_json_capped
from src.dashboards.collectors.base import (
    MAX_PAGES,
    PAGE_SIZE,
    ExternalItem,
    clean_title,
    safe_url,
)
from src.dashboards.collectors.sync import TaskCollector

SEARCH_URL = "https://api.github.com/search/issues"
SEARCH_RESULT_LIMIT = 1000
REPOS_MARKER = "/repos/"

# `stage` of an item by role: the page groups the GitHub tab by it.
STAGES = {"author": "mine", "review": "review"}

# (role in the external id, search qualifier, title prefix)
ROLES = (
    ("author", "author:@me", "PR"),
    ("review", "review-requested:@me", "Review PR"),
)


class GitHubCollector(TaskCollector):
    name = "github"
    source = "github"

    def __init__(self, token: SecretStr, space: str, scope: str = "") -> None:
        self.space = space
        self._scope = scope
        self._headers = {
            "Authorization": f"Bearer {token.get_secret_value()}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def fetch(self, client: httpx.AsyncClient) -> list[ExternalItem]:
        items: dict[str, ExternalItem] = {}
        for role, qualifier, prefix in ROLES:
            for item in await self._search(client, role, qualifier, prefix):
                items[item.external_id] = item
        return list(items.values())

    async def _search(
        self, client: httpx.AsyncClient, role: str, qualifier: str, prefix: str
    ) -> list[ExternalItem]:
        query = f"is:pr is:open archived:false {qualifier} {self._scope}".strip()
        found: list[ExternalItem] = []
        for page in range(1, MAX_PAGES + 1):
            params: dict[str, str | int] = {
                "q": query,
                "per_page": PAGE_SIZE,
                "page": page,
                "sort": "updated",
            }
            body, _ = await get_json_capped(
                client, SEARCH_URL, headers=self._headers, params=params
            )
            rows = self._rows(body)
            found.extend(_item(row, role, prefix) for row in rows)
            if len(rows) < PAGE_SIZE:
                return found
        raise UpstreamError("incomplete")  # more pages than we are willing to read

    @staticmethod
    def _rows(body: Any) -> list[Any]:
        if not isinstance(body, dict) or not isinstance(body.get("items"), list):
            raise UpstreamError("bad_json")
        total = body.get("total_count")
        too_many = isinstance(total, int) and total > SEARCH_RESULT_LIMIT
        if body.get("incomplete_results") is True or too_many:
            raise UpstreamError("incomplete")
        rows: list[Any] = body["items"]
        return rows


def _item(row: Any, role: str, prefix: str) -> ExternalItem:
    """One search hit as an item; any malformed hit fails the whole fetch."""
    if not isinstance(row, dict):
        raise UpstreamError("bad_json")
    number = row.get("number")
    repo_url = row.get("repository_url")
    if not isinstance(number, int) or not isinstance(repo_url, str):
        raise UpstreamError("bad_json")
    repo = repo_url.partition(REPOS_MARKER)[2]
    if repo.count("/") != 1 or not repo.isprintable():
        raise UpstreamError("bad_json")
    return ExternalItem(
        external_id=f"{repo}#{number}:{role}",
        title=clean_title(f"{prefix} #{number}: ", row.get("title")),
        url=safe_url(row.get("html_url")),
        stage=STAGES[role],
    )
