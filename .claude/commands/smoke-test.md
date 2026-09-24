---
description: Read-only health check of yuriodev.co.uk - containers, origin, Cloudflare edge, internal health endpoints, origin TLS certificate, host resources. Use after any deploy or when asked "is the site up?" / "smoke test".
allowed-tools: Bash(${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh)
---
Run `${CLAUDE_PROJECT_DIR}/.claude/scripts/smoke-test.sh` (read-only; its exit code is the number of failed checks) and show its table verbatim in a code block.

Then interpret in a few lines:
- `edge (Cloudflare)` 526 together with `origin cert EXPIRED` -> origin TLS problem: suggest `/cert-status`.
- An `origin` route failing while containers run -> proxy/routing: look at `docker compose logs --since 1h --tail 100 proxy` and `docker exec yuriodev-proxy nginx -t`.
- A failing internal health line -> suggest `/check-logs <that service>`.
- `memory` WARN -> no image builds until RAM is available.

This command never fixes anything: propose next steps only, and never send POST requests to the site.
