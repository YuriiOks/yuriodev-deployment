"""Response models shared across routes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

FROZEN = ConfigDict(extra="forbid", frozen=True)


class HealthResponse(BaseModel):
    """Liveness payload. The keys are parsed by the uptime workflow and the smoke test."""

    model_config = FROZEN

    status: Literal["healthy"]
    service: str
    environment: str
    revision: str


class ErrorBody(BaseModel):
    """The one error shape for every non-2xx answer the app produces itself."""

    model_config = FROZEN

    error: str  # stable machine code: not_found, method_not_allowed, validation_error, ...
    message: str  # short and human; never echoes request input or a traceback
    request_id: str | None = None
