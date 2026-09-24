# yuriodev-deployment

Deployment repo for **yuriodev.co.uk**: a personal portfolio (Vite/React frontend + FastAPI relay backend), behind one nginx proxy container, all run with docker compose.

> **PRODUCTION RUNS LIVE FROM THIS DIRECTORY.** There is no staging and no CI. The containers are built from this working tree (not from git HEAD) and `nginx-proxy/` is bind-mounted into the running proxy. Any container build/recreate/restart/stop, any edit to `nginx-proxy/` or `docker-compose.yml`, and any git change to the working tree or index is a production change: **ask Yurii first.**

## Architecture

```
Internet -> Cloudflare (proxied, SSL mode Full (strict): needs a valid origin cert)
         -> yuriodev-proxy (nginx:stable-alpine; the ONLY container publishing ports, 80 and 443)
              :80   any host                 -> 301 https
              :443  /                        -> frontend:80   (static Vite build, SPA fallback)
                    /api/                    -> backend:8000  (FastAPI relay; internal GET /health only)
```

| Compose service | Container | Build / image | Notes |
|---|---|---|---|
| `proxy` | yuriodev-proxy | nginx:stable-alpine | mounts `./nginx-proxy` -> `/etc/nginx/conf.d` (TLS cert in `nginx-proxy/certs/`), `./certbot/conf` -> `/etc/letsencrypt:ro` (only for `options-ssl-nginx.conf` + dhparams) |
| `frontend` | yuriodev-frontend | `./frontend` (node:22 build -> nginx) | `frontend/nginx.conf` is baked into the image |
| `backend` | yuriodev-backend | `./backend` (python:3.11-slim) | env_file `backend/.env`; no business routes, only internal `GET /health` (not routed publicly) |

Compose project `yuriodev-deployment`, network `yuriodev-network`, every service `restart: unless-stopped`. Subsystem details: `.claude/rules/{frontend,backend,infra}.md` (load automatically when you work on those files).

## Golden rules (reasons in parentheses; * = hard rule, no exceptions)
1. Compose v2 only, from the repo root: `docker compose ...`. Never `docker-compose` (legacy v1.29.2 on this host)*.
2. Ship ONE service at a time: `docker compose build <svc>` then `docker compose up -d --no-deps <svc>`. Never a bare `up -d` / `build` / `restart` (running containers can carry an older config hash than the file), never `restart` to deploy code (it keeps the old image), never `docker cp` into containers.*
3. Proxy config: edit `nginx-proxy/default.conf` -> `docker exec yuriodev-proxy nginx -t` -> reload only with Yurii's OK: `docker exec yuriodev-proxy nginx -s reload`. Don't recreate the proxy for a config change (the whole site blips).*
4. Say exactly what ships: builds take the working tree, including uncommitted and unstaged changes.
5. Secrets: never read or print `backend/.env`; use `backend/.env.example` for variable names. Never `docker compose config` without `--quiet`, bare `docker inspect`, or `docker exec ... env`.*
6. Origin TLS is a Cloudflare Origin CA certificate, `nginx-proxy/certs/origin.{pem,key}` (gitignored, valid to 2041-09-20, trusted only by Cloudflare Full (strict)). Never commit or print `origin.key`. `certbot/` is the root-owned legacy Let's Encrypt store; leave it alone. Diagnose with `/cert-status`.
7. The host is small (4 vCPU, 7.6 GB RAM, no swap): one image build at a time, check `free -m` first (>= 1.5 GB available), no long-running dev servers.
8. Git (this repo is PUBLIC on GitHub; `master` is the default/integration branch, `production` marks what runs live and only moves when a release is promoted; this working tree stays on `master`): stage explicit paths only, never `-A` / `.` / `-u` / `-f`*; run `git diff --cached --stat` before any commit (the index can hold a large pre-existing batch); conventional commits; never force-push; nothing secret or private in tracked files.

## Everyday commands (read-only unless noted)
```bash
docker compose ps                                  # state of the 3 containers
docker compose logs --since 1h --tail 200 <svc>    # logs of one service
docker stats --no-stream                           # CPU/RAM per container
.claude/scripts/smoke-test.sh                      # full health check; exit code = number of failures
docker exec yuriodev-proxy nginx -t                # validate proxy config
git status --short && git diff --cached --stat     # what is changed / staged
cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run lint   # frontend checks (lint has a known baseline, see rules)
```
Deploy (ask first, one service): `docker compose build <svc> && docker compose up -d --no-deps <svc>`, then `.claude/scripts/smoke-test.sh`.

## Local name resolution
`/etc/hosts` on this box maps `yuriodev.co.uk` to itself, so a plain `curl https://yuriodev.co.uk` tests the ORIGIN, not Cloudflare. Origin: `curl -sk --resolve yuriodev.co.uk:443:127.0.0.1 https://yuriodev.co.uk/`. Edge (through Cloudflare): `curl -s --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/`. A Cloudflare 526 means the origin certificate is invalid or expired.

## Testing
- Frontend: typecheck is clean; `npm run lint` has a known baseline of existing problems (don't treat it as a gate; don't add new ones); `npm run build` must pass.
- Backend: no test suite; syntax-check under Python 3.11 in a throwaway container (see `/deploy-check`).

## Claude Code setup for this repo
- Commands: `/smoke-test`, `/check-logs [svc] [since]`, `/cert-status`, `/deploy-check <svc>`, `/deploy <svc>` (manual only).
- Agents: `yuriodev-ops` (read-only diagnostics, Sonnet), `bug-investigator` (root cause + surgical fix, Opus).
- Hooks: `.claude/hooks/session-start.sh` (status banner, wired in `.claude/settings.json`). Start sessions here (`cd ~/yuriodev-deployment && claude`) so this repo's settings, commands and memory load.
- `ERRORS.md`: failed approaches. Read it before debugging anything similar; append (newest first) when a task needed 2+ approaches.
- `docs/backlog.md` (local only, not tracked): current open issues and priorities. `docs/history/` holds the archived Nov-2025 notes: historical, do not follow.
- Personal/current-state notes live in Claude's project memory, not in tracked files.

## Repo map
- Active: `docker-compose.yml`, `nginx-proxy/` (incl. gitignored `certs/`), `frontend/`, `backend/`; `certbot/` (root-owned, legacy, still mounted for the TLS options files).
- Retired: the Legal AI demo and the Shawbrook assistant (`ai-engine`) have moved to `github.com/YuriiOks/legal-ai-project` and `github.com/YuriiOks/shawbrook-assistant` (both private; Shawbrook's `archive/vps-local` branch holds its last server-side change); local copies live under `~/archive/`, outside this repo.
- History / clutter (don't extend, don't delete unasked): `docs/`, `presentation/`, `IMPLEMENTATION_PLAN.md`, `DOCUMENTATION_ALIGNMENT_REVIEW.md`, `generate_project_doc.py`, root `*.tar.gz`, `img.jpg`, `__MACOSX/`, generated `claims_for_damages_template_*.md` / `document_*.md`.
- Decoys: host `/etc/nginx/sites-*` and the host `certbot.timer` belong to a pre-Docker setup and do not serve this site.
