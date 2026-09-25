"""uvicorn entry point: `uvicorn src.main:app`."""

from src.app import create_app

app = create_app()
