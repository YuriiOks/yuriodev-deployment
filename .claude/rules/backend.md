---
paths:
  - "backend/**"
---
# Backend: FastAPI relay (Python 3.11 in Docker)

- Runs on `python:3.11-slim`; the host has 3.12, so avoid 3.12-only syntax (for example same-quote nesting inside f-strings). Dependencies are pinned in `backend/requirements.txt`.
- No business routes: the only endpoint is `GET /health`, and nginx does not route it publicly. Swagger and ReDoc are disabled.
- Settings: `src/core/config.py` (pydantic-settings `BaseSettings` with `extra = "ignore"`, so unknown env keys are tolerated and every field has a code default: the app boots even if an env file never reached it, which is why `/health` reports `environment`). Never read `backend/.env`; use `backend/.env.example` for variable names.
- Logging: `src/utils/logging.py` (Rich console + JSONL request log under `logs/`); no `print()`.
- No test suite beyond `.github/workflows/ci.yml`'s import + `/health` check on Python 3.11 (runs on every push to `master` and every PR). A host venv is impossible (python3.12-venv missing, no sudo): syntax-check in a throwaway `python:3.11-slim` container (see `/deploy-check`).
- Images are built in GitHub Actions, not on this box: `images.yml` builds once per green `master` commit and points `:dev` at it (and `:stage` while `STAGE_AUTO_PROMOTE=true`). A manual `docker compose build backend` here is break-glass only (see root `CLAUDE.md` golden rule 2).
- To see a change live before a release: push to `master`, then check `dev.yuriodev.co.uk/api/health` once the deploy agent (cron, within a minute) has recreated `yuriodev-dev-backend`. Its env file is `deploy/dev/backend.env` (gitignored, distinct from production's `backend/.env`) — never read either.
