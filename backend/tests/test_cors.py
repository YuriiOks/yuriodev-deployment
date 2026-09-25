"""CORS: only when CORS_ORIGINS lists origins, never with credentials."""

ALLOWED = "https://allowed.example"


def preflight(client, origin, method="GET"):
    return client.options(
        "/api/health",
        headers={"Origin": origin, "Access-Control-Request-Method": method},
    )


def test_preflight_allows_a_configured_origin(make_client):
    response = preflight(make_client(cors_origins=[ALLOWED]), ALLOWED)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED
    assert "access-control-allow-credentials" not in response.headers
    allowed_methods = response.headers["access-control-allow-methods"]
    assert "GET" in allowed_methods
    assert "POST" not in allowed_methods


def test_simple_request_from_a_configured_origin_gets_the_header(make_client):
    response = make_client(cors_origins=[ALLOWED]).get("/api/health", headers={"Origin": ALLOWED})

    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_preflight_denies_a_foreign_origin(make_client):
    response = preflight(make_client(cors_origins=[ALLOWED]), "https://evil.example")

    assert "access-control-allow-origin" not in response.headers


def test_preflight_denies_an_unsafe_method(make_client):
    response = preflight(make_client(cors_origins=[ALLOWED]), ALLOWED, method="POST")

    assert response.status_code == 400


def test_no_cors_middleware_without_origins(make_client):
    client = make_client()

    response = preflight(client, ALLOWED)
    assert response.status_code == 405
    assert "access-control-allow-origin" not in response.headers
    simple = client.get("/api/health", headers={"Origin": ALLOWED})
    assert "access-control-allow-origin" not in simple.headers
    assert "vary" not in simple.headers
