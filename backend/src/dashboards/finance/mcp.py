"""The finance tools of the MCP endpoint: compact JSON text like the other tools. Read-only
towards the banks; the one write is the owner's category for a transaction, a note on our copy.

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
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from src.dashboards.finance import manual, recurring_service, service
from src.dashboards.finance.manual import AccountIn, BalanceIn, ConnectionIn, ManualAccountPatch
from src.dashboards.finance.recurring import RecurringIn, RecurringPatch
from src.dashboards.finance.recurring_schemas import RecurringOut
from src.dashboards.finance.schemas import (
    AccountOut,
    ConnectionOut,
    DisplayOut,
    TransactionOut,
    display_fields,
)

type Scope = Callable[[str], AbstractAsyncContextManager[tuple[AsyncSession, datetime]]]

INSTRUCTIONS = (
    " Read-only bank data (finance): accounts with balances, this month's totals and a "
    "transaction search. Amounts are integers in minor units (1250 is 12.50) with an ISO 4217 "
    "currency, signed: money out is negative. Recurring payments (finance_recurring, "
    "finance_upcoming, finance_attention) are the owner's own notes: a payment is a positive "
    "amount in minor units."
)


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def register(
    server: MCPServer[Any], scope: Scope, zone: ZoneInfo, display_currency: str = "GBP"
) -> None:
    @server.tool(structured_output=False)
    async def finance_accounts() -> str:
        """List the bank accounts with their balance (minor units), currency, last four digits,
        and the status of each bank link (ok, needs_reconsent or paused)."""
        async with scope("finance_accounts") as (session, now):
            display = await service.display_for(session, display_currency, now)
            accounts, links, oldest = await service.list_accounts(session)
            shown = DisplayOut(**display_fields(display, {a.currency for a in accounts}))
            return _json(
                {
                    "display": shown.model_dump(mode="json"),
                    "accounts": [
                        AccountOut.from_row(a, oldest.get(a.id), display).model_dump(mode="json")
                        for a in accounts
                    ],
                    "connections": [
                        ConnectionOut.from_row(c, now).model_dump(mode="json") for c in links
                    ],
                }
            )

    @server.tool(structured_output=False)
    async def finance_balances() -> str:
        """Per currency: the total balance of the open accounts and the money spent and received
        this month (in the configured time zone), all in minor units."""
        async with scope("finance_balances") as (session, now):
            display = await service.display_for(session, display_currency, now)
            summary = await service.summary(session, now, zone, display)
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
        category: str | None = None,
        provider: str | None = None,
    ) -> str:
        """Search transactions, newest first. provider (such as monobank) limits them to that
        provider's accounts. query is a case-insensitive text found in the
        description or the counterparty; account is an account id from finance_accounts;
        from_date and to_date are YYYY-MM-DD (both days included); min_amount and max_amount
        are signed minor units (money out is negative, so max_amount=-5000 finds payments of 50
        or more). category is one of the fixed set (see finance_categories). limit is 1 to 200; pass
        the returned next_cursor to get the next page."""
        try:
            account_id = uuid.UUID(account) if account else None
        except ValueError:
            raise ToolError("Invalid account id") from None
        flt = service.TransactionFilter(
            account_id,
            from_date,
            to_date,
            query,
            min_amount,
            max_amount,
            category,
            provider=provider,
        )
        async with scope("finance_transactions") as (session, now):
            rows, next_cursor = await service.list_transactions(session, flt, zone, limit, cursor)
            display = await service.display_for(session, display_currency, now)
            return _json(
                {
                    "display": DisplayOut(
                        **display_fields(display, {r.currency for r in rows})
                    ).model_dump(mode="json"),
                    "transactions": [
                        TransactionOut.from_row(r, display).model_dump(mode="json") for r in rows
                    ],
                    "next_cursor": next_cursor,
                }
            )

    @server.tool(structured_output=False)
    async def finance_set_overdraft(account: str, limit_minor: int | None = None) -> str:
        """Set the owner's overdraft limit of an account (an id from finance_accounts) in minor
        units (1000 is 10.00), or clear it by passing no limit. It wins over a limit the bank
        sends and no collector overwrites it; nothing is sent to a bank."""
        try:
            account_id = uuid.UUID(account)
        except ValueError:
            raise ToolError("Invalid account id") from None
        async with scope("finance_set_overdraft") as (session, now):
            row, oldest = await service.set_overdraft(session, account_id, limit_minor)
            display = await service.display_for(session, display_currency, now)
            return _json(AccountOut.from_row(row, oldest, display).model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_categories(month: str | None = None) -> str:
        """Money out per currency and category for a month (YYYY-MM, default this month) with the
        month before beside it, in minor units. Transfers between the owner's own accounts and
        pots, declined payments and money in are left out. The categories: housing_utilities,
        groceries, eating_out, transport, subscriptions, health, shopping, entertainment, debt,
        income, transfers, cash, other."""
        async with scope("finance_categories") as (session, now):
            display = await service.display_for(session, display_currency, now)
            report = await service.categories_report(session, month, now, zone, display)
            return _json(report.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_set_category(id: str, category: str | None = None) -> str:
        """Set the owner's category for one transaction (an id from finance_transactions), or
        clear it by passing no category. It changes our copy only, nothing is sent to a bank."""
        try:
            transaction_id = uuid.UUID(id)
        except ValueError:
            raise ToolError("Invalid transaction id") from None
        async with scope("finance_set_category") as (session, now):
            row = await service.set_category(session, transaction_id, category)
            display = await service.display_for(session, display_currency, now)
            return _json(TransactionOut.from_row(row, display).model_dump(mode="json"))

    def _bad_fields(exc: ValidationError) -> ToolError:
        names = sorted({str(p["loc"][0]) for p in exc.errors() if p.get("loc")})
        return ToolError("Invalid fields: " + ", ".join(names) if names else "Invalid payment")

    @server.tool(structured_output=False)
    async def finance_recurring(active_only: bool = True) -> str:
        """List the owner's recurring payments (subscriptions, debts, utilities, insurance,
        housing, services, one-offs): amount in minor units with its currency, cadence, the next
        date, the paying account or free-text source, debts' balances, and each amount also in the
        display currency."""
        async with scope("finance_recurring") as (session, now):
            today = now.astimezone(zone).date()
            display = await service.display_for(session, display_currency, now)
            only = True if active_only else None
            rows = await recurring_service.list_recurring(session, now, zone, only)
            shown = DisplayOut(**display_fields(display, {r.currency for r in rows}))
            listed = [RecurringOut.from_row(r, display, today) for r in rows]
            return _json(
                {
                    "display": shown.model_dump(mode="json"),
                    "recurring": [item.model_dump(mode="json") for item in listed],
                }
            )

    @server.tool(structured_output=False)
    async def finance_add_recurring(payment: dict[str, Any]) -> str:
        """Add a recurring payment. Required: name, amount (positive, minor units: 1250 is
        12.50) and currency (ISO code). Optional: kind (subscription, debt, utility, insurance,
        housing, service, one_time), frequency (once, daily, weekly, monthly, yearly),
        frequency_interval, start_date and next_payment_date (YYYY-MM-DD), account_id (an id from
        finance_accounts), payment_method (free text), notes, reminder_days, match_text (what its
        bank text contains), icon_url (https) or website (a host such as example.com: its own icon
        is fetched), color (#rrggbb), is_active, and for debts
        is_installment, total_installments, completed_installments, total_owed,
        remaining_balance, creditor."""
        try:
            data = RecurringIn.model_validate(payment)
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_add_recurring") as (session, now):
            today = now.astimezone(zone).date()
            row = await recurring_service.create_recurring(session, data, now, today)
            display = await service.display_for(session, display_currency, now)
            return _json(RecurringOut.from_row(row, display, today).model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_update_recurring(recurring_id: str, changes: dict[str, Any]) -> str:
        """Change fields of a recurring payment (an id from finance_recurring); `changes` has
        the fields of finance_add_recurring to set, and null clears one that may be empty."""
        try:
            payment_id = uuid.UUID(recurring_id)
        except ValueError:
            raise ToolError("Invalid payment id") from None
        try:
            patch = RecurringPatch.model_validate(changes)
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_update_recurring") as (session, now):
            today = now.astimezone(zone).date()
            row = await recurring_service.update_recurring(session, payment_id, patch, now)
            display = await service.display_for(session, display_currency, now)
            return _json(RecurringOut.from_row(row, display, today).model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_upcoming(days: int = 14) -> str:
        """The recurring payments due from today to `days` days ahead (1 to 366), with whether
        the paying account covers each (its balance plus overdraft, counting the earlier ones),
        totals per currency and in the display currency."""
        async with scope("finance_upcoming") as (session, now):
            display = await service.display_for(session, display_currency, now)
            found = await recurring_service.upcoming(session, now, zone, display, days)
            return _json(found.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_attention(include_hidden: bool = False) -> str:
        """What needs a look now: a payment due soon that its account cannot cover, one past
        its date with no matching transaction, a charge that differs from the recorded amount,
        a credit card over 90% of its limit, an account past its overdraft, a bank connection
        that needs approving again. Dismissed and snoozed items are left out unless
        include_hidden; each item has a key (dismiss and snooze are on the REST API)."""
        async with scope("finance_attention") as (session, now):
            display = await service.display_for(session, display_currency, now)
            found = await recurring_service.attention(session, now, zone, display, include_hidden)
            return _json(found.model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_add_manual_connection(
        provider: str,
        display_name: str | None = None,
        brand_bg: str | None = None,
        brand_fg: str | None = None,
    ) -> str:
        """Add a bank that has no API, entered by hand. provider is a lower-case id (barclays,
        lloyds, aqua, revolut, wise, starling, paypal, or your own neutral id); display_name and
        the colours (#rrggbb pair with a contrast of 3:1) are for a bank that has no built-in
        brand. monobank and monzo are connected through their APIs and are refused."""
        try:
            data = ConnectionIn.model_validate(
                {
                    "provider": provider,
                    "display_name": display_name,
                    "brand_bg": brand_bg,
                    "brand_fg": brand_fg,
                }
            )
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_add_manual_connection") as (session, now):
            link = await manual.create_connection(session, data)
            return _json(ConnectionOut.from_row(link, now).model_dump(mode="json"))

    @server.tool(structured_output=False)
    async def finance_add_manual_account(account: dict[str, Any]) -> str:
        """Add an account to a manual connection (its id is in finance_accounts). Required:
        connection_id, name, currency (ISO code) and for a current, savings or business account
        balance (minor units, may be negative); for kind credit_card credit_limit and owed
        instead. Optional: kind (current, credit_card, savings, business), as_of (YYYY-MM-DD or a
        time with an offset, default now), mask_last4, label, type, opened_at, overdraft_limit."""
        try:
            data = AccountIn.model_validate(account)
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_add_manual_account") as (session, now):
            row = await manual.create_account(session, data, now, zone)
            return await _account_json(session, row.id, now)

    @server.tool(structured_output=False)
    async def finance_set_manual_balance(
        account: str,
        balance: int | None = None,
        owed: int | None = None,
        as_of: str | None = None,
    ) -> str:
        """Set the balance of an account entered by hand (minor units; a credit card takes owed,
        what is owed now, instead of balance), as of a day (YYYY-MM-DD) or a time with an offset;
        default now, never in the future."""
        try:
            account_id = uuid.UUID(account)
        except ValueError:
            raise ToolError("Invalid account id") from None
        try:
            data = BalanceIn.model_validate({"balance": balance, "owed": owed, "as_of": as_of})
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_set_manual_balance") as (session, now):
            await manual.set_balance(session, account_id, data, now, zone)
            return await _account_json(session, account_id, now)

    @server.tool(structured_output=False)
    async def finance_update_manual_account(account: str, changes: dict[str, Any]) -> str:
        """Change an account entered by hand: name, label, mask_last4, credit_limit (a credit
        card; what is owed stays), kind (a current account becomes a credit_card together with
        its credit_limit, and back), or archived (true hides it, false brings it back)."""
        try:
            account_id = uuid.UUID(account)
        except ValueError:
            raise ToolError("Invalid account id") from None
        try:
            patch = ManualAccountPatch.model_validate(changes)
        except ValidationError as exc:
            raise _bad_fields(exc) from None
        async with scope("finance_update_manual_account") as (session, now):
            await manual.update_account(session, account_id, patch, now)
            return await _account_json(session, account_id, now)

    async def _account_json(session: AsyncSession, account_id: uuid.UUID, now: datetime) -> str:
        row, oldest = await service.account_with_history(session, account_id)
        display = await service.display_for(session, display_currency, now)
        return _json(AccountOut.from_row(row, oldest, display).model_dump(mode="json"))
