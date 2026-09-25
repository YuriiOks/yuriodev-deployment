"""OpenAPI and Swagger UI stay off unless API_DOCS_ENABLED is set."""

import pytest

DOC_PATHS = ("/api/openapi.json", "/api/docs", "/openapi.json", "/docs", "/redoc", "/api/redoc")


@pytest.mark.parametrize("path", DOC_PATHS)
def test_docs_are_off_by_default(make_client, path):
    assert make_client().get(path).status_code == 404


def test_docs_are_served_under_api_when_enabled(make_client):
    client = make_client(api_docs_enabled=True)

    schema = client.get("/api/openapi.json")
    assert schema.status_code == 200
    assert "/api/health" in schema.json()["paths"]
    assert client.get("/api/docs").status_code == 200
    assert client.get("/docs").status_code == 404
    assert client.get("/api/redoc").status_code == 404
