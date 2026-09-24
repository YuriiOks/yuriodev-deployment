---
description: Read-only health check of yuriodev.co.uk - containers and basic auth for prod/dev/stage, Cloudflare edge, internal health endpoints, origin TLS certificate, deploy agent, host resources. Use after any deploy or when asked "is the site up?" / "smoke test".
allowed-tools: Bash(${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh)
---
Run `${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh` (read-only; its exit code is the number of failed checks) and show its table verbatim in a code block. It covers all three environments: production containers/routes are FAILs, dev/stage containers and their basic-auth gating (401 without credentials, 200 with) are WARNs since they're allowed to be down, and it also reports the deploy agent's heartbeat freshness and recent log errors.

Then interpret in a few lines:
- `edge (Cloudflare)` 526 together with `origin cert EXPIRED` -> origin TLS problem: suggest `/cert-status`.
- An `origin` route failing while containers run -> proxy/routing: look at `docker compose logs --since 1h --tail 100 proxy` and `docker exec yuriodev-proxy nginx -t`.
- A failing internal health line -> suggest `/check-logs <that service>`.
- `deploy agent` heartbeat stale or paused, or `deploy agent log` showing FAILED/ERROR/REFUSED lines -> look at `tail -n 50 ~/.local/state/yuriodev-deploy.log`; check for `~/.yuriodev-deploy-paused`.
- `containers (dev)` / `containers (stage)` WARN -> that environment's project may simply not be up; not an incident on its own.
- `memory` WARN -> no image builds until RAM is available.
- Everything above is PASS but Yurii got an alert email anyway -> `.github/workflows/uptime.yml` checks from outside (through Cloudflare) every 10 min, including that `/api/health`'s `revision` matches the latest GitHub Release; `gh issue list --label monitor --state open` shows whether it currently has an open alert (auto-closes on recovery, no action needed once it does). A revision mismatch after the 20-minute grace usually means the deploy agent is stuck — check its heartbeat/log as above.
- To confirm a specific version is what's actually running anywhere: `curl -s <origin-or-edge-url>/api/health | python3 -m json.tool` and read `environment` + `revision` (git SHA) directly, rather than trusting container uptime alone.

This command never fixes anything: propose next steps only, and never send POST requests to the site.
