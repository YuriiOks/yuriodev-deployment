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
   auth owns on dev and stage;
4. on the proxy-trust path only, refuses (403 `cross_site`) a request that changes something
   (not GET, HEAD or OPTIONS) when the browser says another site sent it: `Sec-Fetch-Site` is
   anything but `same-origin` or `none`, or an `Origin` is present that is not this site
   (DASHBOARDS_PUBLIC_BASE_URL when set, else the request's own host). The browser attaches the
   cached basic-auth credentials to a form posted from any page, so without this a page the
   owner visits could post to the API. A request that carries the token header proves it was
   not a plain form and is not checked.
"""

import hashlib
import hmac
from urllib.parse import urlsplit

from pydantic import SecretStr
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.core.config import Settings
from src.core.errors import error_response

ACCESS_HEADER = "X-Dashboards-Token"  # named for the value it carries, a shared secret
BOOTSTRAP_PATH = "/api/dashboards/v1/bootstrap"
MCP_PATH = "/api/mcp"
_GATED = ("/api/dashboards", MCP_PATH)
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


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


def cross_site(settings: Settings, headers: Headers) -> bool:
    """Did the browser send this on behalf of another site? Absent headers (a script, curl) say
    nothing: those clients are not what the check is for."""
    site = headers.get("sec-fetch-site")
    if site is not None and site not in ("same-origin", "none"):
        return True
    origin = headers.get("origin")
    if origin is None:
        return False
    base = settings.public_base_url
    if base is not None:
        return origin.rstrip("/") != base
    return urlsplit(origin).netloc != headers.get("host", "")


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
        if (
            settings.dashboards_enabled
            and settings.dashboards_trust_proxy_auth
            and scope["method"] not in SAFE_METHODS
        ):
            headers = Headers(scope=scope)
            proves = token_matches(settings.dashboards_api_token, headers.get(ACCESS_HEADER))
            if not proves and cross_site(settings, headers):
                response = error_response(403, "cross_site", "Cross-site request refused")
                await response(scope, receive, send_no_store)
                return
        await self.app(scope, receive, send_no_store)
