# Website API - Simple Message Relay
# Copyright (c) 2025 YuriODev
# File: src/main.py
# Created: 2025-10-19

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.core.config import settings
from src.utils.logging import logger


app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    docs_url=None, # No docs for this simple relay
    redoc_url=None,
)

# Add CORS middleware to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# /health for the container HEALTHCHECK and the proxy network; /api/health is the
# same payload through the public proxy route (/api/ -> backend), used by the
# external monitor. Everything in it is non-secret.
@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Simple health check endpoint for monitoring."""
    return {
        "status": "healthy",
        "service": "website-api-relay",
        "environment": settings.environment,
        "revision": settings.revision,
    }

logger.info("✅ Website API Relay service initialized.")