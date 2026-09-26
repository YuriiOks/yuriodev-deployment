"""GET|HEAD /health and /api/health."""

import pytest

PATHS = ("/health", "/api/health")


@pytest.mark.parametrize("path", PATHS)
def test_get_returns_the_health_payload(client, path):
    response = client.get(path)

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "service": "yuriodev-api",
        "environment": "test",
        "revision": "abc1234",
    }


@pytest.mark.parametrize("path", PATHS)
def test_head_is_allowed(client, path):
    response = client.head(path)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"


def test_public_api_health_matches_internal_health(client):
    assert client.get("/api/health").json() == client.get("/health").json()


def test_environment_and_revision_default_to_unknown(make_client):
    body = make_client().get("/api/health").json()

    assert body["environment"] == "unknown"
    assert body["revision"] == "unknown"
