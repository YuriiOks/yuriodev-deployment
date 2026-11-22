"""The gate in front of /api/dashboards/** and /api/mcp: switched off, authentication, no-store.

A pure-ASGI middleware, so it runs before request parsing and one implementation covers the REST
routes and the MCP endpoint. For every request under those paths it:

1. adds `Cache-Control: no-store` to the response, whoever produces it;
2. answers 503 `dashboards_disabled` when DATABASE_URL is not set (the bootstrap route is
   the exception: it reports `enabled: false` itself, without authentication);
3. answers 401 `unauthorized` unless the caller is authenticated: either
   DASHBOARDS_TRUST_PROXY_AUTH=true (dev and stage: nginx basic auth already ran), or the
   `X-Dashboards-Token` header equals DASHBOARDS_API_TOKEN. With neither configured every
   request is refused (closed by default). The header is not `Authorization`, which basic
   auth owns on dev and stage.
"""

import hashlib
import hmac

from pydantic import SecretStr
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.core.config import Settings
from src.core.errors import error_response

ACCESS_HEADER = "X-Dashboards-Token"  # named for the value it carries, a shared secret
BOOTSTRAP_PATH = "/api/dashboards/v1/bootstrap"
MCP_PATH = "/api/mcp"
_GATED = ("/api/dashboards", MCP_PATH)


def covers(path: str) -> bool:
    """Whether the gate applies to this path."""
    return any(path == base or path.startswith(base + "/") for base in _GATED)


def token_matches(expected: SecretStr | None, provided: str | None) -> bool:
    """Constant-time comparison. Both sides are hashed first, so neither a different length nor
    a non-ASCII value changes the work done."""
    if expected is None or provided is None:
        return False
    try:
        # Starlette decodes header bytes as latin-1; this restores the bytes the client sent.
        raw = provided.encode("latin-1")
    except UnicodeEncodeError:
        return False
    wanted = hashlib.sha256(expected.get_secret_value().encode()).digest()
    return hmac.compare_digest(wanted, hashlib.sha256(raw).digest())


def is_authenticated(settings: Settings, headers: Headers) -> bool:
    if settings.dashboards_trust_proxy_auth:
        return True
    return token_matches(settings.dashboards_api_token, headers.get(ACCESS_HEADER))


class DashboardsGate:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not covers(str(scope.get("path", ""))):
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        path = str(scope["path"])
        settings = self.settings
        if not settings.dashboards_enabled and path != BOOTSTRAP_PATH:
            response = error_response(503, "dashboards_disabled", "Dashboards are not enabled")
            await response(scope, receive, send_no_store)
            return
        if settings.dashboards_enabled and not is_authenticated(settings, Headers(scope=scope)):
            response = error_response(401, "unauthorized", "Unauthorized")
            await response(scope, receive, send_no_store)
            return
        await self.app(scope, receive, send_no_store)
