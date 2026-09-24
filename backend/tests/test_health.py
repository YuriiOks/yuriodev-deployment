# Website API Tests - /health endpoint
# File: tests/test_health.py

from src.core.config import settings


def test_health_check_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_check_reports_healthy_status(client):
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "healthy"


def test_health_check_reports_service_name(client):
    response = client.get("/health")
    body = response.json()
    assert body["service"] == "website-api-relay"


def test_health_check_reports_environment(client):
    response = client.get("/health")
    body = response.json()
    assert body["environment"] == settings.environment


def test_health_check_reports_revision(client):
    response = client.get("/health")
    body = response.json()
    assert body["revision"] == settings.revision


def test_public_api_health_matches_internal_health(client):
    # /api/health is what the proxy exposes publicly (and what the monitor reads)
    public = client.get("/api/health")
    assert public.status_code == 200
    assert public.json() == client.get("/health").json()
