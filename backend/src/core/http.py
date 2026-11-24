"""The one outbound HTTP path: a shared client with fixed timeouts and a capped JSON reader.

- One `httpx.AsyncClient` per process, created in the app lifespan and closed on shutdown.
- No credentials on the client: auth headers are passed per request, so a call to another
  host can never carry a provider's key.
- Redirects are never followed, proxy settings from the environment are ignored, and every
  error is reduced to a `kind` that carries no URL, header or body text; the underlying
  exception is not chained, since an httpx error message can quote a request header.
- Bodies are asked for uncompressed. If a server compresses anyway (gzip or deflate), the body
  is inflated here in bounded steps, so a compression bomb costs at most the cap in memory;
  any other encoding is refused.
- An address the owner typed (a payment's website or icon) is fetched only through
  `get_public`: the name is resolved here, every address must be a public one, and the request
  goes to that checked address (the name stays in the Host header and the TLS server name), so
  nothing can be re-resolved to an inside address between the check and the connection.
"""

import asyncio
import ipaddress
import json
import re
import socket
import zlib
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import SplitResult, urlsplit

import httpx

from src.core.config import Settings

MAX_BODY_BYTES = 2 * 1024 * 1024
TOTAL_DEADLINE_SECONDS = 20.0
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
LIMITS = httpx.Limits(max_connections=4, max_keepalive_connections=2)


