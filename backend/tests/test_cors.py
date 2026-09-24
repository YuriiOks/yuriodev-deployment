# Website API Tests - CORS preflight behaviour
# File: tests/test_cors.py
#
# The allowed origins come from the environment (env/<env>.env: CORS_ORIGINS),
# so the "allowed" case uses whatever the app was configured with; this keeps the
# suite valid in CI (code defaults) and inside the local/dev containers alike.

from src.core.config import settings


def test_preflight_allows_configured_origin(client):
    origin = settings.cors_origins[0]
    response = client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == origin


def test_preflight_denies_foreign_origin(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers
