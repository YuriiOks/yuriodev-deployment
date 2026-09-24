# yuriodev-deployment

Deployment repo for **yuriodev.co.uk**: a personal portfolio (Vite/React frontend + FastAPI relay backend), behind one nginx proxy container, all run with docker compose.

> **PRODUCTION RUNS LIVE FROM THIS DIRECTORY.** Three environments run behind one proxy on this box: `yuriodev.co.uk` (production), `dev.yuriodev.co.uk` and `stage.yuriodev.co.uk`. Frontend/backend images are built once in GitHub Actions per green `master` commit and ship by retagging in the registry (`:dev` -> rc tag -> `:stage` -> release tag + GitHub approval -> `:production`); a cron deploy agent on this box follows those tags and recreates the changed containers. `docker-compose.yml` still keeps `build:` on frontend/backend, but only for break-glass (golden rule 2). `nginx-proxy/` is bind-mounted into the running proxy. Any container build/recreate/restart/stop, any edit to `nginx-proxy/` or a compose file, and any git change to the working tree or index is a production change: **ask Yurii first.**

## Architecture

```
Internet -> Cloudflare (proxied, SSL mode Full (strict): needs a valid origin cert)
         -> yuriodev-proxy (nginx:stable-alpine; the ONLY container publishing ports, 80 and 443)
              :80   any host                                    -> 301 https
              :443  yuriodev.co.uk        /                     -> yuriodev-frontend:80        (production)
                                           /api/                 -> yuriodev-backend:8000       (production; internal GET /health only)
                    dev.yuriodev.co.uk    (basic auth, noindex)  -> yuriodev-dev-frontend:80 / yuriodev-dev-backend:8000
                    stage.yuriodev.co.uk  (basic auth, noindex)  -> yuriodev-stage-frontend:80 / yuriodev-stage-backend:8000
```

| Project (compose file) | Services / containers | Image | Notes |
|---|---|---|---|
| `yuriodev-deployment`, production — `docker-compose.yml` | `frontend`/`yuriodev-frontend`, `backend`/`yuriodev-backend`, `proxy`/`yuriodev-proxy` | `ghcr.io/yuriioks/yuriodev-{frontend,backend}:production`; proxy = `nginx:stable-alpine` | `build:` kept on frontend/backend for break-glass only; proxy mounts `./nginx-proxy` -> `/etc/nginx/conf.d` (TLS cert in `nginx-proxy/certs/`), `./certbot/conf` -> `/etc/letsencrypt:ro`; backend env_file `backend/.env` |
| `yuriodev-dev` — `deploy/dev/compose.yml` | `frontend-dev`/`yuriodev-dev-frontend`, `backend-dev`/`yuriodev-dev-backend` | `:dev` (every green `master` commit) | basic auth + noindex/no-store; backend env_file `deploy/dev/backend.env` (gitignored) |
| `yuriodev-stage` — `deploy/stage/compose.yml` | `frontend-stage`/`yuriodev-stage-frontend`, `backend-stage`/`yuriodev-stage-backend` | `:stage` (a `vX.Y.Z-rc.N` tag, or every green `master` commit while repo variable `STAGE_AUTO_PROMOTE=true`) | basic auth + noindex/no-store; backend env_file `deploy/stage/backend.env` (gitignored) |

All three projects share network `yuriodev-network`; every service `restart: unless-stopped`. Service names are environment-unique (`frontend-dev`, `frontend-stage`, ...) so Docker's embedded DNS never round-robins between environments; the proxy addresses containers by `container_name`. Subsystem details: `.claude/rules/{frontend,backend,infra}.md` (load automatically when you work on those files).

## Golden rules (reasons in parentheses; * = hard rule, no exceptions)
1. Compose v2 only, from the repo root: `docker compose ...`. Never `docker-compose` (legacy v1.29.2 on this host)*.
2. App code ships via git tags through GitHub Actions, never a manual build on this box — see the release runbook, `/deploy`. Manual `docker compose build <svc>` + `up -d --no-deps <svc>` here is break-glass only: `touch ~/.yuriodev-deploy-paused` FIRST (else the deploy agent reverts a locally built image to the registry tag within a minute), one service at a time. Never a bare `up -d` / `build` / `restart` (running containers can carry an older config hash than the file), never `restart` to deploy code (it keeps the old image), never `docker cp` into containers.*
3. Proxy config: edit `nginx-proxy/default.conf` -> `docker exec yuriodev-proxy nginx -t` -> reload only with Yurii's OK: `docker exec yuriodev-proxy nginx -s reload`. Don't recreate the proxy for a config change (the whole site blips).*
4. Say exactly what ships: for a normal release that's the commit the git tag points at (images are built once in CI from that exact commit — `.github/workflows/`); for a break-glass on-box build it's the working tree, including uncommitted and unstaged changes.
5. Secrets: never read or print `backend/.env`; use `backend/.env.example` for variable names. Never `docker compose config` without `--quiet`, bare `docker inspect`, or `docker exec ... env`.*
6. Origin TLS is a Cloudflare Origin CA certificate, `nginx-proxy/certs/origin.{pem,key}` (gitignored, valid to 2041-09-20, trusted only by Cloudflare Full (strict)). Never commit or print `origin.key`. `certbot/` is the root-owned legacy Let's Encrypt store; leave it alone. Diagnose with `/cert-status`.
7. The host is small (4 vCPU, 7.6 GB RAM, no swap): one image build at a time, check `free -m` first (>= 1.5 GB available), no long-running dev servers.
8. Git (this repo is PUBLIC on GitHub; `master` is the default/integration branch, `production` marks what runs live and only moves when a release is promoted; this working tree stays on `master`): stage explicit paths only, never `-A` / `.` / `-u` / `-f`*; run `git diff --cached --stat` before any commit (the index can hold a large pre-existing batch); conventional commits; never force-push; nothing secret or private in tracked files.

