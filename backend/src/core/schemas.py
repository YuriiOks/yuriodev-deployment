# Website API Schemas
# Copyright (c) 2025 YuriODev
# File: src/core/schemas.py
# Created: 2025-10-19

from pydantic import BaseModel, Field
from datetime import datetime

class ErrorResponse(BaseModel):
    """Error response format."""
    error: str
    status: str = "error"
    timestamp: datetime = Field(default_factory=datetime.utcnow)