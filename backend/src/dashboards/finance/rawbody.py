"""The two routes that take a file as the request body (a CSV of payments, a bank statement).

A plain HTML form can post a body of three kinds only, `application/x-www-form-urlencoded`,
`multipart/form-data` and `text/plain`; a file sent on purpose is `text/csv`,
`application/octet-stream` or the like. Refusing those three is one more barrier against a page
that makes the owner's browser post a file (the gate refuses such a request on the proxy-trust
path as well).
"""

from fastapi import Request

from src.core.errors import AppError

FORM_TYPES = frozenset({"application/x-www-form-urlencoded", "multipart/form-data", "text/plain"})


def require_file_type(request: Request) -> None:
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media in FORM_TYPES:
        raise AppError(
            415, "unsupported_media_type", "Send the file as text/csv or application/octet-stream"
        )
