# ERRORS.md: yuriodev-deployment

Append-only log of approaches that **didn't** work and the one that finally did, so the same dead end isn't rediscovered. Read it before suggesting a fix for anything that looks similar; append after any task that needed 2+ approaches, or after a production incident where the first instinct was wrong.

**Format:**

```
## YYYY-MM-DD: <short title>
**Task type:** <area>
**What didn't work:** <approaches that failed and why>
**What worked:** <the approach that finally landed>
**Note for next time:** <one line worth remembering>
```

**Rules:**
- Newest entries at the top, directly below this header.
- Don't log typos or single-shot fixes; log only when 2+ approaches were tried.
- This file is tracked in a PUBLIC repo: no secrets, no .env values, no tokens, no personal data (contact-form contents, email addresses), no server IPs. Describe, don't dump.
- If an entry contradicts a later one, keep both: the contradiction is the lesson.

---

## 2026-09-24: Backend tests green in CI, red inside the environment containers
**Task type:** backend / tests / local dev
**What didn't work:** `test_cors.py` hard-coded `https://yuriodev.co.uk` as the allowed origin. CI has no env file, so the code default applied and the test passed; inside the local stack (and dev/stage) `CORS_ORIGINS` comes from `env/<env>.env` and the same test failed. Running the suite against a read-only bind mount also failed, because `src/utils/logging.py` creates `logs/` in the working directory at import.
**What worked:** assert against the configured value (`settings.cors_origins[0]`) and build a fresh `Settings(_env_file=None)` for settings tests; run container tests on a writable scratch copy. The suite now passes with no env, `env/local.env` and `env/prod.env`.
**Note for next time:** Any test that touches config must pass with every `env/<env>.env`, not just the code defaults; check with `docker run --env-file env/<env>.env ... pytest`.

## 2026-09-24: Building the tag-driven release pipeline (four GitHub gotchas)
**Task type:** GitHub Actions / GHCR / rulesets
**What didn't work:** (1) `docker buildx imagetools create --tag X img@digest` wraps a single source in a NEW index, so `:dev`/`:stage` got digests different from `sha-<commit>` and a "stage digest == release digest" gate can never match. (2) A dry-run tag on an older commit never ran the promote workflow: tag pushes run the workflow file as it exists AT the tagged commit. (3) A ruleset bypass for the GitHub Actions app on `production` was rejected (422): on a personal-account repo the Actions integration cannot be a bypass actor. (4) The manual `workflow_dispatch` rollback failed with "Branch master is not allowed to deploy to production": the environment only allowed `v*.*.*` tags.
**What worked:** (1) `imagetools create --prefer-index=false` (exact copy, same digest). (2) Tag a commit that already contains the workflow. (3) Drop the update-restriction ruleset and keep the no-force-push/no-deletion one (so `production` can only fast-forward) plus the environment approval. (4) Allow branch `master` in the `production` environment's deployment policy (approval is still required).
**Note for next time:** Compare digests with `docker buildx imagetools inspect <ref> --format '{{json .Manifest.Digest}}'`, and select promote runs by `headBranch == <tag>`: every tag push triggers both promote workflows.

## 2026-09-24: Recreating backend broke /api/* with 502 (stale upstream IP in nginx)
**Task type:** deploy / nginx proxy
**What didn't work:** `docker compose up -d --no-deps backend` alone. nginx resolves `upstream backend { server backend:8000; }` once at start/reload and caches the IP; the recreated container got a new IP, so the proxy kept connecting to the old one ("connect() failed (113: Host is unreachable)", 502). The smoke test stayed green because it checks backend `/health` from inside the container, not through the proxy's `/api/` route.
**What worked:** `docker exec yuriodev-proxy nginx -t && docker exec yuriodev-proxy nginx -s reload` right after the recreate (re-resolves every upstream).
**Note for next time:** After recreating frontend or backend, reload the proxy (or switch the proxy to `resolver 127.0.0.11` + variable `proxy_pass` so it re-resolves by itself); check a proxied path, not only the container.

