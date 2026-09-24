# Website API Tests - CORS preflight behaviour
# File: tests/test_cors.py


def test_preflight_allows_configured_origin(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "https://yuriodev.co.uk",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "https://yuriodev.co.uk"


def test_preflight_denies_foreign_origin(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers
