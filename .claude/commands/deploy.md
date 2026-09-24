---
description: Deploy ONE service of the live yuriodev stack with pre-checks, a rollback tag and a smoke test. Manual only.
argument-hint: "<service>"
disable-model-invocation: true
---
Deploy `$ARGUMENTS` to production. Exactly one compose service; refuse "all" and ask which one. Each state-changing command below triggers a permission prompt: that prompt is Yurii's approval, so show him what will ship first.

1. Run the `/deploy-check` steps for this service. Stop and report on any failure.
2. Show exactly what ships (working-tree changes in the build context) and wait for an explicit go.
3. Rollback tag (built services only; the proxy runs the stock nginx image): `docker tag yuriodev-deployment-<svc>:latest yuriodev-deployment-<svc>:rollback-$(date +%Y%m%d-%H%M)`
4. Ship:
   - code change: `docker compose build <svc>` then `docker compose up -d --no-deps <svc>`.
   - proxy config-only change: `docker exec yuriodev-proxy nginx -t && docker exec yuriodev-proxy nginx -s reload` (no recreate).
5. Verify: `docker compose ps <svc>`, `docker compose logs --since 5m --tail 50 <svc>`, `${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh`. Compare with the baseline from step 1 and report the table.
6. If the service is broken: `docker tag yuriodev-deployment-<svc>:rollback-<stamp> yuriodev-deployment-<svc>:latest && docker compose up -d --no-deps --no-build --force-recreate <svc>`, re-run the smoke test, and add an `ERRORS.md` entry if two approaches failed.

Never deploy code with `docker compose restart` (it keeps the old image), never `docker cp` into a container, never a bare `docker compose up -d`.
