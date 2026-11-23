"""Read-only REST routes of the finance data, under /api/dashboards/v1/finance.

Behind the same gate as the rest of the dashboards API (`src/dashboards/gate.py`): token or
trusted proxy, `Cache-Control: no-store`, 503 while the API is off. There is no write endpoint:
bank data only ever arrives through the collector.
"""

import logging
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.config import Settings
from src.core.errors import AppError
from src.core.http import UpstreamError
from src.dashboards.finance import monzo_auth, service
from src.dashboards.finance.schemas import (
    AccountOut,
    AccountsOut,
    ConnectionOut,
    FinanceSummaryOut,
    TransactionOut,
    TransactionsOut,
)
from src.dashboards.runtime import get_runtime, unavailable
from src.dashboards.service import guarded
from src.routes.dashboards import ClockDep, SessionDep, SettingsDep, ZoneDep

logger = logging.getLogger("yuriodev.finance")
router = APIRouter(prefix="/api/dashboards/v1/finance", tags=["finance"])
DASHBOARDS_PAGE = "/dashboards"  # where the browser lands after the consent, with ?monzo=<status>


@router.get("/accounts")
async def accounts(session: SessionDep) -> AccountsOut:
    """The accounts with their balances (open ones first) and the state of each bank link."""
    found, links, oldest = await service.list_accounts(session)
    return AccountsOut(
        accounts=[AccountOut.from_row(item, oldest.get(item.id)) for item in found],
        connections=[ConnectionOut.model_validate(item) for item in links],
    )


@router.get("/transactions")
async def transactions(
    session: SessionDep,
    zone: ZoneDep,
    account: Annotated[UUID | None, Query()] = None,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    q: Annotated[str | None, Query(max_length=service.MAX_TEXT)] = None,
    min_amount: Annotated[int | None, Query()] = None,
    max_amount: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=service.MAX_LIMIT)] = service.DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> TransactionsOut:
    """Newest first, of one account or all. `from` and `to` are days (both included) in the
    configured time zone; amounts are minor units, signed (money out is negative)."""
    flt = service.TransactionFilter(account, start, end, q, min_amount, max_amount)
    rows, next_cursor = await service.list_transactions(session, flt, zone, limit, cursor)
    return TransactionsOut(
        transactions=[TransactionOut.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/summary")
async def summary(session: SessionDep, clock: ClockDep, zone: ZoneDep) -> FinanceSummaryOut:
    """Per currency: the total balance, and money spent and received this month."""
    return await service.summary(session, clock(), zone)


def monzo_setup(settings: Settings) -> tuple[SecretStr, SecretStr, str]:
    """The client id, the client secret and the redirect URI, or 503 when Monzo is not set up."""
    client_id, secret = settings.monzo_client_id, settings.monzo_client_secret
    redirect = settings.monzo_redirect_uri
    if not settings.monzo_enabled or client_id is None or secret is None or redirect is None:
        raise AppError(503, "monzo_not_configured", "Monzo is not set up")
    return client_id, secret, redirect


def sessions_of(request: Request) -> async_sessionmaker[AsyncSession]:
    runtime = get_runtime(request)
    if runtime is None or not runtime.ready.is_set():
        raise unavailable()
    return runtime.sessions


@router.get("/monzo/connect")
async def monzo_connect(
    request: Request, settings: SettingsDep, clock: ClockDep
) -> RedirectResponse:
    """Send the owner to Monzo to consent. The `state` in the address is single use."""
    client_id, _, redirect = monzo_setup(settings)
    state = await guarded(monzo_auth.issue_state)(sessions_of(request), clock())
    return RedirectResponse(monzo_auth.consent_url(client_id, redirect, state), status_code=303)


def monzo_done(status: str) -> RedirectResponse:
    """Back to the dashboards with a status the page can show. Never a code or a token."""
    logger.info("monzo consent", extra={"event": "finance.monzo_consent", "status": status})
    return RedirectResponse(
        f"{DASHBOARDS_PAGE}?monzo={status}",
        status_code=303,
        headers={"Referrer-Policy": "no-referrer"},
    )


@router.get("/monzo/callback")
async def monzo_callback(
    request: Request,
    settings: SettingsDep,
    clock: ClockDep,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error: Annotated[str | None, Query(max_length=256)] = None,
) -> RedirectResponse:
    """Monzo's redirect back: check the state (single use, not stale), exchange the code, keep the
    token pair and go back to the dashboards. `connected`, `denied`, `invalid_state` or `failed`."""
    client_id, secret, redirect = monzo_setup(settings)
    sessions = sessions_of(request)
    now = clock()
    if not await guarded(monzo_auth.consume_state)(sessions, state, now):
        return monzo_done("invalid_state")
    if error or not code:
        return monzo_done("denied")
    client = request.app.state.finance_http
    if client is None:
        raise unavailable()
    try:
        pair = await monzo_auth.exchange_code(client, client_id, secret, redirect, code)
    except UpstreamError as exc:
        logger.warning(
            "monzo code exchange failed",
            extra={"event": "finance.monzo_exchange_failed", "kind": exc.kind},
        )
        return monzo_done("failed")
    await guarded(monzo_auth.store_consent)(sessions, pair, now)
    return monzo_done("connected")
