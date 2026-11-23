"""Read-only REST routes of the finance data, under /api/dashboards/v1/finance.

Behind the same gate as the rest of the dashboards API (`src/dashboards/gate.py`): token or
trusted proxy, `Cache-Control: no-store`, 503 while the API is off. There is no write endpoint:
bank data only ever arrives through the collector.
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from src.dashboards.finance import service
from src.dashboards.finance.schemas import (
    AccountOut,
    AccountsOut,
    ConnectionOut,
    FinanceSummaryOut,
    TransactionOut,
    TransactionsOut,
)
from src.routes.dashboards import ClockDep, SessionDep, ZoneDep

router = APIRouter(prefix="/api/dashboards/v1/finance", tags=["finance"])


@router.get("/accounts")
async def accounts(session: SessionDep) -> AccountsOut:
    """The accounts with their balances (open ones first) and the state of each bank link."""
    found, links = await service.list_accounts(session)
    return AccountsOut(
        accounts=[AccountOut.from_row(item) for item in found],
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
