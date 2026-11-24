"""Read-only REST routes of the finance data, under /api/dashboards/v1/finance.

Behind the same gate as the rest of the dashboards API (`src/dashboards/gate.py`): token or
trusted proxy, `Cache-Control: no-store`, 503 while the API is off. There is no write endpoint:
bank data only ever arrives through the collector.
"""

import logging
from datetime import date
from typing import Annotated, Self
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.config import Settings
from src.core.errors import AppError
from src.core.http import UpstreamError
from src.dashboards.finance import manual, monzo_auth, service
from src.dashboards.finance.brands import BRANDS, COLLECTOR_PROVIDERS, NEUTRAL, RECONNECT
from src.dashboards.finance.categories import Category
from src.dashboards.finance.logos import VARIANTS
from src.dashboards.finance.manual import MANUAL_FIELDS, ManualAccountPatch
from src.dashboards.finance.schemas import (
    AccountOut,
    AccountsOut,
    CategoriesOut,
    ColorsOut,
    ConnectionOut,
    DisplayOut,
    FinanceSummaryOut,
    LogoOut,
    ProviderOut,
    ProvidersOut,
    TransactionOut,
    TransactionsOut,
    display_fields,
)
from src.dashboards.runtime import get_runtime, unavailable
from src.dashboards.service import guarded
from src.routes.dashboards import ClockDep, SessionDep, SettingsDep, ZoneDep

logger = logging.getLogger("yuriodev.finance")
router = APIRouter(prefix="/api/dashboards/v1/finance", tags=["finance"])
DASHBOARDS_PAGE = "/dashboards/personal/money"  # where the browser lands after the consent


@router.get("/accounts")
async def accounts(session: SessionDep, settings: SettingsDep, clock: ClockDep) -> AccountsOut:
    """The accounts with their balances (open ones first), each also in the display currency at
    the latest rate, and the state of each bank link."""
    display = await service.display_for(session, settings.finance_display_currency, clock())
    found, links, oldest = await service.list_accounts(session)
    return AccountsOut(
        accounts=[AccountOut.from_row(item, oldest.get(item.id), display) for item in found],
        connections=[ConnectionOut.from_row(item, clock()) for item in links],
        display=DisplayOut(**display_fields(display, {item.currency for item in found})),
    )


OverdraftLimit = Annotated[int, Field(strict=True, ge=0, le=service.MAX_OVERDRAFT)]


class AccountPatch(ManualAccountPatch):
    """What the owner may change: his overdraft limit on any account (null clears it), and on an
    account he entered by hand also its name, label, last four digits, archiving and (a credit
    card) limit."""

    overdraft_limit: OverdraftLimit | None = None


@router.patch("/accounts/{account_id}")
async def patch_account(
    account_id: UUID,
    body: AccountPatch,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> AccountOut:
    """The owner's overdraft limit for one account, in minor units. It wins over a limit the bank
    sends (`overdraft_limit_bank` keeps showing that one) and no collector overwrites it."""
    changes = body.model_fields_set
    if not changes:
        raise AppError(422, "validation_error", "Nothing to change")
    # Both parts are applied in one transaction: a refused half changes nothing.
    if changes & MANUAL_FIELDS:
        await manual.update_account(session, account_id, body, clock(), commit=False)
    if "overdraft_limit" in changes:
        row, oldest = await service.set_overdraft(
            session, account_id, body.overdraft_limit, commit=False
        )
    else:
        row, oldest = await service.account_with_history(session, account_id)
    await session.commit()
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return AccountOut.from_row(row, oldest, display)


@router.get("/transactions")
async def transactions(
    session: SessionDep,
    zone: ZoneDep,
    settings: SettingsDep,
    clock: ClockDep,
    account: Annotated[list[UUID] | None, Query(max_length=20)] = None,
    provider: Annotated[str | None, Query(pattern=r"^[a-z0-9-]{1,32}$")] = None,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    q: Annotated[str | None, Query(max_length=service.MAX_TEXT)] = None,
    min_amount: Annotated[int | None, Query()] = None,
    max_amount: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=service.MAX_LIMIT)] = service.DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    category: Annotated[Category | None, Query()] = None,
) -> TransactionsOut:
    """Newest first, of all accounts, of any of the accounts named (`account` may be repeated), or
    of one `provider`'s. `from` and `to` are days (both included) in the configured time zone;
    amounts are minor units, signed (money out is negative); `category`
    is the effective one (the owner's override, else the normalised one)."""
    flt = service.TransactionFilter(
        None, start, end, q, min_amount, max_amount, category, tuple(account or ()), provider
    )
    rows, next_cursor = await service.list_transactions(session, flt, zone, limit, cursor)
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return TransactionsOut(
        transactions=[TransactionOut.from_row(row, display) for row in rows],
        next_cursor=next_cursor,
        display=DisplayOut(**display_fields(display, {row.currency for row in rows})),
    )


