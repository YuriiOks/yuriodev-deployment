"""The finance tools of the MCP endpoint: read-only, compact JSON text like the other tools.

Amounts are integers in minor units (1250 is 12.50) next to an ISO 4217 code, signed: money out is
negative. Registered by `src.dashboards.mcp_server.build_mcp_server`, which owns the session and
error handling (`scope`): a failure is a `ToolError` with a fixed sentence, never with input.
"""

import json
import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.ext.asyncio import AsyncSession

from src.dashboards.finance import service
from src.dashboards.finance.schemas import AccountOut, ConnectionOut, TransactionOut

type Scope = Callable[[str], AbstractAsyncContextManager[tuple[AsyncSession, datetime]]]

INSTRUCTIONS = (
    " Read-only bank data (finance): accounts with balances, this month's totals and a "
    "transaction search. Amounts are integers in minor units (1250 is 12.50) with an ISO 4217 "
    "currency, signed: money out is negative."
)


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def register(server: MCPServer[Any], scope: Scope, zone: ZoneInfo) -> None:
    @server.tool(structured_output=False)
    async def finance_accounts() -> str:
        """List the bank accounts with their balance (minor units), currency, last four digits,
        and the status of each bank link (ok, needs_reconsent or paused)."""
        async with scope("finance_accounts") as (session, _):
            accounts, links, oldest = await service.list_accounts(session)
            return _json(
                {
                    "accounts": [
                        AccountOut.from_row(a, oldest.get(a.id)).model_dump(mode="json")
                        for a in accounts
                    ],
                    "connections": [
                        ConnectionOut.model_validate(c).model_dump(mode="json") for c in links
                    ],
                }
            )

    @server.tool(structured_output=False)
    async def finance_balances() -> str:
        """Per currency: the total balance of the open accounts and the money spent and received
        this month (in the configured time zone), all in minor units."""
        async with scope("finance_balances") as (session, now):
            summary = await service.summary(session, now, zone)
            return _json(summary.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_transactions(
        query: str | None = None,
        account: str | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        min_amount: int | None = None,
        max_amount: int | None = None,
        limit: int = service.DEFAULT_LIMIT,
        cursor: str | None = None,
    ) -> str:
        """Search transactions, newest first. query is a case-insensitive text found in the
        description or the counterparty; account is an account id from finance_accounts;
        from_date and to_date are YYYY-MM-DD (both days included); min_amount and max_amount
        are signed minor units (money out is negative, so max_amount=-5000 finds payments of 50
        or more). limit is 1 to 200; pass the returned next_cursor to get the next page."""
        try:
            account_id = uuid.UUID(account) if account else None
        except ValueError:
            raise ToolError("Invalid account id") from None
        flt = service.TransactionFilter(
            account_id, from_date, to_date, query, min_amount, max_amount
        )
        async with scope("finance_transactions") as (session, _):
            rows, next_cursor = await service.list_transactions(session, flt, zone, limit, cursor)
            return _json(
                {
                    "transactions": [
                        TransactionOut.model_validate(r).model_dump(mode="json") for r in rows
                    ],
                    "next_cursor": next_cursor,
                }
            )
