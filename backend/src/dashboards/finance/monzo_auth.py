"""Monzo's OAuth 2.0 (https://docs.monzo.com/, authentication): consent state, the code exchange and
the token pair's life.

What the documentation says and this module relies on:

- The owner is sent to `https://auth.monzo.com/?client_id&redirect_uri&response_type=code&state`.
  Monzo calls back with `code` and the same `state`; a different state aborts the flow.
- `POST https://api.monzo.com/oauth2/token` (form encoded) exchanges the code, or a refresh token,
  for `access_token`, `expires_in` (about six hours), `user_id` and, for a confidential client
  only, a `refresh_token`. Refreshing is a one-time operation: it invalidates the previous pair.
- The access token has no permission until the owner approves the client in the Monzo app.

How the pieces are kept safe:

- `state` is random, single use and short lived. Only its SHA-256 is stored; consuming it is one
  atomic UPDATE, so a replayed or stale state is refused and cannot be raced.
- The token pair lives in `finance.monzo_token`, a table of this provider (never the shared
  ones), and is never selected by the API. It is stored as issued, without encryption at rest: see
  deploy/README.md ("Finance") for what protects it and what that costs.
- A refresh runs under a row lock (`SELECT ... FOR UPDATE`) in one transaction, so two processes
  can never both spend the one-time refresh token: the second waits, then finds a fresh pair.
- A refused refresh marks the token `revoked_at` and the collector stops calling until the owner
  consents again. A client without a refresh token does the same when its token expires.
- No token, code or secret is ever logged, put in a URL we build (other than the state), in an
  error or in an answer: errors are `UpstreamError` kinds only.
"""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode
from uuid import UUID

import httpx
from pydantic import SecretStr
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError, post_form_capped
from src.dashboards.finance.models import Account, Connection, MonzoOAuthState, MonzoToken
from src.dashboards.finance.parsing import bad, safe_id, whole

logger = logging.getLogger("yuriodev.finance")

PROVIDER = "monzo"
REF = "personal"
AUTH_URL = "https://auth.monzo.com/"
API_URL = "https://api.monzo.com"
TOKEN_URL = f"{API_URL}/oauth2/token"
STATE_TTL = timedelta(minutes=10)
APPROVAL_WAIT = timedelta(minutes=15)  # how long the owner has to approve in the app
REFRESH_MARGIN = timedelta(minutes=30)  # refresh when less than this is left
MAX_TOKEN = 4096
REFUSED = (400, 401, 403)  # a token request the provider refused, as opposed to one that failed


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str | None
    expires_in: int
    user_id: str


@dataclass(frozen=True)
class TokenView:
    """What the provider needs of the stored token: never logged, never serialised."""

    access_token: str
    approved_at: datetime | None
    approval_deadline: datetime


