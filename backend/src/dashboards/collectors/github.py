"""GitHub: open pull requests you authored, those waiting for your review, those you reviewed.

Searches through the REST search API for the token's own user (`@me`), each with the optional
GITHUB_SEARCH_SCOPE appended (for example an `org:` qualifier). Each pull request is one item per
role, so a task never changes identity when the role does:

    external id   <owner>/<repo>#<number>:author | :review | :reviewed
    title         "PR #n: t"            "Review PR #n: t"       "Reviewed PR #n: t"
    stage         mine                  review                  reviewed

- `review` is `review-requested:@me`, which GitHub answers for you and for the teams you are in,
  but only when the token can see team membership (classic `read:org`, or a fine-grained token's
  organisation permission "Members: read"). Without it only direct requests match. So the teams
  are asked for too (`GET /user/teams`, then `team-review-requested:<org>/<team>` for each, at
  most ten, only the organisations named by an `org:` qualifier of the scope when there is one):
  a token that cannot read teams just gets no teams and the direct requests (a missing scope is
  permanent, so no task flaps), while any other failure of that call fails the whole fetch.
- `reviewed` is one search, `reviewed-by:@me -author:@me -review-requested:@me`: open pull
  requests you reviewed that are not yours and do not ask for you again (a re-request moves the
  task to `review`: the old one closes and the new one opens).
- Each search hit also gives the last update time and the draft flag (no call per pull request).

The search API returns at most 1000 results and may flag its answer incomplete; either makes the
whole fetch fail rather than let the sync close tasks that were only cut off.
"""

import re
from datetime import datetime
from typing import Any

import httpx
from pydantic import SecretStr

from src.core.http import UpstreamError, get_json_capped
from src.dashboards.collectors.base import (
    MAX_PAGES,
    PAGE_SIZE,
    ExternalItem,
    clean_title,
    pause_seconds,
    safe_url,
)
from src.dashboards.collectors.sync import TaskCollector

SEARCH_URL = "https://api.github.com/search/issues"
SEARCH_RESULT_LIMIT = 1000
REPOS_MARKER = "/repos/"

TEAMS_URL = "https://api.github.com/user/teams"
MAX_TEAMS = 10
NAME_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,100}")
ORG_QUALIFIER = re.compile(r"(?:^|\s)org:([A-Za-z0-9._-]+)")

# `stage` of an item by role: the page groups the GitHub tab by it.
STAGES = {"author": "mine", "review": "review", "reviewed": "reviewed"}

# (role in the external id, search qualifier, title prefix)
ROLES = (
    ("author", "author:@me", "PR"),
    ("review", "review-requested:@me", "Review PR"),
    ("reviewed", "reviewed-by:@me -author:@me -review-requested:@me", "Reviewed PR"),
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
        searches = list(ROLES)
        for team in await self._teams(client):
            searches.append(("review", f"team-review-requested:{team}", "Review PR"))
        for role, qualifier, prefix in searches:
            for item in await self._search(client, role, qualifier, prefix):
                items[item.external_id] = item
        return list(items.values())

    async def _teams(self, client: httpx.AsyncClient) -> list[str]:
        """`<org>/<team>` of the teams the token can see, at most ten, those of the scope's
        organisations when it names some. A token that may not read teams gets none."""
        try:
            body, _ = await get_json_capped(
                client, TEAMS_URL, headers=self._headers, params={"per_page": 100}
            )
        except UpstreamError as exc:
            # No scope is permanent, so it never flaps; a rate limit is not that (also a 403).
            if exc.kind in ("auth", "not_found") and pause_seconds(exc, 0) is None:
                return []
            raise
        if not isinstance(body, list):
            raise UpstreamError("bad_json")
        orgs = set(ORG_QUALIFIER.findall(self._scope))
        teams: list[str] = []
        for row in body:
            organisation = row.get("organization") if isinstance(row, dict) else None
            org = organisation.get("login") if isinstance(organisation, dict) else None
            slug = row.get("slug") if isinstance(row, dict) else None
            if not isinstance(org, str) or not isinstance(slug, str):
                continue
            if not NAME_PATTERN.fullmatch(org) or not NAME_PATTERN.fullmatch(slug):
                continue
            if orgs and org not in orgs:
                continue
            teams.append(f"{org}/{slug}")
        return teams[:MAX_TEAMS]

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
        updated_at=_when(row.get("updated_at")),
        draft=row.get("draft") is True,
    )


def _when(value: object) -> datetime | None:
    """A timestamp of the answer, or None: ordering help must never fail a fetch."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None
