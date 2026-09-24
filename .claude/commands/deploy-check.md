---
description: Pre-deploy validation for ONE service of the live yuriodev stack - what ships, compose/nginx config, syntax/type/lint/build checks, resources, current health. Changes nothing (throwaway check containers ask first). Use before any deploy or when asked "ready to deploy?".
argument-hint: "<service: frontend|backend|proxy>"
---
Target service: `$ARGUMENTS` (exactly one compose service; ask if it is missing or "all"). Run everything from /home/yurii/yuriodev-deployment.

1. **What ships.** Builds take the working tree, not git HEAD. For the service's build context (frontend/, backend/, proxy = nginx-proxy/) show `git status --short -- <dir>` and `git diff --stat HEAD -- <dir>`, and say which uncommitted changes would go live.
2. **Config.** `docker compose config --quiet`; for proxy or routing changes also `docker exec yuriodev-proxy nginx -t`.
3. **Code checks.**
   - frontend: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`, `npm run lint` (report only problems beyond the known baseline of ~34), `npm run build`.
   - backend (Python 3.11): `docker run --rm --network none -v "$PWD/backend/src:/src:ro" python:3.11-slim python -c "import ast,pathlib;[ast.parse(p.read_text(),str(p)) for p in pathlib.Path('/src').rglob('*.py')];print('ok')"`
4. **Resources.** `free -m` (need >= 1500 MiB available to build), `df -h /`, `docker system df`.
5. **Baseline health.** `${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh` (so post-deploy regressions are distinguishable from existing failures).

Output: a table (check, result, evidence) and the exact commands for Yurii to approve: `docker compose build <svc>` then `docker compose up -d --no-deps <svc>` (proxy config-only change: `docker exec yuriodev-proxy nginx -s reload` instead). Do not deploy from this command; `/deploy <svc>` does that after his go.