def hash_state(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def consent_url(client_id: SecretStr, redirect_uri: str, state: str) -> str:
    query = urlencode(
        {
            "client_id": client_id.get_secret_value(),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
    )
    return f"{AUTH_URL}?{query}"


async def issue_state(sessions: async_sessionmaker[AsyncSession], now: datetime) -> str:
    """A new single-use `state` (only its hash is kept); expired ones are swept away."""
    state = secrets.token_urlsafe(32)
    async with sessions() as session, session.begin():
        await session.execute(delete(MonzoOAuthState).where(MonzoOAuthState.expires_at < now))
        session.add(MonzoOAuthState(state_hash=hash_state(state), expires_at=now + STATE_TTL))
    return state


async def consume_state(
    sessions: async_sessionmaker[AsyncSession], state: str | None, now: datetime
) -> bool:
    """True once for a state that was issued, is not expired and was not used: one atomic
    UPDATE, so two callbacks with the same state cannot both win."""
    if not state or len(state) > 200:
        return False
    async with sessions() as session, session.begin():
        won = await session.execute(
            update(MonzoOAuthState)
            .where(
                MonzoOAuthState.state_hash == hash_state(state),
                MonzoOAuthState.used_at.is_(None),
                MonzoOAuthState.expires_at > now,
            )
            .values(used_at=now)
            .returning(MonzoOAuthState.state_hash)
        )
        return won.first() is not None


def parse_token_answer(body: object) -> TokenPair:
    if not isinstance(body, dict):
        raise bad()
    access = body.get("access_token")
    refresh = body.get("refresh_token")
    user = body.get("user_id")
    if not isinstance(access, str) or not 0 < len(access) <= MAX_TOKEN:
        raise bad()
    if refresh is not None and (not isinstance(refresh, str) or len(refresh) > MAX_TOKEN):
        raise bad()
    expires_in = whole(body.get("expires_in"))
    if not 60 <= expires_in <= 7 * 86_400:
        raise bad()
    return TokenPair(access, refresh or None, expires_in, safe_id(user))


async def exchange_code(
    client: httpx.AsyncClient,
    client_id: SecretStr,
    client_secret: SecretStr,
    redirect_uri: str,
    code: str,
) -> TokenPair:
    form = {
        "grant_type": "authorization_code",
        "client_id": client_id.get_secret_value(),
        "client_secret": client_secret.get_secret_value(),
        "redirect_uri": redirect_uri,
        "code": code,
    }
    body, _ = await post_form_capped(client, TOKEN_URL, headers={}, form=form)
    return parse_token_answer(body)


async def connection_id(sessions: async_sessionmaker[AsyncSession], now: datetime) -> UUID:
    async with sessions() as session, session.begin():
        return await _connection(session, now)


async def _connection(session: AsyncSession, now: datetime) -> UUID:
    await session.execute(
        insert(Connection)
        .values(provider=PROVIDER, ref=REF, status_changed_at=now)
        .on_conflict_do_nothing(index_elements=[Connection.provider, Connection.ref])
    )
    found = await session.scalar(
        select(Connection.id).where(Connection.provider == PROVIDER, Connection.ref == REF)
    )
    if found is None:  # unreachable: the row was just inserted or already there
        raise bad()
    return found


async def store_consent(
    sessions: async_sessionmaker[AsyncSession], pair: TokenPair, now: datetime
) -> None:
    """The owner consented: keep the pair, wait for the in-app approval, and let the history be
    walked again (an earlier walk may have stopped at the 90-day limit)."""
    values = {
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "expires_at": now + timedelta(seconds=pair.expires_in),
        "user_id": pair.user_id,
        "approved_at": None,
        "approval_deadline": now + APPROVAL_WAIT,
        "revoked_at": None,
        "updated_at": now,
    }
    async with sessions() as session, session.begin():
        link = await _connection(session, now)
        await session.execute(
            update(Connection)
            .where(Connection.id == link)
            .values(status="ok", status_changed_at=now, last_error=None)
        )
        await session.execute(
            insert(MonzoToken)
            .values(connection_id=link, **values)
            .on_conflict_do_update(index_elements=[MonzoToken.connection_id], set_=values)
        )
        await session.execute(
            update(Account)
            .where(Account.provider == PROVIDER)
            .values(backfill_done=False, empty_streak=0)
        )


async def token_view(sessions: async_sessionmaker[AsyncSession]) -> TokenView | None:
    """The stored token as the provider sees it, or None (no consent yet, or it was revoked)."""
    async with sessions() as session:
        row = (
            await session.execute(
                select(
                    MonzoToken.access_token,
                    MonzoToken.approved_at,
                    MonzoToken.approval_deadline,
                    MonzoToken.revoked_at,
                )
                .join(Connection, Connection.id == MonzoToken.connection_id)
                .where(Connection.provider == PROVIDER, Connection.ref == REF)
            )
        ).first()
    if row is None or row.revoked_at is not None:
        return None
    return TokenView(row.access_token, row.approved_at, row.approval_deadline)


async def mark_approved(sessions: async_sessionmaker[AsyncSession], now: datetime) -> datetime:
    """The API answered: the owner approved the client. Returns the moment the five minutes of
    full history started (the first caller's, whoever it was)."""
    async with sessions() as session, session.begin():
        link = await _connection(session, now)
        await session.execute(
            update(MonzoToken)
            .where(MonzoToken.connection_id == link, MonzoToken.approved_at.is_(None))
            .values(approved_at=now)
        )
        stamp = await session.scalar(
            select(MonzoToken.approved_at).where(MonzoToken.connection_id == link)
        )
    return stamp or now


async def usable_token(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    client_id: SecretStr,
    client_secret: SecretStr,
    now: datetime,
) -> TokenView:
    """An access token that is good for a while, refreshed ahead of its expiry.

    The row is locked (`FOR UPDATE`) for the whole refresh, so a second caller, in this process or
    another, waits and then finds the new pair instead of spending the old refresh token again.
    A refused refresh revokes the token and raises `UpstreamError("auth")`; any other failure
    leaves the row as it was.
    """
    refused = False
    async with sessions() as session, session.begin():
        row = (
            await session.execute(
                select(MonzoToken)
                .join(Connection, Connection.id == MonzoToken.connection_id)
                .where(Connection.provider == PROVIDER, Connection.ref == REF)
                .with_for_update(of=MonzoToken)
            )
        ).scalar_one_or_none()
        if row is None or row.revoked_at is not None:
            raise UpstreamError("auth", 401)
        if row.expires_at - now > REFRESH_MARGIN:
            return TokenView(row.access_token, row.approved_at, row.approval_deadline)
        if row.refresh_token is None:  # a client without refresh tokens: consent again
            if row.expires_at > now:
                return TokenView(row.access_token, row.approved_at, row.approval_deadline)
            row.revoked_at = now
            refused = True
        else:
            form = {
                "grant_type": "refresh_token",
                "client_id": client_id.get_secret_value(),
                "client_secret": client_secret.get_secret_value(),
                "refresh_token": row.refresh_token,
            }
            try:
                body, _ = await post_form_capped(client, TOKEN_URL, headers={}, form=form)
                pair = parse_token_answer(body)
            except UpstreamError as exc:
                if exc.status not in REFUSED:
                    raise
                row.revoked_at = now
                refused = True
            else:
                row.access_token = pair.access_token
                row.refresh_token = pair.refresh_token
                row.expires_at = now + timedelta(seconds=pair.expires_in)
                row.updated_at = now
                logger.info("monzo token refreshed", extra={"event": "finance.monzo_refresh"})
                return TokenView(row.access_token, row.approved_at, row.approval_deadline)
    if refused:
        logger.warning("monzo token refused", extra={"event": "finance.monzo_refused"})
        raise UpstreamError("auth", 401)
    raise bad()  # unreachable
