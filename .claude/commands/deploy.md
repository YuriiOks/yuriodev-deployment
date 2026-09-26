---
description: Release runbook for yuriodev.co.uk - verify the master commit stage runs, tag the release on it, approve in GitHub, verify production (an rc tag is optional). Includes a break-glass section for manual on-box builds. Manual only.
argument-hint: "[vX.Y.Z]"
disable-model-invocation: true
---
Release `$ARGUMENTS` (a `vX.Y.Z`; ask which version if missing). App code ships by moving registry tags through GitHub Actions — images are built once per commit, Trivy-scanned, tagged `sha-<commit>` (master) or `dev-<commit>` (branch), and only ever retagged after that: the owner's branch -> `:dev`, the newest built `master` head -> `:stage` by itself, a release tag + approval -> `:production`. The registry tags are the source of truth; Images runs are filed under master's tip, so find them by title (`Images: <branch> @ <sha>`), never by `--commit`/`--branch`. Each state-changing command below triggers a permission prompt: that prompt is Yurii's approval, so show him what happens first.

## Release

1. Run `/deploy-check` against the commit you intend to release (default: tip of `origin/master`, which stage runs once both its images are built). Stop and report on any failure — CI must be green for that exact commit and both `sha-<commit>` images must exist.
2. **Stage already runs it.** Merging (or pushing) to `master` is what moves `:stage`: `images.yml` points it at that commit's images, nothing to tag. Optional, ask first: to release an *older* master commit, pin stage to it with an rc tag, `git tag -a vX.Y.Z-rc.N -m "..." <commit> && git push origin vX.Y.Z-rc.N`. `.github/workflows/promote-stage.yml` checks that the commit is on `master` and CI passed for it, waits for its scanned `sha-<commit>` images, then retags `:stage` to them (nothing is rebuilt); the next `master` build moves stage on again.
3. **Verify stage.** The deploy agent (`deploy/agent/yuriodev-deploy.sh`, cron every minute) picks up the moved `:stage` tag within a minute — watch `tail -n 20 ~/.local/state/yuriodev-deploy.log`. Then check `https://stage.yuriodev.co.uk/` by hand (basic auth; credentials at `~/.config/yuriodev/basic-auth.txt`, never print them) and `/api/health` (`revision` = the commit, `ref` = `master`), and run `.claude/scripts/smoke-test.sh` (it checks stage alongside prod/dev).
4. **Tag the release** on the commit stage is running (ask first): `git tag -a vX.Y.Z -m "..." <commit> && git push origin vX.Y.Z`. This triggers `.github/workflows/promote-production.yml`, which gates on `:stage`'s digest equalling `sha-<commit>` for both images: it waits up to ~15 minutes for that commit to be built and on stage, then refuses with "tag the master commit stage is running" (for example when another `master` build moved stage on since step 3: release that newer commit instead, or pin stage back with an rc tag first), then waits for manual approval in the GitHub `production` environment (reviewer YuriiOks) before it retags `:production`, fast-forwards branch `production`, and creates a GitHub Release recording both digests.
5. **Approve the run** in GitHub (Actions UI, or `gh run list --workflow=promote-production.yml`). Repo variable `PROD_DRY_RUN=true` means the gate still runs but nothing is retagged or pushed — check it if the run "succeeds" but nothing changes.
6. **Verify production.** Once `prod` is included in the deploy agent's `ENABLED_ENVS`, it picks up the moved `:production` tag within a minute and recreates only the changed service(s). Confirm with `docker compose ps`, `.claude/scripts/smoke-test.sh`, `tail -n 20 ~/.local/state/yuriodev-deploy.log`, and `curl -s https://yuriodev.co.uk/api/health | python3 -m json.tool` — its `revision` should equal the tagged commit's full SHA. Compare against the `/deploy-check` baseline from step 1. `.github/workflows/uptime.yml` re-checks all of this from outside every 10 minutes with a 20-minute grace period and opens a GitHub issue labelled `monitor` if it doesn't converge — no action needed if you've already confirmed it manually here.

Rollback: retag `:production` at an older release's digests (from that release's GitHub Release notes) — this must run through GitHub Actions, since this box pulls anonymously and has no registry credentials to push a retag itself. Never use an on-box build to "fix" production outside break-glass.

## Changing an environment variable (not an image release)

A value in `env/<env>.env` (or a secret in `env/<env>.secrets.env`) is not an image and the deploy agent never reacts to it. To change one: edit `env/<env>.env`, commit it (ask first — the public value change is a git change like any other), then on the box:
```bash
touch ~/.yuriodev-deploy-paused                                        # belt-and-braces; an image change mid-edit shouldn't race this
docker compose -f <file> up -d --no-deps <backend-service>             # e.g. -f docker-compose.yml backend, or -f deploy/dev/compose.yml backend-dev
curl -s <health-url>/health | python3 -m json.tool                     # confirm the new value took (e.g. `environment`)
rm ~/.yuriodev-deploy-paused
```
This is still a container recreate and a git change on this box — ask first regardless of environment, dev/stage included, not only `prod` (root `CLAUDE.md`'s "any git change... is a production change"). This never touches `env/<env>.secrets.env`'s contents — read/print only the variable *names*, never real secret values.

## Break-glass (only when the pipeline is unusable, and Yurii says so)

1. `touch ~/.yuriodev-deploy-paused` **first** — otherwise the deploy agent reverts a locally built image back to the registry's `:production` within a minute.
2. One service, ask first: `docker compose build <svc> && docker compose up -d --no-deps <svc>`. Never a bare `up -d` / `build` / `restart` (`restart` keeps the old image), never `docker cp` into a container.
3. `.claude/scripts/smoke-test.sh` to verify.
4. Resume normal delivery as soon as possible via a real release (the steps above), then `rm ~/.yuriodev-deploy-paused`.
