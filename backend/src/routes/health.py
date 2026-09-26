"""Liveness: GET|HEAD /health (container HEALTHCHECK, internal) and /api/health (public)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from src.core.config import Settings
from src.core.schemas import HealthResponse
from src.deps import get_settings_dep

SERVICE_NAME = "yuriodev-api"

router = APIRouter(tags=["health"])


async def health(settings: Annotated[Settings, Depends(get_settings_dep)]) -> HealthResponse:
    """Always answers while the process is up; never depends on an upstream."""
    return HealthResponse(
        status="healthy",
        service=SERVICE_NAME,
        environment=settings.environment,
        revision=settings.revision,
        ref=settings.build_ref,
    )


for _path in ("/health", "/api/health"):
    router.add_api_route(_path, health, methods=["GET"], response_model=HealthResponse)
    # FastAPI answers HEAD with 405 unless it is registered; uvicorn drops the body.
    router.add_api_route(_path, health, methods=["HEAD"], include_in_schema=False)