class UpstreamError(Exception):
    """A failed upstream call.

    `kind` is one of: timeout, connect, http_5xx, rate_limited, auth, not_found, bad_status,
    bad_content_type, bad_encoding, too_large, bad_json. The exception message is the kind only.
    """

    def __init__(
        self,
        kind: str,
        status: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(kind)
        self.kind = kind
        self.status = status
        self.headers: dict[str, str] = {k.lower(): v for k, v in (headers or {}).items()}


def classify(status: int) -> str:
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    if status >= 500:
        return "http_5xx"
    return "bad_status"


def user_agent(settings: Settings) -> str:
    return f"yuriodev-backend/{settings.revision[:12]} (+https://yuriodev.co.uk)"


@asynccontextmanager
async def build_http_client(
    settings: Settings,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """The shared client. `transport` is for tests (httpx.MockTransport)."""
    async with httpx.AsyncClient(
        timeout=TIMEOUT,
        limits=LIMITS,
        follow_redirects=False,
        trust_env=False,
        headers={
            "User-Agent": user_agent(settings),
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        },
        transport=transport,
    ) as client:
        yield client


async def get_json_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """GET `url` and parse a JSON body of at most `max_bytes`; raise UpstreamError otherwise."""
    return await request_json_capped(
        client, "GET", url, headers=headers, params=params, max_bytes=max_bytes, deadline=deadline
    )


async def post_json_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    json_body: Any,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """POST a JSON body to `url`; the answer is read exactly as `get_json_capped` reads it."""
    return await request_json_capped(
        client,
        "POST",
        url,
        headers=headers,
        json_body=json_body,
        max_bytes=max_bytes,
        deadline=deadline,
    )


async def post_form_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    form: Mapping[str, str],
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """POST a form-encoded body (OAuth token requests); the answer is read like `get_json_capped`.
    The form may hold a secret: it is never part of an error or a log line."""
    return await request_json_capped(
        client,
        "POST",
        url,
        headers=headers,
        form=form,
        max_bytes=max_bytes,
        deadline=deadline,
    )


def is_json(media_type: str) -> bool:
    return media_type.endswith("json")


CALENDAR_TYPES = ("text/calendar", "application/ics", "application/octet-stream", "text/plain")


def is_calendar(media_type: str) -> bool:
    return media_type in CALENDAR_TYPES


async def request_json_capped(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    json_body: Any = None,
    form: Mapping[str, str] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """Send the request and parse a 200 JSON body of at most `max_bytes`; raise UpstreamError
    otherwise."""
    _, body, response_headers = await request_capped(
        client,
        method,
        url,
        headers=headers,
        params=params,
        json_body=json_body,
        form=form,
        max_bytes=max_bytes,
        deadline=deadline,
        accepts=is_json,
    )
    try:
        return json.loads(body), response_headers
    except ValueError:  # json.JSONDecodeError and UnicodeDecodeError
        raise UpstreamError("bad_json", 200) from None


async def request_capped(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    json_body: Any = None,
    form: Mapping[str, str] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
    accepts: Callable[[str], bool] = is_json,
    not_modified_ok: bool = False,
    extensions: Mapping[str, Any] | None = None,
) -> tuple[int, bytes, httpx.Headers]:
    """Send the request and return (status, body, headers) of a 200 answer whose media type
    `accepts` and whose body is at most `max_bytes`; raise UpstreamError otherwise.

    With `not_modified_ok` a 304 is returned as (304, b"", headers) instead of failing, for
    conditional requests."""
    kind: str
    status: int | None
    try:
        async with (
            asyncio.timeout(deadline),
            client.stream(
                method,
                url,
                headers=headers,
                params=params,
                json=json_body,
                data=form,
                extensions=dict(extensions) if extensions else None,
            ) as response,
        ):
            if response.status_code == 304 and not_modified_ok:
                return 304, b"", response.headers
            if response.status_code != 200:
                raise UpstreamError(
                    classify(response.status_code), response.status_code, response.headers
                )
            media_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if not accepts(media_type):
                raise UpstreamError("bad_content_type", 200)
            inflater = _inflater(response.headers.get("content-encoding", ""))
            body = bytearray()
            received = 0
            async for chunk in response.aiter_raw():  # raw: decoded here, never by httpx
                received += len(chunk)
                if inflater is None:
                    body += chunk
                else:
                    # At most one byte past the cap per step; the rest waits in unconsumed_tail.
                    body += inflater.decompress(chunk, max_bytes + 1 - len(body))
                if (
                    received > max_bytes
                    or len(body) > max_bytes
                    or (inflater is not None and inflater.unconsumed_tail)
                ):
                    raise UpstreamError("too_large", 200)
            if inflater is not None:
                body += inflater.flush()  # all input is consumed: at most a few bytes remain
            if len(body) > max_bytes:
                raise UpstreamError("too_large", 200)
            return 200, bytes(body), response.headers
    except UpstreamError:
        raise
    except TimeoutError, httpx.TimeoutException:
        kind, status = "timeout", None
    except httpx.HTTPError:  # transport and protocol errors; the message may quote a header
        kind, status = "connect", None
    except zlib.error:
        kind, status = "bad_encoding", 200
    # Raised outside the handler, so the original exception is neither chained nor kept as
    # context: nothing that quotes a request header stays reachable from the error.
    raise UpstreamError(kind, status)


def _inflater(content_encoding: str) -> zlib._Decompress | None:
    """A bounded decompressor for the response's Content-Encoding; None for an identity body."""
    encoding = content_encoding.strip().lower()
    if encoding in ("", "identity"):
        return None
    if encoding in ("gzip", "x-gzip"):
        return zlib.decompressobj(zlib.MAX_WBITS | 16)
    if encoding == "deflate":
        return zlib.decompressobj()
    raise UpstreamError("bad_encoding", 200)


# ---- addresses the owner typed ----------------------------------------------------------------

Resolver = Callable[[str], Awaitable[list[str]]]
# A DNS name with at least two labels (so not `localhost` or an intranet name), letters, digits
# and hyphens only, at most 253 characters.
HOST_NAME = re.compile(
    r"(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+"
)


async def resolve_host(host: str) -> list[str]:
    """Every address the name has (IPv4 and IPv6) for https."""
    found = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return sorted({str(item[4][0]) for item in found})


def public_address(text: str) -> bool:
    """A globally routable address: not loopback, private, link-local (the cloud metadata
    address), CGNAT, multicast, reserved or unspecified; an IPv4 address inside IPv6 must be
    public too."""
    try:
        address = ipaddress.ip_address(text.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        for inner in (address.ipv4_mapped, address.sixtofour, getattr(address, "teredo", None)):
            if isinstance(inner, ipaddress.IPv4Address) and not inner.is_global:
                return False
            if isinstance(inner, tuple) and not all(a.is_global for a in inner):
                return False
    return address.is_global and not address.is_multicast


def public_host(url: str) -> tuple[str, SplitResult] | None:
    """The normalised host of an https URL that may be fetched, or None: https only, no
    credentials, port 443 only, a name (lower-case, no trailing dot, IDNA) or a public IP
    literal."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or not host or parts.username is not None or parts.password:
        return None
    if port not in (None, 443):
        return None
    host = host.rstrip(".").lower()
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            return None
        if HOST_NAME.fullmatch(host) is None:
            return None
        return host, parts
    return (host, parts) if public_address(str(address)) else None


async def get_public(
    client: httpx.AsyncClient,
    url: str,
    *,
    resolver: Resolver = resolve_host,
    headers: Mapping[str, str] | None = None,
    max_bytes: int,
    accepts: Callable[[str], bool],
    deadline: float = 6.0,
) -> tuple[bytes, httpx.Headers]:
    """One GET of an address the owner typed. The name is resolved here; every address it has must
    be public (else UpstreamError "blocked"); the request is sent to the first one, with the name
    as Host and TLS server name. No redirect is followed (a 3xx is an error carrying its
    `location`), no cookie or credential is sent, and nothing is logged."""
    checked = public_host(url)
    if checked is None:
        raise UpstreamError("blocked")
    host, parts = checked
    try:
        ipaddress.ip_address(host)
        found = [host]  # an address, already checked by public_host
    except ValueError:
        try:
            found = await resolver(host)
        except OSError:
            raise UpstreamError("connect") from None
    if not found or not all(public_address(address) for address in found):
        raise UpstreamError("blocked")
    address = found[0]
    netloc = f"[{address}]" if ":" in address else address
    path = parts.path or "/"
    target = f"https://{netloc}{path}" + (f"?{parts.query}" if parts.query else "")
    _, body, answer = await request_capped(
        client,
        "GET",
        target,
        headers={**(headers or {}), "Host": host},
        max_bytes=max_bytes,
        deadline=deadline,
        accepts=accepts,
        extensions={"sni_hostname": host},
    )
    return body, answer
