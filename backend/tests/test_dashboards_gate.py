"""The gate in front of /api/dashboards/** and /api/mcp: off, closed by default, two-way auth.

None of these tests needs a database: authentication is decided before any query, and an
enabled app whose database is unreachable answers 503 `dashboards_unavailable`.
"""

from pydantic import SecretStr

from src.dashboards.gate import ACCESS_HEADER, covers, token_matches
from tests.dashboards_support import AUTH, CRED, UNREACHABLE_URL

SUMMARY = "/api/dashboards/v1/summary"
BOOTSTRAP = "/api/dashboards/v1/bootstrap"
MCP_JSON = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


def error_of(response):
    body = response.json()
    assert set(body) - {"fields", "issues", "reason"} == {"error", "message", "request_id"}
    assert body["request_id"]
    return body["error"]


def test_off_by_default_bootstrap_says_disabled_without_authentication(client):
    response = client.get(BOOTSTRAP)

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["spaces"] == []
    assert body["areas"] == []
    assert body["server_time"].endswith("Z")
    assert response.headers["cache-control"] == "no-store"


def test_off_by_default_everything_else_is_503_dashboards_disabled(client):
    for method, path in (
        ("GET", SUMMARY),
        ("GET", "/api/dashboards/v1/spaces/personal/tasks"),
        ("POST", "/api/dashboards/v1/spaces/personal/tasks"),
        ("DELETE", "/api/dashboards/v1/tasks/x"),
        ("GET", "/api/dashboards/v1/nothing-here"),
        ("POST", "/api/mcp"),
    ):
        response = client.request(method, path, headers=AUTH)

        assert response.status_code == 503, (method, path)
        assert error_of(response) == "dashboards_disabled"
        assert response.headers["cache-control"] == "no-store"


def test_enabled_but_no_token_and_no_trusted_proxy_refuses_everything(make_client):
    client = make_client(database_url=UNREACHABLE_URL)

    for path in (BOOTSTRAP, SUMMARY, "/api/dashboards/v1/nothing-here"):
        for headers in ({}, AUTH, {ACCESS_HEADER: ""}):
            response = client.get(path, headers=headers)

            assert response.status_code == 401, (path, headers)
            assert error_of(response) == "unauthorized"
            assert response.headers["cache-control"] == "no-store"
    assert client.post("/api/mcp", headers=AUTH).status_code == 401


def test_the_token_header_is_the_way_in(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_api_token=CRED)

    wrong = client.get(SUMMARY, headers={ACCESS_HEADER: CRED + "x"})
    missing = client.get(SUMMARY)
    bearer = client.get(SUMMARY, headers={"Authorization": f"Bearer {CRED}"})
    right = client.get(SUMMARY, headers=AUTH)

    assert [wrong.status_code, missing.status_code, bearer.status_code] == [401, 401, 401]
    # Past the gate; the database does not answer, so the API itself says so.
    assert right.status_code == 503
    assert error_of(right) == "dashboards_unavailable"
    assert right.headers["cache-control"] == "no-store"


def test_a_trusted_proxy_needs_no_token(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    response = client.get(SUMMARY)

    assert response.status_code == 503
    assert error_of(response) == "dashboards_unavailable"
    assert client.get(BOOTSTRAP).status_code == 503


def test_no_store_also_covers_404_and_405_but_not_other_routes(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_trust_proxy_auth=True)

    assert client.get("/api/dashboards/v1/nothing-here").status_code == 404
    assert client.get("/api/dashboards/v1/nothing-here").headers["cache-control"] == "no-store"
    assert client.get("/api/mcp").status_code == 405
    assert client.get("/api/mcp").headers["cache-control"] == "no-store"
    assert "cache-control" not in client.get("/api/health").headers


def test_mcp_needs_the_same_authentication(make_client):
    client = make_client(database_url=UNREACHABLE_URL, dashboards_api_token=CRED)

    refused = client.post("/api/mcp", json=MCP_JSON, headers=MCP_HEADERS)
    not_ready = client.post("/api/mcp", json=MCP_JSON, headers={**MCP_HEADERS, **AUTH})

    assert refused.status_code == 401
    assert error_of(refused) == "unauthorized"
    assert not_ready.status_code == 503
    assert error_of(not_ready) == "dashboards_unavailable"


def test_a_cors_preflight_is_answered_before_the_gate(make_client):
    origin = "https://dev.example"
    client = make_client(database_url=UNREACHABLE_URL, cors_origins=[origin])

    response = client.options(
        SUMMARY, headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_covers_only_the_dashboards_and_mcp_paths():
    assert covers("/api/dashboards/v1/summary")
    assert covers("/api/dashboards")
    assert covers("/api/mcp")
    assert covers("/api/mcp/")
    assert not covers("/api/health")
    assert not covers("/api/dashboardsx")
    assert not covers("/api/mcpx")


def test_token_matches_compares_the_whole_value():
    secret = SecretStr(CRED)

    assert token_matches(secret, CRED)
    assert not token_matches(secret, CRED[:-1])
    assert not token_matches(secret, CRED + "0")
    assert not token_matches(secret, "")
    assert not token_matches(secret, None)
    assert not token_matches(None, CRED)
    assert not token_matches(None, None)
    assert not token_matches(secret, "€")  # not representable as header bytes