## 2026-09-24: Origin TLS certificate expired unnoticed (Cloudflare 526 for ~4 months)
**Task type:** TLS / nginx proxy / Cloudflare
**What didn't work:** A Let's Encrypt cert issued once by a standalone `certbot/certbot` container into `./certbot/conf`, with nothing scheduled to renew it: standalone needs port 80, which the proxy always holds, and the host `certbot.timer` renews a different store (`/etc/letsencrypt`) that the proxy doesn't mount. It expired after 90 days and Cloudflare Full (strict) returned 526 until someone noticed.
**What worked:** A Cloudflare Origin CA certificate (15 years, trusted by Full strict): key + CSR generated on the server, the CSR signed via the Cloudflare API, the files placed in the already-mounted `nginx-proxy/certs/` (gitignored), `nginx -t`, then `nginx -s reload`. No downtime and no renewal machinery.
**Note for next time:** Behind Cloudflare, prefer an Origin CA cert over Let's Encrypt at the origin; and monitor the edge, not the origin, because the origin kept answering 200 the whole time.

## 2026-09-24: Removing a backend feature: pydantic-settings rejects leftover env vars
**Task type:** backend / config
**What didn't work:** Removing the `/api/chat` relay also removed `agent_engine_url` from `Settings`. py_compile and an import scan passed, but `backend/.env` (injected via `env_file`) still sets `AGENT_ENGINE_URL`, and pydantic-settings 2.x `BaseSettings` defaults to `extra='forbid'`, so `Settings()` would raise at import time and the container would never serve `/health`.
**What worked:** `extra = "ignore"` in `Settings.Config` (or remove the variable from `.env` in the same change).
**Note for next time:** When deleting a `Settings` field, check whether `.env` still sets it; syntax checks don't catch this, only a real import with the real env does.

## 2026-09-24: Creating a GitHub repo from this box
**Task type:** git / GitHub
**What didn't work:** The SSH key can push but cannot create repos; `gh` was not installed and no API token existed.
**What worked:** The `gh` release binary (checksum-verified) in `~/.local/bin/gh`, then a device-code `gh auth login --web` approved by Yurii in the browser; `gh repo create --private`, then push over SSH.
**Note for next time:** `~/.local/bin/gh` is now installed and logged in; check `gh auth status` first.

## 2026-09-24: Deploying a code change: `restart`, `docker cp` and full-stack rebuild cycles
**Task type:** deploy / docker compose (reconstructed from the 2025 shell history)
**What didn't work:** `docker compose build <svc>` followed by `docker compose restart <svc>`: `restart` reuses the existing container and its OLD image, so the change never went live; files were then patched into the running `yuriodev-frontend` with `docker cp` (lost on the next recreate). Several `docker compose down -v` + `build --no-cache` cycles took the whole site, proxy included, offline and deleted the Redis volume each time.
**What worked:** `docker compose build <svc>` then `docker compose up -d --no-deps <svc>`: recreates only that container from the new image; nothing else restarts.
**Note for next time:** Deploy one service with `up -d --no-deps`; never `restart`, `docker cp` or `down -v` to ship code (see `/deploy`).

## 2026-09-24: Two compose binaries on the host
**Task type:** docker compose tooling
**What didn't work:** Mixing the legacy `/usr/bin/docker-compose` (v1.29.2) with `docker compose` (v2): v1 names images `yuriodev-deployment_<svc>` while v2 uses `yuriodev-deployment-<svc>`, so an image built with one is not what the other deploys. The stale `yuriodev-deployment_*` v1 images are still on disk.
**What worked:** Only `docker compose` (v2.40), which created every live container (label `com.docker.compose.version=2.40.1`).
**Note for next time:** `docker-compose` with a hyphen is blocked by the guard hook; if you see `_` in an image name, it came from v1.