## Everyday commands (read-only unless noted)
```bash
docker compose ps                                     # state of the 3 production containers
docker compose -f deploy/dev/compose.yml ps            # dev project (yuriodev-dev)
docker compose -f deploy/stage/compose.yml ps           # stage project (yuriodev-stage)
docker compose logs --since 1h --tail 200 <svc>          # logs of one production service
docker stats --no-stream                                  # CPU/RAM per container
.claude/scripts/smoke-test.sh                              # health check: prod/dev/stage, deploy agent; exit code = number of failures
docker exec yuriodev-proxy nginx -t                          # validate proxy config
git status --short && git diff --cached --stat                # what is changed / staged
gh run list --workflow=ci.yml --limit 5                         # recent CI runs (also images.yml, promote-stage.yml, promote-production.yml)
tail -n 50 ~/.local/state/yuriodev-deploy.log                     # deploy agent activity, all enabled envs
cat ~/.local/state/yuriodev-deploy.heartbeat                        # last time the deploy agent ran
cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run lint   # frontend checks (lint has a known baseline, see rules)
```
Release (ask first): `git tag -a vX.Y.Z-rc.N -m "..." && git push origin vX.Y.Z-rc.N` (moves `:stage`) -> check `stage.yuriodev.co.uk` -> `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z` -> approve the run in the GitHub `production` environment -> `:production` moves, branch `production` fast-forwards, a Release is created. Full runbook: `/deploy`. Break-glass on-box build: golden rule 2 and `/deploy`'s break-glass section.

## Local name resolution
`/etc/hosts` on this box maps `yuriodev.co.uk` to itself, so a plain `curl https://yuriodev.co.uk` tests the ORIGIN, not Cloudflare. Origin: `curl -sk --resolve yuriodev.co.uk:443:127.0.0.1 https://yuriodev.co.uk/`. Edge (through Cloudflare): `curl -s --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/`. A Cloudflare 526 means the origin certificate is invalid or expired.

## Testing
- Frontend: typecheck is clean; `npm run lint` has a known baseline of existing problems (don't treat it as a gate; don't add new ones); `npm run build` must pass. `.github/workflows/ci.yml` runs typecheck + build + (non-blocking) lint on every push to `master` and every PR.
- Backend: no test suite beyond `ci.yml`'s `/health` import check on Python 3.11; for anything more, syntax-check under Python 3.11 in a throwaway container (see `/deploy-check`).

## Claude Code setup for this repo
- Commands: `/smoke-test`, `/check-logs [svc] [since]`, `/cert-status`, `/deploy-check [ref]` (pre-release checks: CI/Images green, stage digest, stage smoke), `/deploy [vX.Y.Z]` (release runbook, manual only, with a break-glass section).
- Agents: `yuriodev-ops` (read-only diagnostics across all three environments, Sonnet), `bug-investigator` (root cause + surgical fix, Opus).
- Hooks: `.claude/hooks/session-start.sh` (status banner, wired in `.claude/settings.json`). Start sessions here (`cd ~/yuriodev-deployment && claude`) so this repo's settings, commands and memory load.
- `ERRORS.md`: failed approaches. Read it before debugging anything similar; append (newest first) when a task needed 2+ approaches.
- `docs/backlog.md` (local only, not tracked): current open issues and priorities. `docs/history/` holds the archived Nov-2025 notes: historical, do not follow.
- Personal/current-state notes live in Claude's project memory, not in tracked files.

## Repo map
- Active: `docker-compose.yml`, `nginx-proxy/` (incl. gitignored `certs/` and `auth/`), `frontend/`, `backend/`, `deploy/` (`dev/` + `stage/` compose files and gitignored `backend.env`, `agent/yuriodev-deploy.sh`), `.github/workflows/` (`ci.yml`, `images.yml`, `promote-stage.yml`, `promote-production.yml`); `certbot/` (root-owned, legacy, still mounted for the TLS options files).
- Retired: the Legal AI demo and the Shawbrook assistant (`ai-engine`) have moved to `github.com/YuriiOks/legal-ai-project` and `github.com/YuriiOks/shawbrook-assistant` (both private; Shawbrook's `archive/vps-local` branch holds its last server-side change); local copies live under `~/archive/`, outside this repo.
- History / clutter (don't extend, don't delete unasked): `docs/`, `presentation/`, `IMPLEMENTATION_PLAN.md`, `DOCUMENTATION_ALIGNMENT_REVIEW.md`, `generate_project_doc.py`, root `*.tar.gz`, `img.jpg`, `__MACOSX/`, generated `claims_for_damages_template_*.md` / `document_*.md`.
- Decoys: host `/etc/nginx/sites-*` and the host `certbot.timer` belong to a pre-Docker setup and do not serve this site.
