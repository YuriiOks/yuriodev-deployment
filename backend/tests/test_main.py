"""The uvicorn target builds the app from the real process environment."""

import importlib
import os

from fastapi.testclient import TestClient


def test_main_app_serves_health_for_the_configured_environment():
    import src.main

    main = importlib.reload(src.main)
    with TestClient(main.app) as client:
        body = client.get("/api/health").json()

    assert body["status"] == "healthy"
    assert body["environment"] == (os.environ.get("ENVIRONMENT") or "unknown")
