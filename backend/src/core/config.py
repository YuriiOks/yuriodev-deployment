# Website API Configuration
# Copyright (c) 2025 YuriODev
# File: src/core/config.py
# Created: 2025-10-19

from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    """API configuration settings."""
    
    # API Settings
    api_title: str = "YuriODev Website API"
    api_version: str = "0.1.0"
    
    # CORS Settings
    cors_origins: List[str] = ["https://yuriodev.co.uk", "http://localhost:5173"]

    # Logging
    log_level: str = "INFO"

    # Deployment metadata (non-secret; surfaced via /health)
    environment: str = "unknown"
    revision: str = "unknown"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()