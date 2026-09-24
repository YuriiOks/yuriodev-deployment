---
paths:
  - "backend/**"
---
# Backend: FastAPI relay (Python 3.11 in Docker)

- Runs on `python:3.11-slim`; the host has 3.12, so avoid 3.12-only syntax (for example same-quote nesting inside f-strings). Dependencies are pinned in `backend/requirements.txt`.
- No business routes: the only endpoint is `GET /health`, and nginx does not route it publicly. Swagger and ReDoc are disabled.
- Settings: `src/core/config.py` (pydantic-settings `BaseSettings`, whose default `extra="forbid"` rejects unknown `.env` keys). Never read `backend/.env`; use `backend/.env.example` for variable names.
- Logging: `src/utils/logging.py` (Rich console + JSONL request log under `logs/`); no `print()`.
- No test suite. A host venv is impossible (python3.12-venv missing, no sudo): syntax-check in a throwaway `python:3.11-slim` container (see `/deploy-check`).
