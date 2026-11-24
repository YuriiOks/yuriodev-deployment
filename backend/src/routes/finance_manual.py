"""Banks entered by hand, under /api/dashboards/v1/finance/manual.

Behind the same gate as the rest of the dashboards API. Nothing is sent to a bank: the owner makes
a connection and its accounts, sets a balance with a date, or uploads a statement he downloaded
(a CSV in a layout the code knows, or OFX/QFX). Rules and layouts: deploy/README.md, "Banks
without an API".
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from src.core.errors import AppError
from src.dashboards.finance import manual, service
from src.dashboards.finance.rawbody import require_file_type
from src.dashboards.finance.schemas import AccountOut, ConnectionOut
from src.dashboards.finance.statements import MAX_BYTES, DateOrder
from src.routes.dashboards import ClockDep, SessionDep, SettingsDep, ZoneDep

router = APIRouter(prefix="/api/dashboards/v1/finance/manual", tags=["finance"])


@router.post("/connections", status_code=201)
async def create_connection(
    body: manual.ConnectionIn, session: SessionDep, clock: ClockDep
) -> ConnectionOut:
    """A bank entered by hand. `provider` is an id such as `barclays` or a neutral one of your own;
    `display_name` and `brand_bg`/`brand_fg` (contrast of 3:1) are for a bank without a built-in
    brand. A bank with its own API (monobank, monzo) is refused."""
    return ConnectionOut.from_row(await manual.create_connection(session, body), clock())


@router.patch("/connections/{connection_id}")
async def update_connection(
    connection_id: UUID, body: manual.ConnectionPatch, session: SessionDep, clock: ClockDep
) -> ConnectionOut:
    link = await manual.update_connection(session, connection_id, body)
    return ConnectionOut.from_row(link, clock())


async def _account(
    session: SessionDep, settings: SettingsDep, clock: ClockDep, account_id: UUID
) -> AccountOut:
    row, oldest = await service.account_with_history(session, account_id)
    display = await service.display_for(session, settings.finance_display_currency, clock())
    return AccountOut.from_row(row, oldest, display)


@router.post("/accounts", status_code=201)
async def create_account(
    body: manual.AccountIn,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> AccountOut:
    """An account of a manual connection with its first balance. A credit card takes
    `credit_limit` and `owed` (its balance is the limit minus what is owed, as everywhere), the
    others `balance` (negative when overdrawn)."""
    row = await manual.create_account(session, body, clock(), zone)
    return await _account(session, settings, clock, row.id)


@router.post("/accounts/{account_id}/balance")
async def set_balance(
    account_id: UUID,
    body: manual.BalanceIn,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    zone: ZoneDep,
) -> AccountOut:
    """The balance as of a date (`as_of`, a day or a time with an offset; default now; not in the
    future). `owed` for a credit card, `balance` for the others."""
    await manual.set_balance(session, account_id, body, clock(), zone)
    return await _account(session, settings, clock, account_id)


@router.post("/accounts/{account_id}/statement", response_model=manual.StatementResult)
async def upload_statement(
    account_id: UUID,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    zone: ZoneDep,
    date_order: Annotated[DateOrder | None, Query()] = None,
    apply_balance: Annotated[bool, Query()] = False,
    dry_run: Annotated[bool, Query()] = False,
) -> Response:
    """Upload a downloaded statement (the request body, at most 2 MiB): OFX/QFX, a CSV in the
    layout of the account's bank, or a CSV with the headers date, description and amount (or debit
    and credit). All or nothing; lines already there are counted as `duplicates` and left alone,
    so a file can be loaded again. `dry_run` only reads it (check `money_in`, `money_out` and the
    dates against the bank's own statement first). `date_order=dmy|mdy` settles an ambiguous
    file. `apply_balance` sets the account's balance from the file's newest balance, unless a
    newer one is already set. An unrecognised layout is 422 `unknown_layout`."""
    require_file_type(request)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise AppError(413, "payload_too_large", "The file is too large")
    result, clean = await manual.import_statement(
        session, account_id, bytes(data), clock(), zone, date_order, apply_balance, dry_run
    )
    return JSONResponse(result.model_dump(mode="json"), status_code=200 if clean else 422)
