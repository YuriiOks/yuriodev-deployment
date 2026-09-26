"""X-Request-ID and the access log line (no IP, no user agent, no query string)."""

import json
import re

import pytest
from starlette.datastructures import Headers

from src.core.middleware import _request_id_from


def access_lines(output):
    lines = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
    return [line for line in lines if line.get("event") == "http.request"]


def test_request_id_is_generated(client):
    request_id = client.get("/api/health").headers["x-request-id"]

    assert re.fullmatch(r"[0-9a-f]{32}", request_id)


def test_a_well_formed_incoming_request_id_is_echoed(client):
    response = client.get("/api/health", headers={"X-Request-ID": "edge-1234-abcd"})

    assert response.headers["x-request-id"] == "edge-1234-abcd"


@pytest.mark.parametrize("bad", ["short", "has space in it", "x" * 65, "semi;colon-12345"])
def test_a_malformed_incoming_request_id_is_replaced(client, bad):
    response = client.get("/api/health", headers={"X-Request-ID": bad})

    assert response.headers["x-request-id"] != bad
    assert re.fullmatch(r"[0-9a-f]{32}", response.headers["x-request-id"])


def test_a_trailing_newline_does_not_pass_the_request_id_check():
    # `$` would accept "abcdefgh\n"; the value is echoed into a header and the error body.
    assert _request_id_from(Headers({"x-request-id": "abcdefgh\n"})) != "abcdefgh\n"
    assert _request_id_from(Headers({"x-request-id": "abcdefgh"})) == "abcdefgh"


def test_the_access_line_is_ascii_and_escapes_control_and_bidi_characters(make_client, capsys):
    client = make_client(log_level="INFO", log_format="json")
    capsys.readouterr()

    client.get("/api/%0Ainjected%E2%80%AEevil%1B[31m")

    out = capsys.readouterr().out
    assert out.isascii()
    assert "\x1b" not in out
    (line,) = access_lines(out)
    assert line["path"] == "/api/\ninjected\u202eevil\x1b[31m"


def test_one_access_line_without_ip_user_agent_or_query(make_client, capsys):
    client = make_client(log_level="INFO", log_format="json")
    capsys.readouterr()

    response = client.get(
        "/api/health?token=query-secret",
        headers={"User-Agent": "ua-probe/1.0", "CF-Ray": "8c1a2b3c4d5e6f70-LHR"},
    )

    out = capsys.readouterr().out
    lines = access_lines(out)
    assert len(lines) == 1
    line = lines[0]
    assert line["level"] == "INFO"
    assert line["logger"] == "yuriodev.access"
    assert line["method"] == "GET"
    assert line["path"] == "/api/health"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], float)
    assert line["request_id"] == response.headers["x-request-id"]
    assert line["cf_ray"] == "8c1a2b3c4d5e6f70-LHR"
    for leaked in ("query-secret", "token=", "ua-probe", "testclient", "127.0.0.1"):
        assert leaked not in out


def test_container_healthcheck_path_logs_only_at_debug(make_client, capsys):
    make_client(log_level="INFO").get("/health")
    assert access_lines(capsys.readouterr().out) == []

    make_client(log_level="DEBUG").get("/health")
    lines = access_lines(capsys.readouterr().out)
    assert [line["level"] for line in lines] == ["DEBUG"]


def test_server_errors_log_at_error(make_settings, capsys):
    from fastapi.testclient import TestClient

    from src.app import create_app

    app = create_app(make_settings(log_level="INFO"))

    @app.get("/api/boom")
    async def boom() -> None:
        raise RuntimeError("boom")

    with TestClient(app) as client:
        client.get("/api/boom", headers={"CF-Ray": "not a valid ray!"})

    lines = access_lines(capsys.readouterr().out)
    assert [(line["level"], line["status"]) for line in lines] == [("ERROR", 500)]
    assert "cf_ray" not in lines[0]
