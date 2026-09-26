---
description: Pre-release validation for yuriodev.co.uk - CI/Images green for a commit, stage running those images, stage smoke test. Read-only. Use before tagging a release (rc or final).
argument-hint: "[ref, default: origin/master]"
---
Target commit: `$ARGUMENTS` (a ref/SHA; default the tip of `origin/master`). Run everything from /home/yurii/yuriodev-deployment.

1. **What ships.** `sha=$(git rev-parse <ref>)` for the full 40-char commit SHA used below as `<sha>` (image tags are `sha-<full-sha>`, not the abbreviated form `git log --oneline` prints), plus `git log -1 --oneline <ref>` for a human-readable summary; confirm it is on `master`: `git merge-base --is-ancestor <ref> origin/master && echo ok`.
2. **CI green for this commit.** `gh run list --workflow=ci.yml --commit <sha> --limit 5` — the `frontend`, `backend` and `guards` jobs must all have succeeded: `frontend` includes typecheck, lint (0 problems, blocking), `npm run test`, build and `npm audit --audit-level=high`; `backend` is `ruff check`, `ruff format --check`, `mypy` (strict) and `python -m pytest -q --cov` with a 90% branch-coverage gate; `guards` is `scripts/check-compose.py` plus `docker compose ... config --quiet` on every compose file. None of these `continue-on-error`.
3. **Images built for this commit.** `gh run list --workflow=images.yml --limit 5`, then confirm the images exist: `docker buildx imagetools inspect ghcr.io/yuriioks/yuriodev-frontend:sha-<sha>` and `...-backend:sha-<sha>` (anonymous pull, no login needed). A successful `images.yml` run already means Trivy found no fixable HIGH/CRITICAL CVE in either image (it blocks the run otherwise).
4. **Stage is running those images** (meaningful before a release tag, not an rc): compare digests — `docker buildx imagetools inspect ghcr.io/yuriioks/yuriodev-{frontend,backend}:stage` against the `:sha-<sha>` digests from step 3. This is exactly the gate `promote-production.yml` enforces.
5. **Stage smoke test.** `.claude/scripts/smoke-test.sh` (it already checks stage's containers, basic-auth gating and reachability alongside prod/dev) plus `curl -sk --resolve stage.yuriodev.co.uk:443:127.0.0.1 -u <user>:<pass> https://stage.yuriodev.co.uk/api/health` to confirm `environment: stage` and a `revision` matching `<sha>` (credentials in `~/.config/yuriodev/basic-auth.txt`, never print them).
6. **Resources.** `free -m` (need >= 1500 MiB available for anyone building locally), `df -h /`.

Output: a table (check, result, evidence) and the exact release commands for Yurii to approve (see `/deploy`). This command never tags, pushes, builds or deploys anything.
