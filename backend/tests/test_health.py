# Website API Tests - /health endpoint
# File: tests/test_health.py


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
