"""The one error shape: {error, message, request_id}, never echoing input or tracebacks."""

import logging

import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from src.app import create_app

ERROR_KEYS = {"error", "message", "request_id"}


@pytest.fixture
def app_with_test_routes(make_settings):
    app = create_app(make_settings())

    @app.get("/api/items/{item_id}")
    async def item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    @app.get("/api/boom")
    async def boom() -> None:
        raise RuntimeError("database password is hunter2")

    @app.get("/api/forbidden")
    async def forbidden() -> None:
        raise HTTPException(status_code=403)

    @app.get("/api/odd")
    async def odd() -> None:
        raise HTTPException(status_code=599, detail="odd")

    @app.get("/api/stream-boom")
    async def stream_boom() -> StreamingResponse:
        async def chunks():
            yield b"partial"
            raise RuntimeError("mid-stream")

        return StreamingResponse(chunks())

    return app


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == ERROR_KEYS
    assert body["error"] == code
    assert body["request_id"] == response.headers["x-request-id"]
    return body


def test_unknown_route_is_404(client):
    body = assert_error(client.get("/api/nope"), 404, "not_found")
    assert body["message"] == "Not found"


def test_wrong_method_is_405_and_keeps_allow(client):
    response = client.post("/api/health")

    assert_error(response, 405, "method_not_allowed")
    assert "GET" in response.headers["allow"]


def test_validation_error_does_not_echo_input(app_with_test_routes):
    with TestClient(app_with_test_routes) as client:
        response = client.get("/api/items/not-a-number-xyz")

    assert_error(response, 422, "validation_error")
    assert "not-a-number-xyz" not in response.text


def test_other_http_errors_use_the_status_phrase(app_with_test_routes):
    with TestClient(app_with_test_routes) as client:
        body = assert_error(client.get("/api/forbidden"), 403, "forbidden")
        assert body["message"] == "Forbidden"
        assert_error(client.get("/api/odd"), 599, "error")


def test_unhandled_exception_is_a_clean_500(app_with_test_routes, caplog):
    with TestClient(app_with_test_routes) as client, caplog.at_level(logging.ERROR):
        response = client.get("/api/boom")

    body = assert_error(response, 500, "internal_error")
    assert body["message"] == "Internal error"
    assert "hunter2" not in response.text
    assert "Traceback" not in response.text
    errors = [r for r in caplog.records if r.name == "yuriodev.error"]
    assert len(errors) == 1
    assert errors[0].exc_info is not None


def test_exception_after_the_response_started_is_reraised(app_with_test_routes):
    with (
        TestClient(app_with_test_routes) as client,
        pytest.raises(RuntimeError, match="mid-stream"),
    ):
        client.get("/api/stream-boom")
