# Website API Logging
# Copyright (c) 2025 YuriODev
# File: src/utils/logging.py
# Created: 2025-10-19
# Updated to match Claude's structured logging architecture

import logging
from pathlib import Path
from rich.logging import RichHandler

# --- Main Logger Setup ---
def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure Rich-based console logging."""
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(rich_tracebacks=True, markup=True)]
    )
    # Ensure the logs directory exists
    Path("logs").mkdir(exist_ok=True)
    return logging.getLogger("api_logger")

logger = setup_logging()