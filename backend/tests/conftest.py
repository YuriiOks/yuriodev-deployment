# Website API Test Fixtures
# File: tests/conftest.py

import pytest
from fastapi.testclient import TestClient

from src.main import app


@pytest.fixture
def client():
    """A TestClient bound to the FastAPI app, for use in endpoint tests."""
    with TestClient(app) as test_client:
        yield test_client