class TransactionPatch(BaseModel):
    """What the owner may change about a transaction: its `category` (null clears it) and whether
    it is a move between their own accounts (`internal_transfer`; with `counterpart_id`, the other
    leg, both are marked). A change of `internal_transfer` sticks: no refetch or pairing undoes
    it."""

    model_config = ConfigDict(extra="forbid")

    category: Category | None = None
    internal_transfer: bool | None = Field(default=None, strict=True)
    counterpart_id: UUID | None = None

    @model_validator(mode="after")
    def _something(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if self.internal_transfer is None and "internal_transfer" in self.model_fields_set:
            raise ValueError("internal_transfer is true or false")
        return self


@router.patch("/transactions/{transaction_id}")
async def set_transaction_category(
    transaction_id: UUID,
    body: TransactionPatch,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
) -> TransactionOut:
    """The owner's category for one transaction; a note on our copy only, kept on re-import."""
    changes = body.model_fields_set
    row = None
    if "internal_transfer" in changes and body.internal_transfer is not None:
        row = await service.set_internal_transfer(
            session, transaction_id, body.internal_transfer, body.counterpart_id
        )
    if "category" in changes:
        row = await service.set_category(session, transaction_id, body.category)
    if row is None:
        raise AppError(422, "validation_error", "Nothing to change")
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return TransactionOut.from_row(row, display)


@router.get("/categories")
async def categories(
    session: SessionDep,
    clock: ClockDep,
    zone: ZoneDep,
    settings: SettingsDep,
    month: Annotated[str | None, Query(max_length=7)] = None,
) -> CategoriesOut:
    """Money out per currency and category for `month` (YYYY-MM, default this month) with the
    month before beside it, and all of it in the display currency; internal transfers and
    declined payments are left out."""
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return await service.categories_report(session, month, clock(), zone, display)


@router.get("/providers")
async def providers(session: SessionDep, settings: SettingsDep) -> ProvidersOut:
    """How each bank is shown: its name and brand colours (built in for the public brands, else the
    owner's own on his connection) and its logo from DASHBOARDS_PROVIDER_LOGOS (a missing logo is
    null), for every built-in brand, every id with a logo and every provider that has accounts.
    Fetch it once: the data URIs are big and the accounts answer deliberately does not repeat
    them."""
    logos = settings.provider_logos
    names = set(logos) | set(BRANDS) | set(await service.provider_ids(session))
    styles = await service.connection_styles(session)
    found: list[ProviderOut] = []
    for name in sorted(names):
        brand, own = BRANDS.get(name), styles.get(name)
        reconnect = RECONNECT.get(name)
        colors = own.colors if own and own.colors else brand or NEUTRAL
        found.append(
            ProviderOut(
                id=name,
                name=(own.name if own and own.name else brand.name if brand else None),
                colors=ColorsOut(background=colors.background, foreground=colors.foreground),
                logo=LogoOut(**{v: logos.get(name, {}).get(v) for v in VARIANTS}),
                entry="api" if name in COLLECTOR_PROVIDERS else "manual",
                reconnect=reconnect[0] if reconnect else None,
                reconnect_path=reconnect[1] if reconnect else None,
            )
        )
    return ProvidersOut(providers=found)


@router.get("/summary")
async def summary(
    session: SessionDep, clock: ClockDep, zone: ZoneDep, settings: SettingsDep
) -> FinanceSummaryOut:
    """Per currency: the total balance, and money spent and received this month, and one grand
    total in the display currency."""
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return await service.summary(session, clock(), zone, display)


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
