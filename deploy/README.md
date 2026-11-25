# Environment pipeline runbook

Operator reference for how a pushed commit becomes `dev` (the repository
owner's branches) -> `stage` (`master`) -> `production` (release tag) on
yuriodev.co.uk. For the site's overall architecture see the repo root
`CLAUDE.md`; this file covers the pipeline only.

## Overview

```mermaid
flowchart LR
    branch["push a branch\n(repository owner only)"] --> ci["CI"]
    master["push / merge to master"] --> ci
    ci -->|green push| build["Images: build once per commit\npush by digest, Trivy, then tag\nsha-&lt;commit&gt; / dev-&lt;commit&gt;\n(reused if already scanned)"]
    build --> retag["Images: retag\nonly when both services exist"]
    retag -->|newest built master head| devtag[":dev\n(follows master)"]
    retag -->|newest built master head| stagetag[":stage"]
    retag -->|dev/* branch still at that commit\n(explicit preview)| devtag
    redeploy["gh workflow run images.yml\n-f branch=&lt;name or master&gt;"] -.->|no rebuild| devtag

    rctag["rc tag, optional\nvX.Y.Z-rc.N"] -.->|older master commit| stagetag
    reltag["release tag\nvX.Y.Z"] --> approval["production\nenvironment approval"]
    approval --> gate["gate: stage digest\n== sha-&lt;commit&gt;\n(waits up to ~15 min)"]
    gate --> prodtag[":production"]

    devtag --> agent["deploy agent\n(cron, every minute)"]
    stagetag --> agent
    prodtag --> agent
    agent --> envs["dev / stage / prod\ncontainers on the box"]
```

Nothing is ever rebuilt after `images.yml`: every later step is a
`docker buildx imagetools create --prefer-index=false` retag, so the exact
same digest that passed CI is what production eventually runs. The deploy
agent is the only thing that ever touches the app containers on the box; the
workflows only move registry tags. The proxy is the exception: it runs a
public nginx image pinned by digest and is only ever recreated by hand (see
"The proxy image" below).

## How to release

1. **Push a branch: dev runs it.** Every push to a branch other than
   `production` and `dependabot/**`, and every PR, triggers `.github/workflows/ci.yml`:
   `frontend` (typecheck, lint at 0 problems, `npm run test`, build, `npm audit
   --audit-level=high`), `e2e` (Playwright against the production build), `backend` (`ruff check`, `ruff format --check`, strict
   `mypy`, `python -m pytest -q --cov` with a 90% branch-coverage gate, and a
   Trivy scan of the pinned `backend/requirements.txt` that fails on a fixable
   HIGH/CRITICAL CVE), `guards` (`scripts/check-compose.py` plus
   `docker compose ... config --quiet` on every compose file) and `images`
   (build-only `runtime` + `dev` targets, no push). The proxy's Trivy scan is a
   separate workflow (`proxy-image.yml`, "The proxy image" below), so it never
   holds up app images. On green CI for a push to `master`, or for a push by
   the repository owner to any other branch (an allowlist: never a PR run, a
   fork, `production`, `dependabot/**`, or anyone else's push, bots
   included), `.github/workflows/images.yml` fires via `workflow_run`. Its
   `build` job builds each service's `runtime` target once, pushes it **by
   digest** (untagged; the branch baked in as `GIT_REF`, reported by
   `/api/health` as `ref`), scans it with Trivy, and only on a clean scan
   tags it immutably: `dev-<commit>` for a branch, `sha-<commit>` for
   `master`. A commit that already has a scanned image is reused, never
   rebuilt (a branch takes `sha-<commit>` or an earlier `dev-<commit>`;
   `master` only `sha-<commit>`). A branch is built and scanned but moves no
   tag by itself: its `retag` job runs only for `master` (step 2) and for a
   branch named `dev/<name>`, the explicit preview, which points `:dev` at the
   commit once both services exist and only if the commit is still the
   branch's head. The deploy agent picks up `:dev` on its next run (within a
   minute), so about 5-7 minutes after the push of a `dev/*` branch
   `dev.yuriodev.co.uk` runs it. Any other built branch is put on dev by hand
   (`gh workflow run images.yml -f branch=<name>`). See "Branch previews on
   dev" below.
2. **Merge to `master`: stage follows by itself.** A `master` push (a merged
   PR or a direct push, whoever pushed it) is built the same way and tagged
   `sha-<commit>`; its `retag` job then points `:stage` at the newest
   `master` head that has both images built, so stage converges on the tip
   whatever order builds finish in. `stage.yuriodev.co.uk` runs the latest
   `master` commit a few minutes after it lands; verify it there
   (`/api/health`: `revision` = the commit, `ref` = `master`).
   **Optional rc tag**, only to put an *older* master commit on stage (for
   example to release it while newer work already sits on `master`):
   ```bash
   git fetch origin && git log HEAD..origin/master --oneline   # confirm the commit is on master
   git tag v1.4.0-rc.1 <commit-sha>
   git push origin v1.4.0-rc.1
   ```
   This runs `.github/workflows/promote-stage.yml`, which requires the tag to
   point at a commit that is an ancestor of `origin/master`, waits (up to
   ~15 minutes each) for `CI` to succeed for that exact SHA and for both
   scanned `sha-<commit>` images to exist in the registry, then retags
   `:stage` under the same `retag-stage` lock as `images.yml`. The pin lasts
   until the next `master` build moves stage on again; iterate `-rc.2`,
   `-rc.3`, ... to pin again.
3. **Promote to production** once stage has been verified, tagging the
   commit stage is running:
   ```bash
   git tag v1.4.0 <commit-sha>
   git push origin v1.4.0
   ```
   This runs `.github/workflows/promote-production.yml` under the `production`
   GitHub environment, which requires reviewer approval (`YuriiOks`) in the
   Actions UI before the job continues. The gate step then waits up to ~15
   minutes for `:stage` for both `frontend` and `backend` to be running the
   exact digest of `sha-<tagged commit>` (a just-merged commit gets that long
   to be built, scanned and put on stage), and otherwise refuses with "tag
   the master commit stage is running" — for example when another `master`
   build moved stage on: release the newer commit instead, or pin stage back
   with an rc tag. On
   success it retags `:production`, fast-forwards the `production` branch to
   that commit, and
   creates a GitHub Release named `v1.4.0` listing both image digests (this
   is also the rollback reference — see below).
4. The deploy agent notices the moved `:production` tag on its next run and
   recreates the changed service(s) on the live box.

Tag regex reminder: `promote-stage.yml` only acts on
`^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$`; `promote-production.yml` only acts on
`^v[0-9]+\.[0-9]+\.[0-9]+$` (no `-rc` suffix). A tag that matches neither is a
no-op for both workflows. Both `v*` tags are admin-only to create per the
repo ruleset.

**Finding an Images run.** `images.yml` is triggered by `workflow_run`, so
GitHub files every Images run under `master`'s tip commit, not the commit it
built: never look one up by head SHA, `gh run list --commit` or `--branch`.
Each run is titled `Images: <branch> @ <sha>` (a manual redeploy: `Images:
put <branch> back on dev`), so `gh run list --workflow images.yml --limit 10`
and read the titles. The registry tags are the source of truth:
`docker buildx imagetools inspect ghcr.io/yuriioks/yuriodev-backend:sha-<commit>`
(or `dev-<commit>`) exists only once that image passed its scan. There is no
workflow-level concurrency, so builds run in parallel and are never dropped;
only the moves of `:dev` and `:stage` are serialised (job-level groups
`retag-dev` and `retag-stage`, the second shared with `promote-stage.yml`).

## Branch previews on dev

**Dev follows `master` by default**: every `master` build moves `:dev` and
`:stage` to the same newest built head, so dev and stage run the same thing
and a push to a feature branch never restarts dev. Every owner branch is still
built and scanned (so a preview needs no rebuild), but only two things put a
branch on dev, explicitly:

- push a branch named `dev/<name>` (the repository owner only): its build
  moves `:dev` to it, and the retag only takes dev if the built commit is still
  that branch's head, so a `dev/*` branch that has moved on, or a re-run of an
  old build, never takes dev back. With two `dev/*` branches **the last build
  to finish wins**.
- dispatch `images.yml` by hand for any branch that is already built (below).

A preview lasts until the next `master` build, which puts dev back on master.
`gh workflow run images.yml -f branch=master` does the same at once, without
waiting for a merge. CI cancels a branch's older run when a newer push to it
arrives. Only the repository owner's branch pushes build; anyone else's push
(bots included) gets CI only.

A preview swaps only the images. Dev keeps running `master`'s
`deploy/dev/compose.yml`, `env/dev.env` and proxy config from the box's
working tree, so a branch's changes to those do nothing on dev until they
are on `master` and applied on the box.

`/api/health` says what dev runs: `ref` is the branch, `revision` the commit
(the site terminal's `status` command prints them as `Branch:` and
`Revision:`). A branch pushed at a commit already built from `master` reuses
that `sha-<commit>` image, so dev then reports `ref: master`.

To put a branch that was already built back on dev, without rebuilding or
pushing again:
```bash
gh workflow run images.yml -f branch=<name>   # retags :dev to the branch head's scanned images; nothing is built
gh run list --workflow=images.yml --limit 3    # "Images: put <name> back on dev"; the deploy agent follows within a minute
```
That `redeploy-dev` job (same `retag-dev` lock) takes `master` (dev back on
the master head) or any branch except `production` and `dependabot/*`, and fails unless the branch's head
commit already has scanned images for both services (`dev-<sha>` or
`sha-<sha>`): push the branch, or wait for its build. Stage following
`master` is the only behaviour: the old `STAGE_AUTO_PROMOTE` repo variable is
no longer read by any workflow (if `gh variable list` still shows it, it does
nothing and can be deleted).

## Dry-run mode

The repo variable `PROD_DRY_RUN`, when `true`, makes
`promote-production.yml` run every check (ancestry, approval, the
stage-digest gate) and write its summary, but skip the actual retag, the
`production` branch fast-forward, and the GitHub Release — nothing changes.
Useful for rehearsing a release tag or testing the gate logic without moving
production.
```bash
gh variable set PROD_DRY_RUN --body true
gh variable set PROD_DRY_RUN --body false
```

## The deploy agent

`deploy/agent/yuriodev-deploy.sh`, invoked every minute from the user
crontab:
```
* * * * * ENABLED_ENVS="dev stage" /home/yurii/yuriodev-deployment/deploy/agent/yuriodev-deploy.sh
```
For each environment named in `ENABLED_ENVS` (space-separated; e.g. `"dev
stage prod"`) it reads that environment's compose file (`deploy/dev/compose.yml`,
`deploy/stage/compose.yml`, or the root `docker-compose.yml` for `prod`),
finds every service whose `image:` starts with `ghcr.io/`, pulls it
anonymously (the GHCR packages are public; the server holds no registry
credentials), and — only if the pulled image ID differs from what the
running container has — recreates that one service with
`docker compose up -d --no-deps <svc>`. It then waits for the new container
to come healthy before logging it as deployed: both the frontend and backend
images carry a Dockerfile `HEALTHCHECK`, so it polls `docker inspect`'s
`.State.Health.Status` for up to ~90s; only an image without a `HEALTHCHECK`
(an older, pre-hardening image) falls back to a request through the proxy
container (`GET /` for frontends, `GET /health` for backends, up to 6 tries
5s apart). If the new container doesn't come healthy, it puts the previous
image back (see "Automatic rollback and quarantine" below). It never touches
a service that isn't already updated, and it
never builds anything, and it never reacts to an `env/` file changing — only
to a changed image ID (see "Environment config" below).

- **Kill switch:** `touch ~/.yuriodev-deploy-paused` — the agent exits
  immediately on its next run without touching any container. Running
  containers keep running. Remove the file to resume.
- **Log:** `~/.local/state/yuriodev-deploy.log` (the agent's own structured
  lines: `<timestamp> <env> <svc> DEPLOYED|FAILED|ROLLED BACK|ROLLBACK
  FAILED|SKIPPED|QUARANTINE lifted|ERROR|REFUSED ...`, plus `WARN` lines
  about the optional alert files and about state files it could not write;
  a `WARN` for a condition that persists, such as a mis-permissioned URL file
  or an unreachable ping endpoint, is logged once, and again only after the
  condition has cleared and come back). Writing the log, the quarantine files
  or a `WARN` marker never stops a run: with a full disk the agent still rolls
  back and alerts. Once it passes 5 MB it is rotated to
  `.log.1` (older ones shift to `.2` and `.3`; the fourth is dropped). The
  crontab additionally redirects raw stdout/stderr to
  `~/.local/state/yuriodev-deploy.cron.log`, which is not rotated.
- **Heartbeat:** `~/.local/state/yuriodev-deploy.heartbeat` — touched at the
  end of every run that wasn't paused/locked-out; a stale timestamp means the
  agent stopped running, or aborted on an unexpected error (look for
  `ERROR agent aborted at line N` in the log, then the crontab and the cron log).
- **Lock:** the script takes a non-blocking `flock` on
  `~/.local/state/yuriodev-deploy.lock`, so an overrunning invocation (a
  rollback can take a few minutes of health waits) is skipped rather than
  overlapped.
- **Exit status:** 0, or 1 when any enabled environment logged an
  `ERROR`/`FAILED`/`REFUSED` line (a failed pull included), or has a service
  marked `.broken` (below: no healthy image left running). One environment
  failing never stops the others from being processed.

### Automatic rollback and quarantine

Before recreating a service the agent records the image ID the running
container uses. It then runs `docker compose up -d --no-deps <svc>` and waits
for health as above.

**`compose up` fails and nothing changed** (the container still runs the
previous image, so the new one never ran; typically a daemon, port or compose
problem): the agent logs `<env> <svc> FAILED compose up while deploying
<repo@sha256:...>; nothing was recreated (still running <image ID>); retrying
next run`, alerts once for that digest, exits 1, and retries every minute.
Nothing is rolled back or quarantined, because the release itself may be fine.
Dev and stage keep serving the old image meanwhile.

**The new container does not come healthy** (or `compose up` failed after it
had already replaced the container), the agent:

1. logs `<env> <svc> FAILED health check after deploying <repo@sha256:...>;
   rolling back to <previous image ID>` (`FAILED compose up while deploying`
   in the second case);
2. saves the failed container's health status and last 200 log lines to
   `~/.local/state/yuriodev-deploy.quarantine/<env>.<svc>.failed.log`.
   The rollback recreates the container, and that deletes the container and
   its logs, so after a rollback `docker compose logs` only shows the
   rolled-back container. This file is the only record of why the new image
   failed;
3. points the local tag (`:dev` / `:stage` / `:production`) back at the
   previous image ID and recreates the service from it
   (`docker compose up -d --no-deps --force-recreate <svc>`), then waits for
   health again. On success it logs `ROLLED BACK to ...`. Otherwise it logs
   `ROLLBACK FAILED to ... (<cause>)`, where the cause is `re-tagging the
   previous image failed`, `compose up of the previous image failed` or `the
   previous image is unhealthy too`;
4. quarantines the failed digest in
   `~/.local/state/yuriodev-deploy.quarantine/<env>.<svc>` and keeps a local
   copy of the failed image as `<repo>:quarantined-<env>`, so the next pulls
   don't download it again;
5. sends the optional alert (below) and exits 1.

A service that had no container yet has nothing to roll back to: the agent
logs `FAILED ... no previous container to roll back to`, saves the same
`.failed.log`, quarantines and alerts.

**Broken services.** After `ROLLBACK FAILED`, or a failed first deploy, no
healthy image is left running. The agent then also writes
`<env>.<svc>.broken`, and every later run exits 1 and skips the success ping
while that file exists. The dead-man's switch below therefore stays down
until the problem is resolved; it does not clear itself a minute later. The
first skipped run logs `SKIPPED quarantined ...; ERROR no healthy image is
running, needs a human`. The marker is removed when the quarantine lifts
(below), when that service deploys successfully, or when you reset it by
hand.

While the registry tag still points at the quarantined digest, every run
pulls it, sees it is quarantined, and skips the service. It also points the
local tag back at the running image, or removes the local tag if no container
exists, so a manual `docker compose up` can't start the failed image either.
It logs `SKIPPED quarantined ...` once, not every minute.
The quarantine lifts by itself as soon as the registry tag moves to any other
digest (a new branch build for dev, a new master build or rc tag for stage,
`rollback-production.yml` or a new release for prod): the agent logs
`QUARANTINE lifted: the tag moved from ... to ...`, drops the held copy, the
`.failed.log` and any `.broken` marker, and deploys the new digest as usual
(or does nothing, if the tag moved back to what is already running).

Diagnosing a quarantined digest:
```bash
ls ~/.local/state/yuriodev-deploy.quarantine/                              # one set of files per <env>.<svc>
cat ~/.local/state/yuriodev-deploy.quarantine/dev.frontend-dev             # the quarantined digest
cat ~/.local/state/yuriodev-deploy.quarantine/dev.frontend-dev.failed.log  # health + last 200 log lines of the failed container
docker run --rm ghcr.io/yuriioks/yuriodev-frontend:quarantined-dev         # reproduce by hand (Ctrl-C to stop; backends need their env: add --env-file env/<env>.env)
```
The held image runs with no network, env file or limits from the compose
file, so a failure that comes from the environment (a missing secret, the
proxy, the network) may not reproduce this way.

To retry the **same** digest by hand, for example after fixing an
environment-side cause such as a missing secret:
```bash
rm -f ~/.local/state/yuriodev-deploy.quarantine/dev.frontend-dev \
      ~/.local/state/yuriodev-deploy.quarantine/dev.frontend-dev.*   # the digest, .noted, .broken, .failed.log, .upfailed
tail -f ~/.local/state/yuriodev-deploy.log                            # the next run (within a minute) deploys it again
```
(`rm -rf ~/.local/state/yuriodev-deploy.quarantine` resets every service.) The
held `<repo>:quarantined-<env>` image is removed on the next successful
deploy of that service.

This only catches an image that fails its health check. A release that is
healthy but wrong still needs the release rollback below.

### Alerts and a dead-man's switch (optional, off by default)

Two optional files, each holding one `http(s)://` URL on its first line. The
agent ignores a file (and logs a `WARN`, once) unless it is owned by `yurii`
and has mode 600 (or 400), and it never writes either URL to its log. Nothing
lives in the repo.

- `~/.config/yuriodev/deploy-alert-url`: on every `FAILED`, `ROLLED BACK` or
  `ROLLBACK FAILED`, the agent POSTs a one-line plain-text message
  (`curl -fsS -m 10 --retry 2 --data-binary "<message>" <url>`). Messages
  that need action end in `needs a human`. A `FAILED compose up` that
  changed nothing alerts once per digest, not every minute. Anything that
  accepts a plain POST body works; an ntfy.sh topic URL
  (`https://ntfy.sh/<long-random-topic>`) is the simplest. A failed delivery
  is logged as `WARN alert delivery failed` and never stops the run.
- `~/.config/yuriodev/deploy-ping-url`: a plain GET at the end of every run
  that exited 0. Point it at a healthchecks.io check
  (`https://hc-ping.com/<uuid>`) with a period of 1 minute and a grace time
  of about 10 minutes. The check goes down, and emails you, when the agent
  stops running, aborts, keeps failing (a GHCR outage longer than the grace
  time included), or has a `.broken` service. A service that was **rolled
  back** successfully and is now quarantined still counts as 0 and still
  pings: it is serving a healthy image, and the alert URL has already told
  you about it. Paused or locked-out runs don't ping, so pausing the agent
  for longer than the grace time also alerts; pause the check in
  healthchecks.io first if that is planned. An unreachable ping endpoint is
  logged as `WARN success ping failed`, once, until a ping gets through again.

Recommended setup: an ntfy topic (or any other push channel) for the alert
URL, and a separate healthchecks.io check only for the ping URL. If you point
both at one healthchecks.io check instead (`https://hc-ping.com/<uuid>/fail`
as the alert URL), a rollback flips the check down and the next successful run
flips it straight back up. That is correct for a rolled-back service, but the
"down" can be easy to miss, so read the alert itself.
```bash
mkdir -p ~/.config/yuriodev && chmod 700 ~/.config/yuriodev
( umask 077 && printf '%s\n' 'https://ntfy.sh/<long-random-topic>' > ~/.config/yuriodev/deploy-alert-url )
( umask 077 && printf '%s\n' 'https://hc-ping.com/<uuid>'          > ~/.config/yuriodev/deploy-ping-url )
stat -c '%a %U %n' ~/.config/yuriodev/deploy-*-url                 # expect 600 yurii
```
Remove a file to switch that part off again.

## The proxy image (`yuriodev-proxy`)

The root `docker-compose.yml` pins the proxy as
`nginx:stable-alpine@sha256:<digest>` and mounts `./nginx-proxy` read-only
(`:ro`; nginx never writes there, the host still edits it and reloads per the
golden rules). The first pin (2026-09-25; `docker-compose.yml` holds the
current one),
`sha256:985220252f3863977e468f611ef118ebd01421289dd86ee1ae99cb068c3bce2b`, was
the multi-arch index behind `stable-alpine` (the same index as `1.30-alpine`
and `stable-alpine3.24`): nginx 1.30.5 on Alpine 3.24, built 2026-09-22. Before
it, the proxy ran whatever `nginx:stable-alpine` happened to be cached on the
box (nginx 1.28.0).

**What the deploy agent does with the proxy: nothing.** `services_of()` in
`deploy/agent/yuriodev-deploy.sh` lists only services whose `image:` starts
with `ghcr.io/`, so the agent never pulls the nginx image and never runs `up`
for the proxy. The only `up` it runs in the root compose file (when `prod` is
in `ENABLED_ENVS`) is `docker compose up -d --no-deps frontend|backend`, and
only when that service's image ID changed; `--no-deps` keeps compose from
touching the proxy even though the proxy's definition in the file changed.
Its closing `docker image prune -f` removes only dangling images, never an
image a container runs. So pulling a pin change (this one, or a later
Dependabot digest bump) into the live tree changes nothing that is running:
the proxy keeps its old image and its read-write mount until it is recreated
by hand, once, at a quiet time.

**Rolling out a new pin** (a production change: ask Yurii first; every
environment blips for a few seconds while the proxy is swapped):
```bash
cd ~/yuriodev-deployment                              # the live tree, with the pin change pulled in
touch ~/.yuriodev-deploy-paused                       # keep the agent from deploying (and exec-ing into the proxy) mid-swap
OLD_ID=$(docker inspect -f '{{.Image}}' yuriodev-proxy)                        # the image running now
docker image inspect -f '{{join .RepoDigests " "}}' "$OLD_ID"                  # note its nginx@sha256:... digest (the rollback pin)
docker tag "$OLD_ID" yuriodev-proxy:last-good                                  # a tag keeps it safe from `docker image prune`
docker compose pull proxy                             # fetch the pinned digest; nothing restarts yet
IMG=$(awk '/^  proxy:/{p=1} p&&/^    image:/{print $2; exit}' docker-compose.yml)
docker run --rm --network none -v "$PWD/nginx-proxy:/etc/nginx/conf.d:ro" \
  -v "$PWD/certbot/conf:/etc/letsencrypt:ro" "$IMG" nginx -t   # new nginx + current config, before the switch
docker compose up -d --no-deps proxy                  # the one recreate
docker compose ps proxy                               # "healthy" after the first 30 s healthcheck
.claude/scripts/smoke-test.sh                         # prod/dev/stage through the new proxy
rm ~/.yuriodev-deploy-paused
```
**Rollback:** re-pin, don't revert. Set the proxy's `image:` to the previous
digest you noted above (`nginx:stable-alpine@sha256:<old digest>`), keep the
`:ro` mount, and run `docker compose up -d --no-deps proxy` again; commit that
line so `scripts/check-compose.py` and `proxy-image.yml` stay green. Reverting
the pin commit instead would bring back an unpinned image and a read-write
mount, which CI's `guards` job rejects. The `yuriodev-proxy:last-good` tag
keeps the old image on the box: an image referenced only by digest has no tag,
and the agent's per-minute `docker image prune -f` may delete it once no
container uses it, after which a rollback would need a pull from Docker Hub.
In an emergency, `image: yuriodev-proxy:last-good` (uncommitted, live tree
only) gets the old image back with no download; replace it with the digest pin
afterwards. Remove the tag (`docker rmi yuriodev-proxy:last-good`) once the new
proxy has proved itself.

**Keeping it fresh:** Dependabot's `docker-compose` entry (`.github/dependabot.yml`)
opens a PR with the new digest when `stable-alpine` moves. The
`.github/workflows/proxy-image.yml` workflow scans whatever digest the file
pins (on every push/PR that changes `docker-compose.yml`, weekly, and on
demand) and fails on a fixable HIGH/CRITICAL CVE. It is a separate workflow on
purpose: `images.yml` only builds app images when the whole `CI` workflow
passed, and a proxy CVE must not stop `:dev`/`:stage` or a hotfix, so a red
`Proxy image` run gates nothing; it is a to-do. It also scans the pinned
image, not the running one. If it fails before Dependabot has proposed a bump,
resolve a fresh digest (`docker buildx imagetools inspect nginx:stable-alpine
--format '{{json .Manifest.Digest}}'`), pin it, merge, and roll out as above;
right after Alpine publishes a fix, `stable-alpine` may not be rebuilt yet, so
no clean digest exists for a day or two. Every merged bump needs that manual
rollout: until then `.claude/scripts/smoke-test.sh` reports `prod digest
(proxy)` as WARN (running proxy != pin) or INFO (pin not pulled yet).

## Environment config (`env/`)

Each backend service's non-secret config is tracked in `env/<env>.env`
(`local`, `dev`, `stage`, `prod` — `ENVIRONMENT`, `API_TITLE`, `API_VERSION`,
`CORS_ORIGINS`, `LOG_LEVEL`, and the social feed flags once it is turned on).
Real secrets, if any, go in a gitignored
`env/<env>.secrets.env` (mode 600, created on whichever machine runs that
environment; there is no such file on this box yet). `env/secrets.env.example`
lists the expected secret variable *names* only, never values — start there
when adding one. SOPS+age encryption of the secrets files in place, same
filenames, is planned but not built yet.

Every compose file's backend service loads both, in this order, via the long
`env_file` form:
```yaml
env_file:
  - path: ./env/<env>.env
    required: true
  - path: ./env/<env>.secrets.env   # gitignored
    required: false
```
so a missing secrets file is fine (the public config still loads) and a
secret can only *add* to the public config, never silently replace it by
being absent.

To add or change a value:
```bash
$EDITOR env/dev.env                                    # or env/stage.env, env/prod.env
git add env/dev.env && git commit -m "..."              # this is a tracked, public file
touch ~/.yuriodev-deploy-paused                          # optional belt-and-braces
docker compose -f deploy/dev/compose.yml up -d --no-deps backend-dev
curl -sk -u <user>:<pass> https://dev.yuriodev.co.uk/api/health | python3 -m json.tool   # dev is behind basic auth (credentials at ~/.config/yuriodev/basic-auth.txt); or the internal /health; confirm it took
rm ~/.yuriodev-deploy-paused
```
Recreating just that one service picks up the new env file; it does not
rebuild or affect the other service or environment. **The deploy agent never
reacts to an env file changing** — only to a changed image ID — so this
recreate step is always a manual, one-off action, every time. Production
follows the same pattern via `env/prod.env` and the root `docker-compose.yml`
`backend` service. Every step above — the git commit, the container recreate
— is a production change per root `CLAUDE.md` regardless of which
environment it's for: **ask Yurii first**, dev/stage included, not only prod.

The pre-`env/` files (`backend/.env`, `backend/.env.example`,
`deploy/{dev,stage}/backend.env`) were retired on 2026-09-24 after a full
release cycle on `env/`; don't recreate them, and never read or print any
`env/*.secrets.env`.

## Social feed (`GET /api/posts`)

The backend can serve Yurii's own published X and LinkedIn posts, read from
Typefully, at `/api/posts`. It ships **off** in every environment: with no
settings the route answers `200` with `"enabled": false` and no items, and
nothing calls Typefully. Only production is meant to poll Typefully (every
30 minutes, one listing call plus a full-draft call per new or edited draft);
dev and stage use the bundled synthetic fixture, so they never need a key.
Hand curation (pin, feature, hide, posts that never went through Typefully)
lives in `backend/src/feed/content/posts.toml` and ships with a release.

Turning it on is an env change plus a backend recreate — a production change
for every environment, so **ask Yurii first**, and follow "Environment config"
above for the commit/recreate mechanics.

**dev / stage (and local): fixture.** Add to `env/dev.env` (then
`env/stage.env`, and `env/local.env` for the Mac):
```
SOCIAL_FEED_ENABLED=true
SOCIAL_FEED_PROVIDER=fixture
```
then recreate one backend at a time:
```bash
touch ~/.yuriodev-deploy-paused
docker compose -f deploy/dev/compose.yml up -d --no-deps backend-dev
curl -sk -u <user>:<pass> https://dev.yuriodev.co.uk/api/posts | python3 -m json.tool   # "provider": "fixture", "status": "fresh"
rm ~/.yuriodev-deploy-paused
```
(and the same with `deploy/stage/compose.yml` / `backend-stage`).

**prod: Typefully.** From this box, check the origin with `--resolve` (as
below): `/etc/hosts` points `yuriodev.co.uk` at this machine, whose
certificate is a Cloudflare Origin CA one, so a plain `curl -s
https://yuriodev.co.uk/...` fails TLS verification and prints nothing — and a
check piped from it would pass without having checked anything. Through
Cloudflare instead: `curl -fsS --doh-url https://1.1.1.1/dns-query
https://yuriodev.co.uk/api/posts`.

Before turning prod on, all of these hold:
- Typefully has answered the question about showing posts on the site under
  its Terms (and the plan includes API access).
- `posts.toml` is back-filled, so curated plus imported posts come to at least
  3 items.
- You know whether Typefully lets you tag a draft after it is published
  (that decides how "Hide a post" below works).

First release the code with the feature still off and check it:
```bash
curl -fsSk --resolve yuriodev.co.uk:443:127.0.0.1 https://yuriodev.co.uk/api/posts \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["enabled"])'     # must print False
```
Then:
1. Yurii creates an API key in Typefully (Settings -> API). A Typefully key
   carries its creator's full permissions (it can publish), so it goes only
   into the gitignored secrets file on the box, typed there directly — never
   into chat, a commit or any tracked file:
   ```bash
   cd ~/yuriodev-deployment
   [ -e env/prod.secrets.env ] || install -m 600 /dev/null env/prod.secrets.env
   ${EDITOR:-nano} env/prod.secrets.env        # add the line TYPEFULLY_API_KEY=<value>
   ```
2. Add to `env/prod.env` and commit it (public, non-secret values):
   ```
   SOCIAL_FEED_ENABLED=true
   SOCIAL_FEED_PROVIDER=typefully
   TYPEFULLY_SOCIAL_SET_ID=334563
   ```
3. Recreate the backend and check the feed, by behaviour only (never print
   the environment or the secrets file):
   ```bash
   touch ~/.yuriodev-deploy-paused
   docker compose up -d --no-deps backend
   origin() { curl -fsSk --resolve yuriodev.co.uk:443:127.0.0.1 "https://yuriodev.co.uk$1"; }
   origin /api/health | python3 -m json.tool
   origin /api/posts | python3 -m json.tool                                 # source.status "fresh" within a minute
   body=$(origin /api/posts) && printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=json.dumps(d); bad=[k for k in ("scratchpad","private_url","share_url","draft_title","typefully.com") if k in s]; print(d["source"], len(d["items"]), "items"); sys.exit(f"LEAK {bad}" if bad else 0)' && echo CLEAN   # must end with CLEAN
   docker compose logs --since 10m backend | grep '"feed\.'                  # feed.refresh lines; no key material
   rm ~/.yuriodev-deploy-paused
   ```
   The leak check fails loudly (no `CLEAN`) if the fetch fails, the body is not
   JSON, or a private field shows up.

`source.status` says how the feed is doing: `fresh` (last success within an
hour), `stale` (older; posts still shown), `error` (the key was rejected, the
key or set id is missing or the key has a stray character in it — logged once
as `feed.misconfigured` — or there has been no success for 72 hours; only
curated posts are shown), `disabled` (off). A rejected key stops polling until
the next recreate. A `feed.drift` or `feed.listing_invalid` warning means
Typefully's answers no longer look as expected: the previous posts stay up
(and go `stale`) until the code is adjusted.

- **Hide a post:** if Typefully lets you tag a published draft, tag it
  `hide-from-site` (gone at the next poll); otherwise, or as well, add
  `[[override]] id = "..." hide = true` to `posts.toml` (next release).
- **Rotate the key:** create the new key, replace the value in
  `env/prod.secrets.env`, recreate the backend as in step 3, check
  `source.status`, then revoke the old key in Typefully.
- **Kill switch:** set `SOCIAL_FEED_ENABLED=false` in `env/prod.env` and
  recreate the backend as in step 3.
- **Optional persistence:** `SOCIAL_FEED_SNAPSHOT_PATH=/app/data/posts-snapshot.json`
  keeps the last good snapshot in the container's writable layer across
  restarts (not recreates); unset, the feed is memory-only and refills within
  seconds of a start.

## Dashboards database (`/api/dashboards/**`, `/api/mcp`)

The backend can serve real tasks and calendar events for the three spaces
(`personal`, `work-1`, `work-2`) to the dashboards page and to MCP clients. It
ships **off** everywhere except dev's one-time setup below: with no
`DATABASE_URL` the API answers `{"enabled": false}` on
`/api/dashboards/v1/bootstrap` (no authentication needed) and 503
`dashboards_disabled` on everything else, and the page keeps showing its bundled
sample data. Each environment has its own Postgres container, defined in that
environment's compose file and never publishing a port:

| Environment | Service / container | Volume | Host in `DATABASE_URL` |
|---|---|---|---|
| dev | `postgres-dev` / `yuriodev-dev-postgres` | `yuriodev-dev-postgres-data` | `yuriodev-dev-postgres` |
| stage (defined, not started) | `postgres-stage` / `yuriodev-stage-postgres` | `yuriodev-stage-postgres-data` | `yuriodev-stage-postgres` |
| prod (defined, not started) | `postgres` / `yuriodev-postgres` | `yuriodev-postgres-data` | `yuriodev-postgres` |

The deploy agent ignores them (they are not `ghcr.io` images): they are started
and recreated by hand, like everything in this section, so every step is a
production change: **ask Yurii first.** The backend creates and updates the
schema itself: at start it runs `alembic upgrade head` in the background
(retrying until the database answers, so the order "database first, backend
second" is a convenience, not a requirement), which also seeds the spaces and
the ten personal life areas. Until that finishes the API answers 503
`dashboards_unavailable`.

Access: a request is accepted when `DASHBOARDS_TRUST_PROXY_AUTH=true` (tracked
in `env/dev.env`: nginx basic auth already ran; never set it in prod) or when
the header `X-Dashboards-Token` equals `DASHBOARDS_API_TOKEN` (not
`Authorization`, which basic auth owns on dev). With neither configured every
request is 401. Production stays off until Cloudflare Access sits in front of it.
Cross-site writes: where nginx basic auth is trusted, the browser sends the cached credentials with a
form posted from any page, so a write (anything but GET, HEAD, OPTIONS) is refused with 403
`cross_site` when the browser says another site sent it (`Sec-Fetch-Site` other than `same-origin`
or `none`, or an `Origin` that is not `DASHBOARDS_PUBLIC_BASE_URL`, else the host asked); scripts and
`curl` send neither header and are not affected, nor is a request with a valid token header. The two
file-upload routes (`/finance/recurring/import`, `/finance/manual/accounts/{id}/statement`) also
answer 415 to `text/plain`, `application/x-www-form-urlencoded` and `multipart/form-data` (what an
HTML form can send): give `curl --data-binary` a `-H 'Content-Type: text/csv'`.

Space names: the page calls the spaces "Personal", "Work 1" and "Work 2". To show real names
without putting them in the public repo, add one line to the environment's secrets file (invented
example) and recreate the backend:

```
DASHBOARDS_SPACE_NAMES={"work-1": "Acme", "work-2": "Globex"}
```

Keys are `personal`, `work-1`, `work-2` (all optional), each value 1 to 24 printable characters,
trimmed. An entry that is invalid is ignored on its own, and a value that is not a JSON object is
ignored as a whole: it never stops the backend and nothing is logged. `GET /bootstrap` then
returns `name` for every space (the override, else the English default) and the page shows it in
both languages in the bar, hub cards, space heading, calendar legend, event form and tab title;
a space with no override keeps its bundled bilingual name ("Work 1" / "Работа 1"). URLs stay
`/dashboards/work-1`. Sample-data mode is unchanged.

Space icons: to draw a brand mark instead of the letter or number tile, add one more line to the
same secrets file (a JSON object keyed by `personal`, `work-1`, `work-2`, all optional; the value
is the image itself as a base64 data URI, so nothing is fetched from anywhere):

```
DASHBOARDS_SPACE_ICONS={"work-1": "data:image/png;base64,<base64 of the image>"}
```

Allowed: `data:image/png;base64,`, `data:image/svg+xml;base64,`, `data:image/x-icon;base64,`,
`data:image/vnd.microsoft.icon;base64,` and `data:image/webp;base64,`, a valid base64 payload, at
most 48 KiB per value (the whole string). Anything else (a link, another type, a bad payload, too
big) is dropped for that space alone and never stops the backend; nothing is logged. A value is
easy to make with `base64 -i logo.png | tr -d '\n'` (write the `data:` prefix before it, and keep
the file out of the repo). `GET /bootstrap` returns `icon` (a string or null) next to each
space's `name`; the page draws it in the 24px tile of the hub cards and the space heading. The
personal space's tile shows the site's own mark on the live dashboards even with no setting
(bundled in the frontend, not fetched). The site's CSP allows `img-src 'self' data:`, which is why
only data URIs are accepted. Sample-data mode keeps the letter tiles.

### Projects (a schema each)

Besides the three spaces the dashboards can hold projects (the first ones: a court case and a side
project). Each project is a row in `project` and gets a Postgres schema of its own,
`project_<id>` (for example `project_garden`), holding its own `task` table: the data of one
project is physically apart from the others and from the spaces' tables, in the same database and
the same backup (`pg_dump` below covers every schema). Projects are created from the page or over
MCP (`add_project`); the id is made from the name (a taken one is refused). A project may carry an icon key (lower-case letters, digits and hyphens, at most 24: the name of one of the page's own drawings; the backend only checks the shape, so a new drawing needs no backend change). There is no delete:
a project is archived (still readable, no longer writable) and can be unarchived, and nothing in
the application ever drops a schema. To change the tables of the project schemas later a release
bumps the per-project schema version; at startup the backend brings every project up to it, one
transaction each, so a deploy needs no manual step. If a project ever has to be removed for real
it is a manual `DROP SCHEMA` by the owner after a dump, never something the backend does.

### One-time setup of dev

Run on the box, in `~/yuriodev-deployment`, once the commit with these files is
on its working tree (the usual pause / `git pull --ff-only` / unpause, see
"Applying the proxy hardening" step 0 for the tree catch-up) and the `:dev`
backend image contains this code. The first command creates the secrets with
generated values and prints nothing; it refuses to touch a file that already
sets one of the names:

```bash
cd ~/yuriodev-deployment
[ -e env/dev.secrets.env ] || install -m 600 /dev/null env/dev.secrets.env
if grep -qE '^(DATABASE_URL|POSTGRES_PASSWORD|DASHBOARDS_API_TOKEN)=' env/dev.secrets.env; then
  echo "env/dev.secrets.env already sets one of the names: stop and look by hand"
else
  pw=$(openssl rand -hex 24); token=$(openssl rand -hex 32)
  printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgresql://dashboards:%s@yuriodev-dev-postgres:5432/dashboards\nDASHBOARDS_API_TOKEN=%s\n' \
    "$pw" "$pw" "$token" >> env/dev.secrets.env
  unset pw token
fi
touch ~/.yuriodev-deploy-paused
docker compose -f deploy/dev/compose.yml up -d --no-deps postgres-dev
docker compose -f deploy/dev/compose.yml ps postgres-dev                   # wait for "healthy"
docker compose -f deploy/dev/compose.yml up -d --no-deps backend-dev        # recreate: picks up the secrets
curl -sk -u <user>:<pass> https://dev.yuriodev.co.uk/api/dashboards/v1/bootstrap | python3 -m json.tool
docker compose -f deploy/dev/compose.yml logs --since 5m backend-dev | grep 'dashboards\.'
rm ~/.yuriodev-deploy-paused
```

The bootstrap answer must say `"enabled": true` with three spaces and ten areas
(basic-auth credentials: `~/.config/yuriodev/basic-auth.txt`); the log shows
`dashboards.ready` (and `dashboards.migrate_failed` lines, with only the error
class, while the database was still starting). `enabled: false` means the
backend did not get `DATABASE_URL`; 503 `dashboards_unavailable` means it has
it but cannot reach or migrate the database (check `docker compose ... ps` and
the backend log). The hex password needs no URL encoding; a password with
special characters must be percent-encoded inside `DATABASE_URL`. Never print
or paste the secrets file; the token goes only where an MCP client or a script
is configured. `POSTGRES_PASSWORD` is read only when the database is first
created: changing it later in the file does nothing to an existing volume
(change the password in the database with `ALTER USER`, then edit the file,
then recreate the backend). Stage and prod follow the same steps with their
own names (`stage.secrets.env`, `postgres-stage`, `backend-stage`; prod: the root
`docker-compose.yml`, `postgres`, `backend`) once the owner decides to turn
them on.

### Backup and restore

Backups are logical dumps taken inside the container (the image trusts its own
local socket, so no password is needed), written to a dated file with mode 600:

```bash
mkdir -p ~/backups/dashboards && chmod 700 ~/backups/dashboards
docker exec yuriodev-dev-postgres pg_dump -U dashboards -d dashboards --format=custom \
  > ~/backups/dashboards/dev-$(date -u +%Y%m%dT%H%M%SZ).dump
chmod 600 ~/backups/dashboards/dev-*.dump
```

Restore replaces the whole content (tables, seed and migration state) with the
dump. Stop writes first, restore, then bring the backend back:

```bash
touch ~/.yuriodev-deploy-paused
docker compose -f deploy/dev/compose.yml stop backend-dev
docker exec -i yuriodev-dev-postgres pg_restore -U dashboards -d dashboards --clean --if-exists --no-owner \
  < ~/backups/dashboards/dev-<timestamp>.dump
docker compose -f deploy/dev/compose.yml start backend-dev
rm ~/.yuriodev-deploy-paused
```

Never `docker compose down -v` or remove the volume: it is the data. A
Postgres major upgrade (Dependabot ignores majors on purpose) is a dump,
a new volume and a restore, not an image bump.

## Collectors (GitHub, Linear, calendar)

The backend can fill a space with your work items on its own and close the tasks when the
items close. A background loop inside the backend (only when `DATABASE_URL` is set, see
"Dashboards database") polls every `DASHBOARDS_COLLECT_INTERVAL_SECONDS` (default 300, at
least 30) and runs each collector separately: one failing, being rate limited or timing out
never stops the other or the app. A Postgres advisory lock lets only one process poll at a
time. Every outbound call has a timeout (20 s each, 120 s per collector run) and the logs say
only the collector name, counts and an error kind: never a URL, token, title or response body.

| Collector | Switched on by | Reads | Target space |
|---|---|---|---|
| GitHub | `GITHUB_TOKEN` | open pull requests you authored (`author:@me`), open pull requests with a review requested from you or from a team you are in (`review-requested:@me` and `team-review-requested:<org>/<team>`), and open pull requests of others that you already reviewed and that do not ask for you again (`reviewed-by:@me -author:@me -review-requested:@me`, one query), through the REST search API; `GITHUB_SEARCH_SCOPE` is appended to both queries (for example an `org:<name>` qualifier) | `GITHUB_SPACE`, default `work-1` |
| Linear | `LINEAR_API_KEY` | issues assigned to the key's user whose state type is not `completed`, `canceled` or `duplicate`, through GraphQL | `LINEAR_SPACE`, default `work-1` |

`stage` is a short grouping label the collector sets (the page groups the GitHub and Linear tabs by it;
you cannot set it, and manual tasks have none): Linear, the issue's workflow state type (`started`,
`unstarted`, `backlog` or `triage`; anything else is no stage); GitHub, `mine` for pull requests you
opened, `review` for pull requests waiting for your review (yours or your team's) and `reviewed` for
open pull requests you reviewed already (a new review request moves one back to `review`). A change of stage alone updates the
task and never brings a deleted one back (the tombstone fingerprint is title and link only).

Every collected task also carries what the source says, for ordering and marking (`GET .../tasks`
and the MCP tools): `source_priority` (Linear: `urgent`, `high`, `medium`, `low` or `none`; null
for GitHub and for manual tasks), `source_updated_at` (when the issue or pull request last changed
there) and `draft` (a GitHub pull request that is still a draft). They are never your Priority
flag: an urgent Linear issue does not appear in the hand-picked Priority panel unless you set it.
Lists come most urgent first, then most recently updated.

Tasks are titled `PR #123: <title>`, `Review PR #123: <title>` and `<IDENTIFIER>: <title>`, and
carry a link (the page shows it). The target space can be `personal` or `work-1`: `work-2` is
refused at startup.

Minimum credentials: GitHub, a fine-grained personal access token with read-only "Pull
requests" and "Metadata" on the repositories to watch (a classic token needs `repo` for
private repositories, `public_repo` for public ones). **Team review requests also need the token to
see your team membership**: classic `read:org`, or a fine-grained token with the organisation
permission "Members: read" (the organisation must have approved the token). Without it only direct
requests arrive, silently (compare the review list with GitHub's own "Review requests" page);
the collector never fails for it. A token created with only the minimum above has no such access; Linear, a personal API key (read
access is enough; it is sent as the `Authorization` header as is).

Who owns what: the collector owns a collected task's title, link, `stage` and open/done status and
rewrites them on every poll (so finishing one by hand does not stick while the item is still
open upstream); you own priority, notes, area, due date and everything else, which a poll never
touches. A Linear due date is used only when the task is first created. When an item closes,
is reassigned or stops matching, its task is marked done, never deleted. If you delete a
collected task it is not recreated while the item is unchanged (a tombstone remembers a
fingerprint of its title and link); a changed title or link brings it back, and the tombstone
disappears when the item is gone upstream. A poll that fails or comes back cut off (more than
1000 search results, an incomplete answer, more pages than the cap) changes nothing: tasks are
only closed on a complete answer. A rate-limited source is left alone until the time it asked
for (between one and sixty minutes).

Switching one on for dev (a production change per the rules above: ask first). Create the
values only in the gitignored secrets file, typed there directly, never into chat or a tracked
file; example for GitHub:

```bash
cd ~/yuriodev-deployment
${EDITOR:-nano} env/dev.secrets.env      # add GITHUB_TOKEN=<value> and, if wanted, GITHUB_SEARCH_SCOPE=org:<name>
touch ~/.yuriodev-deploy-paused
docker compose -f deploy/dev/compose.yml up -d --no-deps backend-dev
docker compose -f deploy/dev/compose.yml logs --since 5m backend-dev | grep 'collector'
rm ~/.yuriodev-deploy-paused
```

Within one interval the log shows `collector.synced` with `fetched`, `added`, `updated`,
`closed` and `skipped` counts, and the tasks appear in the target space. `collector.upstream_error`
carries only the failure `kind` (`auth` means a bad or too narrow token) and `status`; a
`paused_s` value means the source rate limited the token. To switch a collector off, remove its
credential from the secrets file and recreate the backend: tasks it created stay (they are
ordinary tasks) and are no longer updated or closed.

### Calendar (secret iCal addresses)

The calendar collector reads read-only iCal feeds, no Google API and no sign-in, and keeps
the `event` table of a space in line with them. Settings, all in the secrets file because
the addresses are credentials (anyone holding one can read that calendar): `CALENDAR_ICS_PERSONAL`
and `CALENDAR_ICS_WORK_1`, each a comma-separated list of `https://` URLs, one per calendar
(Google Calendar: the calendar's settings, "Integrate calendar", "Secret address in iCal
format"); optional `CALENDAR_OWNER_EMAILS` (your address, comma-separated) so events you
declined are skipped (the feed only says who declined, so without it nothing is skipped as
declined). There is no setting for `work-2`: it stays manual. A URL that is not `https`, or
has spaces or credentials in it, is silently ignored.

Each poll, per feed: a conditional request (`ETag` / `Last-Modified` when the server offers
them; the last good copy is kept in memory, so a `304` still re-expands the window), at most
5 MiB, then recurring events are expanded for the window "today minus 7 days to today plus 60
days" in `DASHBOARDS_TIMEZONE` and written to `event` with source `calendar`. All-day events
and times without a zone are read in `DASHBOARDS_TIMEZONE`; everything is stored in UTC. Kept:
title, start, end, and `busy_only` for events the feed marks PRIVATE or CONFIDENTIAL. Skipped:
cancelled events and instances, and declined ones. An event is named by its UID (a recurring
one by its UID and the original start of the instance, so moving one instance keeps its row).
The collector owns every field of the events it created; events made by hand or over MCP are
never touched, and events outside the window are left as they are. An event that left a feed
inside the window is deleted; if any feed of a space fails, that poll still adds and updates
but deletes nothing, and a feed that fails never changes its events. The address is never
logged (a feed is named by its position in the list, `feed: 0`), never part of an error and
never in an API answer. Logs show `collector.synced` with `feeds`, `failed`, `fetched`,
`added`, `updated`, `deleted`, and `calendar.feed_failed` with the failure `kind`
(`http_5xx`, `not_found`, `bad_content_type`, `too_large`, `bad_ics` for a body that is not a
calendar, `too_many` for an absurd number of occurrences). The collector is named
`calendar-personal` / `calendar-work-1`. A collected event deleted by hand comes back at the
next poll while it is still in the feed.

## Finance (read-only bank data)

The backend can keep a read-only copy of your bank accounts, balances and transactions in its own
Postgres schema, `finance` (tables `connection`, `account`, `transaction`, created by Alembic
migration `dashboards_0007`; never mixed into the task tables). Money is always an integer in
minor units (kopiykas, cents; `-45000` is -450.00) next to an ISO 4217 code, never a float. It
ships **dark**: with no token nothing runs and nothing calls out, and the data is only served
through the dashboards gate (token header, or the trusted proxy on dev/stage). Do not switch it on
anywhere the server is not behind Cloudflare Access.

| Setting | Default | Meaning |
|---|---|---|
| `MONOBANK_TOKEN` | unset | Monobank personal API token (a read-only credential, but it shows your whole history: secrets file only). Unset means no collector and no outbound call. |
| `FINANCE_BACKFILL_MONTHS` | 12 | How far back a new account's first import reaches (0 to 36). 0 fetches only the newest month. |
| `FINANCE_POLL_INTERVAL_SECONDS` | 90 | Seconds between collector ticks (60 to 3600). Each tick makes at most one provider request. |

How the owner enters the token (a production change per the rules above: ask first; type it into
the gitignored secrets file directly, never into chat, a tracked file or a command line):

1. In the Monobank app or at https://api.monobank.ua/ sign in and issue a personal token.
2. On the box: `cd ~/yuriodev-deployment && ${EDITOR:-nano} env/dev.secrets.env`, add the line
   `MONOBANK_TOKEN=<the token>` (and optionally `FINANCE_BACKFILL_MONTHS=`), save, `chmod 600` it.
3. `touch ~/.yuriodev-deploy-paused`, then
   `docker compose -f deploy/dev/compose.yml up -d --no-deps backend-dev`, then
   `docker compose -f deploy/dev/compose.yml logs --since 5m backend-dev | grep collector`, then
   `rm ~/.yuriodev-deploy-paused`.
4. To switch off: delete the line and recreate the backend. The stored data stays; to forget it,
   empty the three tables by hand in `psql` (`DELETE FROM finance.transaction;` then
   `finance.account`, then `finance.connection`).

Within a few minutes the log shows `collector.synced` for the collector `monobank` with counts
only (`calls`, `accounts`, `windows`, `added`, `updated`). A tick with `calls: 0` (nothing due)
is logged at DEBUG. `collector.upstream_error` carries the failure `kind` and `status`; `auth`
means Monobank refused the token, and the connection's `status` becomes `needs_reconsent` (the
API shows it in `GET /finance/accounts`, `connections`; it returns to `ok` by itself after a
good call; the collector retries a refused token only every 20 minutes). A connection set to
`paused` by hand (`UPDATE finance.connection SET status = 'paused'`) makes no call at all.

What it does, against Monobank's documented limits (https://api.monobank.ua/docs/, checked
2026-11-23): the token goes in `X-Token`; `GET /personal/client-info` (accounts and balances)
and `GET /personal/statement/{account}/{from}/{to}` are each limited to once per 60 seconds; a
statement window may span at most 31 days and 1 hour (2 682 000 s). The collector keeps at least
61 seconds between any two requests (in memory, per process, and one process polls at a time by
a Postgres advisory lock of its own, so it never holds up the task collectors), uses windows of
31 days, refreshes accounts and balances every 20 minutes, then each account's newest window
(starting 3 days before the previous one ended, so a hold that settles is updated, never
duplicated), and only when nothing is due walks the history back one window per request until the
configured depth, or, for an account whose opening date the bank does not give, until three empty windows in a row. A statement answer of 500 items (the cap
observed in use; the documentation names none) is taken to have more behind it and the window
is asked again for the rest. A window is fetched whole in memory and written in one transaction
with its cursor, so a failed or partial fetch changes nothing and the window is asked again. A
429 pauses the collector for the time the source asked (at least a minute). Jars are kept as accounts
of type `jar` and kind `pot` (like Monzo's pots), with `goal_amount` from the jar's `goal` when it has
one; a jar has a statement like any other account. The stored `balance` is exactly what the bank sends (with a credit card it includes
the credit limit); `GET /finance/accounts` adds `own_balance_minor` (balance minus credit limit)
and the summary adds `own_balance` per currency, so a page never shows a limit as money. A
transaction is marked `internal_transfer` when its counterparty is another account of the same
owner and the bank says enough to tell (Monobank sends a counterparty IBAN for business accounts
only; it is compared with the owner's own IBANs in memory and never stored); the summary does not
use the flag yet. Not used in this version: the webhook and managed clients.

Keeping privacy: the logs carry only the collector name, counts and an error kind, never an
amount, description, counterparty, account number or the token. Only the last four digits of a
card (or, for an account without a card, of the IBAN) are stored. The API and MCP tools are read
only: `GET /api/dashboards/v1/finance/accounts` (balances and link status),
`/transactions?account=&from=&to=&q=&min_amount=&max_amount=&limit=&cursor=` (newest first,
cursor-paged, `from` and `to` are days in `DASHBOARDS_TIMEZONE`) and `/summary` (per currency: total
balance, spent and received this month; moves between your own accounts count on both sides),
and the MCP tools `finance_accounts`, `finance_balances` and `finance_transactions`.

Accounts and categories (what the Money page shows). Every account has a `kind` (`current`,
`credit_card`, `savings`, `pot`, `business`), a neutral `label` (a card tier, "Personal"/"Joint";
never the holder's name), `available_minor` (the balance plus the overdraft; a credit card's
balance already counts its limit), and, when the bank says so, `overdraft_limit`; a pot has its
current account (`parent_id`) and `goal_amount` when Monzo's answer has one. Two Monzo accounts of
one type differ by `label`, the last four digits of the account number and `opened_at`. Every
transaction has one of 14 categories (housing_utilities, groceries, eating_out, transport,
subscriptions, health, shopping, entertainment, debt, income, transfers, transfers_out, cash,
other), worked out from Monzo's own category or a card payment's merchant code (the raw code stays
in `category_code`); a transfer between your own accounts and pots is always `transfers` and is
never spending. Money sent to another person (a money-transfer code, MCC 4829 or 6538-6540, money
out) is `transfers_out` and is spending; the same code with money in is `income`. Monobank does
not say that a card-to-card move is between your own cards, so the two legs are paired (equal and
opposite amounts in one currency, or in two currencies when the bank states the other amount
(`original_amount`) or the converted amount is within 3% at the current rate; on two different
accounts, within 2 minutes, both money-transfer lines, each the only candidate of the other, lines
already internal counting as candidates; two lookalike sends and one receipt are paired with
nothing), and only once every open account of the provider has been read past the legs' time plus
the 2 minutes (a leg whose rival has not arrived yet decides nothing), at startup for everything stored and after every refresh for the last 7 days; both
legs become internal (`transfers`, out of spend and income). A line once internal stays so when its
window is fetched again; an owner override is never touched. `GET /finance/categories?month=YYYY-MM`
gives money out per currency and category with the month before beside it, and, for the month in
progress, the month before up to the same day and time of day as now (`previous_to_date` on every
line, currency and in the display block, `previous_to_date_day` the day it reaches, clamped to the
month's length; null for a month that is over), the like-for-like comparison. Refunds: money in on
a spending category (a card refund keeps the merchant's category) is taken off that category's
spending, never below 0, and is not income in `/finance/summary` either, so the report and the
summary agree. A line whose category is `transfers` (set by you, or by the bank) is left out of
both. A hold that the bank no longer lists in a window that was fetched whole (a released
pre-authorisation) is marked declined and stops counting as money out. An overdraft (yours or the
bank's) only counts towards `available_minor` of a current or business account, and only those can
be given one. You can change one transaction's category
(`PATCH /finance/transactions/{id}`, or the MCP tool `finance_set_category`); that is a note on our
copy only (nothing is sent to a bank) and a re-import keeps it. The same PATCH takes
`internal_transfer: true|false` (with `counterpart_id`, the other leg on another account and the
other way, both are marked): your decision sticks, no refetch or pairing changes it again
(`internal_transfer_by_owner` in every row). At every start the categories of the lines that carry
a provider code are worked out again (only where the result differs; an override is a separate
column and is never touched), so a corrected or extended rule (more merchant codes: hotels, car
rental, dealers, insurance, hosting, retail) reaches old lines. `display.categories[].converted`
is true when a currency other than the display currency is in that line. Every row has
`time_known` (false for a statement line that had only a day: it is booked at noon). `GET
/transactions` takes `account` more than once, and `provider=<id>`.

Overdraft limit you set yourself. Monzo sends no overdraft limit, so set it by hand:
`PATCH /api/dashboards/v1/finance/accounts/{id}` with `{"overdraft_limit": 100000}` (minor units,
0 or more; `null` clears it), or the MCP tool `finance_set_overdraft(account, limit_minor)`. Your
figure is kept in its own column that no collector writes, so a refresh never overwrites it, and it
wins over a limit the bank sends (you set it on purpose; the bank's own figure stays visible as
`overdraft_limit_bank`, and `overdraft_limit_source` says `owner`, `bank` or null for the one in
force). `overdraft_limit` and `available_minor` use the one in force. A pot has no overdraft.

Recurring payments, upcoming and attention (migration `dashboards_0014`). You enter your recurring
payments yourself (nothing is read from a bank, nothing is sent to one). Fields: `name`, `amount`
(what is paid each time, a positive integer in minor units) with `currency`, `kind`
(`subscription`, `debt`, `utility`, `insurance`, `housing`, `service`, `one_time`), `frequency`
(`once`, `daily`, `weekly`, `monthly`, `yearly`) with `frequency_interval` (every N; a quarter is
monthly, 3), `start_date`, `next_payment_date`, the paying `account_id` (an account we collect) or
the free-text `payment_method`, `match_text` (what its bank text contains, when that differs from
the name), `reminder_days`, `is_active`, `auto_renew`, `notes`, `category` (free text, kept as
given), `payment_type` and `payment_mode` (free text, kept as given), `icon_url`, `color`, and for
debts `is_installment`, `total_installments`, `completed_installments`, `total_owed`,
`remaining_balance`, `creditor` (also `target_amount`, `current_saved`, `recipient`). Every figure
also comes back in the display currency (`display_amount`, `display_total_owed`,
`display_remaining_balance`, `converted`, and a root `display` block as elsewhere).
REST under `/api/dashboards/v1/finance`: `GET|POST /recurring` (`?active=`, `?kind=`),
`GET|PATCH|DELETE /recurring/{id}` (PATCH: `null` clears what may be empty), `POST
/recurring/{id}/paid` (`{paid_on?, due_date?}`: you say it was paid; the next date moves one step;
send the `due_date` you saw, and a repeated request is 409 instead of paying the next one). Loading
many: `POST /recurring/bulk` `{items: [...], on_conflict: "skip"|"update", dry_run}` (at most 500,
all or nothing: any error writes nothing and the 422 answer lists every row's problems) and `POST
/recurring/import` (the body is a UTF-8 CSV file with a header row, at most 500 rows and 1 MiB,
`?on_conflict=`, `?dry_run=true`). The CSV columns are the ones of your older project: `name`,
`amount` (a decimal such as 12.99; never more decimals than the currency has), `currency`,
`frequency` (monthly, weekly, daily, yearly, quarterly, fortnightly, annually, one-time, and
`custom`: every `frequency_interval` months),
`frequency_interval`, `start_date`, `next_payment_date` (YYYY-MM-DD), `payment_type` (its word
decides `kind`: subscription, loan/debt, bill/utility, insurance, rent/mortgage/housing,
one-time, else service; the word itself is kept), `payment_mode`, `category`, `notes`, `is_active`,
`payment_method`, `reminder_days`, `icon_url`, `color`, `auto_renew`, `is_installment`,
`total_installments`, `completed_installments`, `total_owed`, `remaining_balance`, `creditor`,
`target_amount`, `current_saved`, `recipient`; also `kind`, `match_text` and `external_ref`. Other
columns are ignored and named in the answer. A row's `external_ref` (given, or `csv:<name>:<currency>:<n>`, `n` counting from 1 among the file's
rows with that name and currency, never the row's position)
makes loading the same file twice find the same rows, and an edited file keep the references of
rows that did not change: they are skipped (or replaced with `update`; replacing also resets the
next date to the file's). `probable_duplicates` in the answer counts rows created that look like a
payment already there (same name, currency, amount and cadence) under another reference, also in a
`dry_run`. A repeating payment needs a `next_payment_date` or a `start_date` (the first occurrence
from today on is worked out from the start); error rows of a CSV carry the row number of the file.
`icon_url` must be a plain `https` URL (no credentials, spaces, quotes or markup characters, at
most 500 characters), else the row is refused; it is stored as given and served as `icon_url`;
the page should show it only in an `<img>` (with `referrerpolicy="no-referrer"`), and a content
security policy that limits `img-src` has to allow that host. `color` is `#rgb` or `#rrggbb`,
stored as lower-case `#rrggbb`. MCP: `finance_recurring`, `finance_add_recurring`,
`finance_update_recurring`, `finance_upcoming`, `finance_attention`.
Moving on and matching. A payment due on D is paid when a transaction is money out, not declined,
not a move between your own accounts, in the payment's currency, on the paying account when one is
named, booked from 3 days before D to 7 days after (local days), and its counterparty or
description names the payment (the name, or `match_text`, inside the text, both reduced to
lower-case letters and digits; or, without `match_text`, the counterparty inside the name); a card
payment abroad on an account in another currency is found by its original currency and amount.
The amount counts: lines within 1% of the recorded amount are looked at first (the closest to D
wins, before or after it); a line of another amount is the payment only on or after D, once
nothing is at the right amount, and then raises `amount_changed`. One transaction pays one due
date once (kept in `finance.recurring_match`). On a match `next_payment_date` moves one period on
(a payment keeps its day of the month, `anchor_day`, set from the start or next date and again
when you change the next date: 31 January, 28 February, 31 March) and `last_paid_on`, `last_charged_amount` and `last_transaction_id` are
set; a payment that happens once ends. A payment whose paying account is not one we collect cannot
be seen, so its date moves on when it has passed (nothing is recorded as paid); one whose account
we do collect stays put until a transaction is seen, and becomes an attention item; when its
next date arrives the miss is written to its `evidence` and it moves on (not as assumed). The
outcomes kept per payment are the last three due dates: a line (counted), none (counted as a miss),
or your "paid" (not counted). This runs on
reading (list, get, upcoming, attention), is idempotent, and catches up at most 24 occurrences per
request. A date whose next date is already today or earlier (more than one period old, e.g. in a
file with stale dates) is rolled past: on a payment nobody can see it counts as assumed, on one
we collect it is looked up once its own window (3 days before to 7 after) is over and recorded as
a match or a miss. An `amount_changed` item still needs a charge from the last 60 days.
Instalment plans and what the list alone says (migration `dashboards_0017`). A matched occurrence of a
plan (`is_installment`) confirms one instalment: `completed_installments` goes up by one and
`remaining_balance` down by `amount` (never below 0); you saying `POST /recurring/{id}/paid` does
the same (your word, but no evidence). An occurrence that is only passed by the schedule (nobody
can see it, or it is more than one period old) goes to `assumed_installments` instead, capped at
the total, and no balance moves; `scheduled_installments` = confirmed + assumed (so a row can say
"by schedule 12 of 12, 3 confirmed"). Changing `completed_installments` by hand or reloading the
row from a file resets `assumed_installments` to 0. A plan never runs past its last instalment
(`start_date` plus `total_installments` periods): `next_payment_date` stays on the last date, and
`/upcoming` lists no occurrence after it nor more than the instalments left. `schedule_state` is
derived and never touches `is_active` (yours): `on_track`, `ended_by_schedule` (the last date or
the count is behind it, or a one-time payment's date has passed: a `one_time` kind never repeats
whatever its frequency says; the last date passing unseen completes the plan by schedule),
`unknown` (no start date or count, no date for a one-time payment, or a matched line after the
supposed last date: the plan goes on) or null for a payment you switched off; an ended payment is
never a `missed_payment`. `evidence` (null when no account of ours pays the payment):
`{last_matched_on, last_matched_amount, matched_of_last, checked}`, how many of its last three due
dates had a matching transaction (a date that has passed with none counts as a miss), so a page
can tell "confirmed by the bank" from "from your list, unverified".
`GET /upcoming?days=14` (1 to 366): every occurrence in `days` days counting today (`from_date` today
to `to_date` today + days - 1: 14 days is two weeks, a fortnightly payment due today appears once;
a weekly payment appears each time), with `covered` (can the paying account pay it: balance plus
overdraft in force, a card's balance already counts its limit, counting the earlier payments of the
window from the same account; no income is assumed; null when no account of ours pays or there is
no rate to put the amount in the account's currency), `shortfall` (how much of THIS payment is
missing, at most its amount) and `account_short_total` (how much the account is short in all by
then, counting the earlier ones), both in the account's currency; totals per currency and in the
display currency (each currency's total converted once; `complete` is false when a currency has no
rate). A payment already due and not seen paid on an account we collect comes first with
`overdue: true` and a negative `days_until`; it counts in the totals and against the account.
`GET /attention` (`?include_hidden=true`): `due_not_covered` (due within `reminder_days`, default
2, and not covered; never an overdue one), `missed_payment` (more than two days past its date, or
the Monday when that day is a weekend, with no matching transaction, only when we collect the
paying account AND its data goes that far: a manual bank's `last_ok_at` or the day its API was
last read, else the page says the data is old instead), `amount_changed` (the matched charge differs from the recorded
amount by more than 1%, for a charge paid in the last 60 days), `credit_high` (a credit card above 90% of its limit), `overdraft` (a
current or business account past its overdraft in force), `overdrawn` (a current or business account with a negative balance and NO overdraft limit known,
from you or the bank: only a plain fact, `info`; once a limit is set a balance below it is
`overdraft` instead), `reconsent` (a connection that needs
approving again), `stale_statement` (a manual bank whose data is older than 30 days, or that has
none: `facts.no_data`), `stale_connection` (a bank's API not read for 2 hours: the balances are
old, `medium`, `high` after 24 hours; `facts.last_error`). Each item has a
stable `key` (it names the occasion: a new due date or charge is a new item; an account's
`credit_high` (a tier: 90, 95 or 100 percent), `overdraft` and `overdrawn` last while the condition
does: what you did about them is forgotten when it clears, so it is raised again if it returns, and
`credit_high` is raised again when the card gets into a worse tier), `kind`,
`severity` (`high`: act now: due_not_covered, missed_payment, overdraft, reconsent; `medium`:
amount_changed, credit_high, stale_statement; `info`: a plain fact: overdrawn; the list is ordered by
severity, then kind, then date), `title` (for logs and tools; a page writes its own sentence), `subject_type`/`subject_id`,
`subject_name` (the payment's, the account's, the bank's name), `provider` (account and connection
items), `due_date`, `amount`/`currency`/`display_amount`/`converted`,
`facts`, `state` (`active`, `snoozed`, `dismissed`) and `snoozed_until`. Dismissed and snoozed
items are left out and counted in `hidden`. `POST /attention/dismiss` `{key}`, `/attention/snooze`
`{key, days: 1..90}`, `/attention/restore` `{key}`; an unknown key is 404; `POST /attention/bulk`
`{keys: [...up to 200], action: dismiss|snooze|restore|accept, days?}` does it for many at once and
returns `{items, missing, accepted}` (keys that are not an item now are listed, not an error;
`accept` makes the charged amount of every `amount_changed` item the payment's amount, in one
transaction: the keys are in `accepted`, those items are gone); unused states of items
that are gone are deleted after 90 days.

Banks without an API (migration `dashboards_0015`, REST under `/finance/manual`). Nothing is read
from or sent to such a bank: you enter it. `POST /manual/connections` `{provider, display_name?,
brand_bg?, brand_fg?}` (provider: a lower-case id such as `barclays`, `lloyds`, `aqua`, `revolut`,
`wise`, `starling`, `paypal`, or a neutral id of your own for a bank that must not be named in the
repository; `monobank` and `monzo` are refused: they have an API), `PATCH /manual/connections/{id}`
(name and colours). `POST /manual/accounts` `{connection_id, name, kind: current|credit_card|
savings|business, currency, balance | (credit_limit, owed), as_of?, mask_last4? (the last four
digits only), label?, type?, opened_at?, overdraft_limit?}`; a credit card is given by `credit_limit`
and `owed` (its `balance` is the limit minus what is owed, as for the other providers).
`POST /manual/accounts/{id}/balance` `{balance | owed, as_of?}` sets the balance with a date
(`as_of`: a day, meaning the end of that day in `DASHBOARDS_TIMEZONE`, or a time with an offset;
default now; never in the future). `PATCH /accounts/{id}` also takes `name`, `label`, `mask_last4`,
`archived`, `credit_limit` (a card; what is owed stays) and `kind` for an account entered by hand
(a current account becomes a `credit_card` only together with `credit_limit` above 0: the balance
becomes the limit plus the old balance, so a negative balance stays what is owed; back from a card
the limit goes and the balance is the limit taken off; no overdraft on a card); an
account from a bank's API takes only `overdraft_limit`. A connection's `last_ok_at` is the date its
newest data is as of (a balance's date, or the newest line of a statement), never the day it was
uploaded; with an open account and data older than 30 days there is a `stale_statement` attention
item.
`GET /manual/currencies` lists the currencies an account may be in (ISO 4217, `{code, exponent}`,
for a form's select; any other code is 422 with `fields: ["currency"]`); `as_of` in the future is
422 `as_of_future`.
Statements: `POST /manual/accounts/{id}/statement` with the downloaded file as the body (at most
1 MiB, because the proxy takes no more: a bigger body is 413 `file_too_large`; `?dry_run=true`, `?date_order=dmy|mdy`, `?apply_balance=true`). Formats: (1) OFX or QFX
(the open OFX specification; v1 SGML and v2 XML; `FITID` is the transaction id, `LEDGERBAL` the
balance, `CURDEF` must equal the account's currency; with several accounts in one file only the
one whose `ACCTID` ends with the account's `mask_last4` is read, else 422 `ofx_several_accounts`;
`&amp;`-style escapes are read back and a time with `[offset:TZ]` goes to the local clock); (2) a CSV with the headers `date`,
`description` and `amount` (or `debit` and `credit`), and optionally `time`, `counterparty`,
`balance`, `currency`, `id` (any order, any case; a file from any bank can be reshaped into it);
(3) PayPal's Activity Download, the one bank export whose columns the provider itself publishes
(developer.paypal.com, Activity Download report: Date, Time, TimeZone, Name, Type, Status,
Currency, Gross, Fee, Net, From Email Address, To Email Address, Transaction ID, Balance...; the
cash effect of a line is Net; Pending and Denied are marked; only for an account of provider
`paypal`). For Barclays, Lloyds, Aqua, Revolut, Wise and Starling nothing in their own help pages
or documentation describes the file (checked on 2026-11-24; third-party converters do, with
different dates and no guarantee), so no layout of theirs is built in: use OFX where the bank
offers it, or reshape the CSV into the generic one; a file in no known layout is 422
`unknown_layout` (an empty one `empty_file`, another bank's PayPal layout `other_bank`, never
guessed; bytes that are no text `not_utf8`). Adding one is a few lines in `statements.LAYOUTS` once the header
row of your own file is seen. Rules: amounts are plain decimals (`-12.50`, `1,234.56`; a comma is
never a decimal point) with no more decimals than the currency has and in the account's currency;
dates are `YYYY-MM-DD` or `DD/MM/YYYY` or `MM/DD/YYYY`, the order read from the file when a day
over 12 settles it, else given with `date_order`, else the file is refused; a line with no time is
booked at noon of its day (local zone), no earlier than 1990 and no later than tomorrow; a line
with an amount over 10^12 minor units, a cell with a line break or a bank id with a control
character is refused (control characters in a description become a space). The file is read as
UTF-8 (a BOM is fine), UTF-16 with a BOM, the OFX header's charset or Windows-1252, and the
answer's `encoding` says which; a CSV with a bad quote is one row-0 error `csv_malformed`.
All or nothing: any bad line writes nothing and the 422
body lists every line (`errors: [{row, field, message, code}]`; `code` is stable: `date_ambiguous`,
`date_mixed_order`, `date_out_of_range`, `not_a_date`, `not_a_time`, `amount_format`,
`amount_decimals`, `amount_too_large`, `wrong_currency`, `debit_credit_both`, `required`,
`cell_line_break`, `control_character`, `csv_malformed`, `too_many_lines`, `no_lines`,
`ofx_several_accounts`; the recurring import has its own). A line already there (same bank id, or
same date, amount, text and place among identical lines) is a `duplicate` and left as it is (a
bank id repeated within one file is told apart by its order, one over 60 characters is stored
as a hash; `created` is what the database took), so
the same or an overlapping file can be loaded again. The answer has `parsed`, `created`,
`duplicates`, `first_date`, `last_date`, `money_in`, `money_out` (declined lines excluded): check
them against the bank's own statement with `dry_run` first. `apply_balance` sets the account's
balance from the file's newest balance unless a newer one is already set (`balance_applied`);
`balance`, `balance_date` and `balance_would_apply` tell what it would do, on a dry run too;
a credit card's balance is set by its own endpoint. Imported lines get the category `income` or
`other` (change one with `PATCH /transactions/{id}`; it is kept when the file is loaded again), or
the file's own: a generic CSV may have a `category` column with one of the 14 names (anything else
is a line error `category_unknown`). A payee (counterparty, any case) whose category you changed
before keeps it on later statement lines.
MCP: `finance_add_manual_connection`, `finance_add_manual_account`, `finance_set_manual_balance`,
`finance_update_manual_account` (archive with `archived: true`).
Payment icons (migration `dashboards_0021`): the page's content security policy allows images from the site itself and `data:` only, so the backend fetches icons, never the browser, and the raw `icon_url` is no longer served. A payment has an optional `icon_url` (https, as before) and an optional `website` (a bare host or an https URL, normalised to a lower-case host; POST, PATCH, bulk, CSV column `website`, MCP). Without an `icon_url` the server looks for the site's own declared icon: the home page's `apple-touch-icon` (largest first), its `icon` links (SVG, PNG, then ICO), the web manifest's icons, then `/apple-touch-icon.png` and `/favicon.ico`; at most 8 requests per site, no third-party favicon service. A PNG or SVG is kept as it is and checked like a bank logo (a real PNG; an SVG that is only drawing); an ICO is not converted but its embedded PNG is taken out as it is (a bitmap-only ICO is skipped); an image over 36 KiB is refused (nothing here can scale it down without an imaging library). Every request goes through `core.http.get_public`: https and port 443 only, no credentials in the URL, the name is resolved by the backend and EVERY address must be global (loopback, private, link-local including the metadata address, CGNAT, multicast, reserved and IPv4-in-IPv6 are refused), the request is sent to that checked address with the name as Host and TLS server name (so it cannot be re-resolved to an inside address in between), no redirect is followed (the one exception is the home page's hop between the bare and the `www.` name of the same site, which goes through the same check), no cookie or token is sent, a 6 second deadline, the body is read as a capped stream, and nothing about the URL is logged. One `IconWorker` task (started with the app whenever the dashboards API is on, independent of the bank collectors) does all the fetching: one payment at a time, at most 12 seconds for all the requests of a payment, a 3 second pause between payments, 5 payments per round; a write or a refresh only marks the payment pending and wakes it, and no database connection or transaction is open while a site is asked (a claim and a result are two short transactions). A failed payment keeps its row, records `icon_error` and is not asked again for 3 hours (timeout, connection failure, 5xx, 429) or 24 hours (a refusal, no icon, not an image); `refresh` asks at once. It also converts every row that already had an `icon_url`. Each payment has `icon_url` (a same-origin path `/api/dashboards/v1/finance/recurring/{id}/icon?v=<hash>` for an `<img>`, served with `Cache-Control: private, max-age=86400` and an ETag, or null; it is NOT the address the owner typed, so a client must not send it back in a PATCH) and `icon_state`: `none` (no `icon_url` or `website`), `pending`, `ok` or `failed` (the row is kept, the page shows its colour tile); a changed `icon_url` or `website` is `pending` again and `POST /finance/recurring/{id}/icon/refresh` asks again (and gives up an icon set by hand). `icon_error` says why a failed fetch failed, as a short code: `not_public`, `timeout`, `connect_failed`, `blocked_status_403` (or 401, 429), `status_<n>`, `redirect`, `too_large` (over 256 KiB), `not_an_image`, `unsafe_svg`, `bitmap_ico`, `no_icon_found`. A candidate that fails is skipped for the next (declared sizes, `icon` links, manifest, `/apple-touch-icon.png`, `/favicon.ico`; at most 10 requests); only the start of the home page (192 KiB) is read; requests carry an ordinary `Accept` and a generic `User-Agent` and nothing more: a site that still refuses stays `failed`. `POST /finance/recurring/{id}/icon` with a PNG or SVG body (`Content-Type: image/png` or `image/svg+xml`, at most 256 KiB, the logo checks: 415, 413, 422 `invalid_icon`) sets the icon by hand: it wins over the website and the fetcher leaves it alone until `refresh`. The earlier note that images over 36 KiB are refused is now 256 KiB.
`GET /finance/providers` now returns for every built-in brand, every id with a logo and every
provider with a connection: `{id, name, colors: {background, foreground}, logo, entry: "api" |
"manual", reconnect: "oauth" | "token" | null, reconnect_path}`; `name` is null when there is neither
your name nor a built-in brand (a page writes its own), `reconnect` says how a link that needs
approving again is mended (`oauth`: open `reconnect_path`, Monzo; `token`: replace the token in the
server's settings, Monobank; null for a bank by hand). `GET /finance/accounts` rows have
`name_generated`: true when the name is one the collector made up ("Black card UAH", "Pot GBP"), so
a page can write its own from `type`, `label` and `currency` (rows stored before it was added say
false until the next refresh). The built-in brands (Aqua, Barclays, Lloyds Bank, monobank, Monzo, PayPal, Revolut,
Starling Bank, Wise) have a name and a brand colour pair in code (`finance/brands.py`), each with
a contrast of at least 3:1, the WCAG floor for large text (on a card the only text is the name and
a big bold amount; a test checks it), with the brand's own signature colour as the background and
the ink chosen for contrast (Monzo coral with white, Starling mint-teal with dark purple, Wise lime
with dark green, Revolut white with near-black, Barclays cyan with navy since white on cyan is
2.5:1); a bank not in the list takes the display
name and colours (`brand_bg`/`brand_fg`, the same 3:1 rule) of its connection, else its id
and a neutral pair. Logos stay in `DASHBOARDS_PROVIDER_LOGOS`.

Display currency and rates. Stored amounts are never converted: they stay integers in minor units
of their own currency. `FINANCE_DISPLAY_CURRENCY` (default `GBP`, three capital letters) is the
currency the Money page also shows every amount in, beside the original and never instead of it:
accounts (`display_balance_minor`, `display_own_balance_minor`, `display_available_minor`),
transactions (`display_amount_minor`), `/finance/summary` (per-currency `display_*` and one grand
total in `display`), `/finance/categories` (the same, and the lines of all currencies added per
category in `display`). Everything converted has `converted: true` (show it as an approximation);
each answer's `display` block lists the rate used per currency (`rate` = display units per one
unit, an exact decimal, with its `as_of` and `source`) and `missing`, the currencies with no
usable rate, whose display fields are null: nothing is ever guessed. Conversion is at the CURRENT
rate, not the one of each payment's day. The source is Monobank's public rates
(`GET https://api.monobank.ua/bank/currency`, no token, cached by the bank for up to 5 minutes;
asked every 30 minutes, only while a bank collector runs, so with no bank credential nothing is
fetched). Each currency is hryvnia per unit: the pair's `rateCross` when it has one (GBP and PLN
only have that), else the mid of buy and sell (USD and EUR), never one side of the spread; any
pair is the quotient of two, a cross through hryvnia. A rate older than 3 days is treated as
missing. Rounding: one rounding per converted figure, half-even on the minor unit of the display
currency (a tie goes to the even neighbour), with the minor-unit difference of currencies like
JPY (none) or KWD (three) applied first; a total is the sum of the converted parts it is made of
(each currency's, each category's), so what a page shows adds up.

The Today view of a page (`src/dashboards/today.py`): `GET /api/dashboards/v1/today?scope=personal|work-1|work-2|money` (the MCP tool `today` with `scope_name`; without it the tool is unchanged) answers one JSON object with everything the page's Today view shows, as data and codes, never finished sentences (the page words them): `scope`, `date`, `generated_at`, `summary {code, facts}`, `queue` (at most three items `{key, kind, subject {type, id, name}, facts, primary, secondary, link {kind, id, url}}`, most urgent first) with `queue_total` (how many qualify), `soon` (two or three `{key, kind, subject, facts}`), `stats` (two `{code, value, compare {code, value}|null, facts}`), `breakdown {code, rows [{key, value, label {ru, en}|null, facts}] (at most four), insight {code, facts}|null}`, `today` (up to three rows: events for a space, bank connections for money, each with `kind`, `starts_at`, `ends_at`, `subject`, `facts`) and `assistant {enabled}`. Rules: personal queue = overdue (oldest first), due today, priority, due within three days; work-1 = review requests waiting longest (not drafts), then urgent or high Linear issues in progress with no movement for three days, then priority tasks; work-2 = its priority tasks and tasks due today and nothing else (that scope is manual only); money = the attention items in their order (actions: `accept_amount`, `open_payment`, `mark_paid`, `open_bank`, `set_overdraft_limit`, `reconnect`, `update_balance`, `snooze`, `open_external`, `mark_done`, `open_task`). Soon: dated tasks not already in the queue; other review requests; money: the next payments (not overdue ones). Stats: spaces `open_tasks` (facts priority, without_date, overdue) and `closed_this_week` against `closed_last_week` (calendar weeks from Monday, last week whole); work-1 `review_waiting` (facts oldest_hours) and `issues_in_progress` (by_priority); money `spent_month_to_date` against `previous_to_date` and `due_in_14_days` (facts confirmed_by_bank: the part on payments of an account we read whose pattern a statement line has matched before). Breakdown: personal open tasks by life area (insight `stale_area`: an area with three or more dateless tasks older than 30 days); work-1 my issues by stage (insight `stalled_pull_requests`: my own open pull requests untouched for a day); work-2 meeting minutes per working day of the week (insight `freest_day`: the day still ahead with the fewest); money top categories in the display currency (insight `category_rise`: the largest rise against the same days last month). `streak {days: [seven {date, state}] (Monday to Sunday), count}`: `queue_day` (migration `dashboards_0024`) keeps, per page and local day, what the queue looked like each time it was computed (`/today`) and when a task was completed or an attention item decided; a day is `cleared` when the queue was empty after having been non-empty or at every look, `open` when it was not empty at the last look and never emptied, `future`, or `no_data` when nobody looked (nothing is ever filled in afterwards); `count` is the run of `cleared` days ending today (or yesterday when today is still open). `DASHBOARDS_OWNER_NAME` (secrets file, a first name for the greeting; one printable line of at most 60 characters) comes back as `owner_name` in `GET /bootstrap` and in every page's `summary.facts.owner_name` (null when unset). Summary facts of money include `total`, `large_payment` (the first payment of 100 or more in the display currency within 14 days) and `days_to_large_payment`.

Images in one answer each (a CDN in front of the site refuses bursts of requests from one visitor, so a page must not fetch dozens of images): `GET /finance/providers/logos` returns `{version, logos: {<provider id>: {on_light, on_dark, mark}}}`, every configured and validated logo variant of the providers that have a connection as a data URI (an unset variant is null), and `GET /finance/recurring/icons` returns `{version, icons: {<payment id>: <data URI>}}` for every payment that has an icon (an icon over 64 KiB, and anything beyond 2 MiB in all, is left out and stays reachable at its own address). Both have `ETag` = the version, `Cache-Control: private, max-age=86400` and answer 304 to a matching `If-None-Match`. `/finance/providers` has `logos_version`, and `/finance/recurring` and `/finance/upcoming` have `icons_version`: the page fetches a bundle when that version differs from its copy. The per-image addresses are unchanged.

Bank logos. `DASHBOARDS_PROVIDER_LOGOS` (secrets file, a JSON object) holds the logos, so none is
in the repository: `{"<provider id>": {"on_light": "<data URI>", "on_dark": "<data URI>", "mark": "<data URI>"}}`.
`on_light` is the version for a light card (dark ink), `on_dark` for a dark brand colour (white
ink), `mark` a square brand icon for small places such as a transaction row; any may be left out
(the same validation for all three). A provider id is lower-case letters, digits and hyphens (1 to 32
characters): `monobank`, `monzo` and whatever id a manual bank is given, including one that must
not be named here. A value is a base64 data URI of a PNG (a real header with a size) or an SVG,
at most 48 KiB. An SVG must be XML in the SVG namespace with no document type (so no entity), may
only use shapes, paths, text, gradients, clips, masks, patterns, `use`, `style` and simple filter
elements and the usual drawing attributes (`logos.SVG_ELEMENTS`, `SVG_ATTRIBUTES`), and may point
only inside itself (`href="#id"`, `url(#id)`): no script, handler, image, link, animation,
foreignObject or external reference, so it is safe as the source of an `<img>` and when opened by
itself. A `mark` must be square (within 5%) when it says its size. A provider may also have
`"scale"` (0.5 to 2, an optical correction the page applies to that logo) and `"mono": true` (one
flat colour: the page may recolour it); to make a dark-card version, give `on_dark` an all-white
file (a dark-ink wordmark is invisible on a dark card; the server cannot tell). Whatever is invalid
is dropped one by one, never an error. `GET /finance/providers` returns for every provider
`logo: {on_light, on_dark, mark, aspect: {on_light, on_dark, mark}, scale, mono}`; each variant is
the address of the image (`GET /finance/providers/{id}/logo/{variant}`, with `Cache-Control:
private, max-age=86400` and an `ETag`, so the one answer of the API the gate does not make
`no-store`; `?v=` changes with the picture) or null, and only for a provider that has a connection.
`logo_dropped` per provider names every variant given in the settings that was NOT served and why (`{"on_dark": "element not allowed: <image>"}`), so a silently missing logo can be checked without reading the settings. The SVG allow-list: elements `svg g defs path rect circle ellipse line polyline polygon text tspan title desc symbol use linearGradient radialGradient stop clipPath mask pattern style marker filter feGaussianBlur feOffset feBlend feColorMatrix feFlood feComposite feMerge feMergeNode`, all in the SVG namespace (`xmlns="http://www.w3.org/2000/svg"` is required; `xmlns:xlink` is fine); attributes `id class style fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity d x y x1 x2 y1 y2 cx cy r rx ry width height viewBox preserveAspectRatio points transform version gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity clip-path clip-rule mask maskUnits maskContentUnits clipPathUnits patternUnits patternTransform patternContentUnits href xlink:href font-family font-size font-weight font-style text-anchor letter-spacing dominant-baseline dy dx rotate textLength fx fy filter filterUnits in in2 result stdDeviation values type mode operator k1-k4 flood-color flood-opacity color-interpolation-filters display visibility vector-effect role aria-* focusable shape-rendering color mix-blend-mode isolation marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits data-name enable-background xml:space`; `href`/`xlink:href` only `#id`; `url()` only `url(#id)`; no `data:`. A `<style>` block with class selectors, `class`, `<defs>`, `<clipPath>` with `clip-path="url(#id)"`, `<g>`, `fill-rule`, `clip-rule` and `<title>` all pass; what editors add and is dropped: `<metadata>`, `sodipodi:*` and `inkscape:*` elements and attributes, `<image>`, `<a>`, `<switch>`, `<foreignObject>`, animation, `<script>`, a missing `xmlns`. `aspect` is width over height, null when unknown, so a page can reserve room. The server does not
trim a wordmark to its ink box (it cannot measure one without an imaging library): trim the files.
The accounts answer does not repeat the logos, but each connection has `name` and `colors` in effect,
each account of a credit card a `used_percent` (floored, the rule of the attention item) and the
answer a `providers` list: per provider the open accounts' own balance and pots in the display
currency, each converted once (`complete` is false when an account had no rate). `GET
/finance/recurring` has `debts: {count, display_remaining_balance, complete}`, what is left on the
active payments that have a remaining balance.

Logos too big for one environment variable. The kernel refuses a single environment string of
128 KiB or more (the container would not start), which a dozen images pass. Two ways out, both
merged with `DASHBOARDS_PROVIDER_LOGOS` (later over earlier, per provider and per variant, in this
order: the variable, `DASHBOARDS_PROVIDER_LOGOS_2`, `DASHBOARDS_PROVIDER_LOGOS_3`, the file):
(1) no compose change: split the JSON object over the variables in `env/<env>.secrets.env` (each
under 128 KiB; the total environment may be about 2 MiB); (2) a file: `DASHBOARDS_PROVIDER_LOGOS_FILE`
names a JSON file of the same shape (at most 4 MiB, UTF-8, read again when it changes). The files
live in the untracked directory `env/dashboards/` on the box (`env/dashboards/logos.json`,
`env/dashboards/space-icons.json`; the directory is in `.gitignore`), and the backend service needs
that directory mounted read-only, which is a compose change that has to be agreed:
`volumes: ["../../env/dashboards:/run/dashboards:ro"]` on the dev backend service (stage and prod
alike when they get logos), then `DASHBOARDS_PROVIDER_LOGOS_FILE=/run/dashboards/logos.json` (and
`DASHBOARDS_SPACE_ICONS_FILE=/run/dashboards/space-icons.json`, the same idea for the space icons)
in `env/<env>.secrets.env`, then the manual recreate of the backend (`deploy/README.md`, "Environment
config"). Mount the directory, never a single file (a missing file would be created as a
directory), and never `env/` itself (it holds the other secrets files). A missing, unreadable or
oversized file is no logos, not an error; the variable still applies.

Other banks later (a bank's own API with short-lived tokens, an Open Banking aggregator with
expiring consents): add a provider that returns the neutral account and transaction shapes
(`backend/src/dashboards/finance/base.py`); its auth or consent state lives in tables of its own
and never in the shared ones, and `finance.connection.status` (`ok`, `needs_reconsent`,
`paused`) is where the page can show "this link needs you".

### Monzo (OAuth, your own account)

A second provider, through Monzo's developer API (https://docs.monzo.com/), for your own accounts
only. It needs an OAuth client of yours and a one-time consent in a browser; nothing runs without
both. Accounts (current, joint if you have one) and each pot (an account of type `pot`, with its
own balance and no statement) are kept like Monobank's; transactions carry the merchant name as
counterparty, the category, the amount and, when it differs, the amount in the currency it was
spent in, `pending` (not settled yet), `declined` (refused: stored and flagged, never counted in
spent and received) and `settled_at`. Moves to and from a pot are flagged `internal_transfer`.
Kept out on purpose: addresses, coordinates, notes, counterparty account numbers, and the holder's
name (accounts are named "Current account GBP"). `GET /finance/accounts` shows `history_from` (the
oldest transaction held) so the page can say "history from <date>".

| Setting | Where | Meaning |
|---|---|---|
| `MONZO_CLIENT_ID`, `MONZO_CLIENT_SECRET` | secrets file | The OAuth client from the developer portal. Unset: no Monzo. |
| `DASHBOARDS_PUBLIC_BASE_URL` | `env/<env>.env` (tracked, not secret; `https://dev.yuriodev.co.uk` on dev) | An https origin (http only for localhost), no path. The redirect address is this plus `/api/dashboards/v1/finance/monzo/callback`. A malformed value only leaves Monzo off. |

Your steps (the secrets are typed by you into the secrets file, never into chat or a command):

1. At https://developers.monzo.com sign in, "Clients", "New OAuth Client": name it, set the
   redirect URL to `<DASHBOARDS_PUBLIC_BASE_URL>/api/dashboards/v1/finance/monzo/callback`
   (on dev: `https://dev.yuriodev.co.uk/api/dashboards/v1/finance/monzo/callback`) and choose
   **Confidential** (a non-confidential client gets no refresh token and must consent again every
   six hours).
2. On the box add `MONZO_CLIENT_ID=` and `MONZO_CLIENT_SECRET=` to `env/dev.secrets.env`, then
   recreate the backend (the same pause/recreate steps as for the Monobank token above).
3. In a browser that is signed in to dev (basic auth), open
   `https://dev.yuriodev.co.uk/api/dashboards/v1/finance/monzo/connect`. It sends you to Monzo:
   log in with your email.
4. **Approve in the Monzo app within 15 minutes** (a push notification asks for your PIN,
   fingerprint or face). The browser then lands on `/dashboards/personal/money?monzo=connected` (or `denied`,
   `invalid_state`, `failed`).

Strong customer authentication decides what can be read: right after you approve, the whole
history; after five minutes only the last 90 days. So the collector asks the API every few
seconds until your approval lands (for up to 15 minutes; it then gives up and the connection
becomes `needs_reconsent`), and from that moment fetches every account's history as fast as it
can, newest to oldest, one 90-day window at a time, one request a second (the documentation names
no limit; a 429 pauses the collector). A window is written whole or not at all, so an interrupted
walk simply continues. Once the five minutes are over it never asks for anything older than 90
days and keeps the last 90 days fresh with a 3-day overlap, as for Monobank. If the five minutes
were missed (the server was down) or the walk stopped short, open the connect address again: a
new consent continues every unfinished account from where it stopped (to its opening date) inside
a new full-history window. An account with a known opening date is walked back to it even through
months without a single transaction. `collector.synced` for `monzo` logs counts only.

Tokens. The access token (about six hours) and the refresh token live in
`finance.monzo_token`, a table of this provider (never a shared one), stored as Monzo issued
them: **not encrypted at rest**. They are protected by where they are: the database is reachable
only on the compose network by the backend's own role, no API or MCP tool ever returns them,
nothing logs them, and a state, a code or a token is never put in a URL we generate (the state in
the redirect to Monzo is a random single-use value, kept only as a hash, valid ten minutes). A
database dump contains them: keep dumps mode 600 (see "Backup and restore") and treat one as a
credential. Encrypting them with a key from the environment would need a cryptography library
that the backend does not ship; ask before adding one. Each refresh is one-time and invalidates
the previous pair, so it runs under a row lock (`SELECT ... FOR UPDATE`): two processes cannot
both spend it. If Monzo refuses a refresh (or a non-confidential token expires) the token is
revoked, the connection becomes `needs_reconsent` and nothing more is sent until you open the
connect address again. A refresh whose answer is lost (a timeout after Monzo accepted it) looks
the same and needs a new consent.

Not in the documentation, used when present: `local_amount`/`local_currency`, `account_balance`,
and the markers of a pot transfer (`metadata.pot_id`, a `uk_retail_pot` scheme, or a description
that is the pot's id). Check them against your real data before relying on the flags.

## Local development

Mac only — **never run this on the VPS.** `compose.local.yml` (project
`yuriodev-local`, its own Docker network, nothing shared with `yuriodev-network`)
builds each Dockerfile's `dev` target (Vite dev server with HMR on
`127.0.0.1:5173`; `uvicorn --reload` on `127.0.0.1:8000`) with the source bind
-mounted in, and loads `env/local.env`. The frontend's Vite dev-server proxy
for `/api` is pointed at the local backend container via
`VITE_API_PROXY_TARGET=http://backend:8000` (compose `environment:`, not
baked into any build). The root `Makefile` wraps it: `make dev-up` /
`dev-down` / `dev-logs` / `dev-ps` / `dev-test` (runs `npm run test` and
`pytest` inside the running containers) / `typecheck` (`tsc` + `mypy`) /
`lint` (`eslint` + `ruff check` + `ruff format --check`) / `check`
(typecheck + lint + tests + `scripts/check-compose.py`, the same checks
`ci.yml`'s `frontend`/`backend`/`guards` jobs run — it doesn't cover
`npm run build`, `npm audit` or the backend coverage gate, which stay CI-only).

## Monitoring

`.github/workflows/uptime.yml` runs on an hourly cron and, entirely from
outside (through Cloudflare, not from this box), checks that production's
`/` returns 200, `/api/health` reports `status: healthy` and
`environment: prod`, and that its `revision` matches the commit behind the
latest GitHub Release once that release is at least 20 minutes old (a fresh
promotion gets that long to actually land). Any failure opens or updates one
GitHub issue labelled `monitor` (which emails the repo owner) with the exact
problem list, and the issue auto-closes with a comment once checks pass
again — `gh issue list --label monitor --state open` shows whether one is
currently open. An `/api/health` answer that is not a JSON object (a
Cloudflare or nginx HTML error page, an empty body, a timeout) is itself a
failure, reported with its HTTP code and the first bytes of the body; if the
probe step ever crashes, the issue is still opened. `workflow_dispatch` with
`simulate_failure: true` exercises the whole alert path without a real
incident, and `simulate_html_health: true` the non-JSON path. GitHub disables the schedule
after 60 days with no commit to `master`, so a long-quiet repo needs a
reminder to push something.

## Rollback

`.github/workflows/rollback-production.yml` is a `workflow_dispatch`
workflow, run from the Actions tab (Actions -> Rollback production -> Run
workflow) or with `gh workflow run rollback-production.yml -f tag=vX.Y.Z`.
Its `tag` input is an earlier **release tag** (one that already has a GitHub
Release from a successful production promotion). Like `promote-production.yml`
it runs under the `production` GitHub environment, so it also needs reviewer
approval before it retags `:production` back to that release's recorded
digests. The deploy agent then recreates whatever changed on its next run,
same as any other promotion — no separate rollback procedure on the box.
Check that release's notes (or the workflow's own summary) for the exact
digests it moved to. The deploy agent's own automatic rollback (see
"Automatic rollback and quarantine" above) only covers an image that fails
its health check; moving `:production` back with this workflow also lifts
any quarantine the agent is holding for prod.

## Break-glass: building directly on the box

Only for when GitHub Actions itself is unavailable and production needs a
fix immediately. Since the agent re-pulls `:production` every minute, a
locally built image gets reverted within a minute unless you pause the
agent first:
```bash
touch ~/.yuriodev-deploy-paused                     # 1. stop the agent from reverting you
docker compose build <svc>                          # 2. build from the current working tree
docker compose up -d --no-deps <svc>                 #    (one service, per the golden rules — ask Yurii first)
.claude/scripts/smoke-test.sh                        # 3. verify
```
This leaves production running an image that doesn't match any registry tag.
Resume the normal pipeline afterward with a real release (tag `vX.Y.Z` from
the fixed commit on `master` through the usual promotion flow) — don't leave
the pause file in place, and don't leave production permanently diverged
from what `:production` points at.

## Applying the proxy hardening

A one-off, reload-only change to the live proxy config (no container recreate,
no image change). What it does:

- `nginx-proxy/10-catchall.conf` (new): `default_server` on both ports. `:443`
  refuses the TLS handshake for a missing or unknown SNI (bare IP, `api.`, random
  names) and closes a known-SNI request whose Host is foreign (444). `:80` keeps
  `/healthz` (the proxy HEALTHCHECK) and closes everything else (444).
  `api.yuriodev.co.uk` is gone from every `server_name`.
- `nginx-proxy/00-http.conf` (new): `server_tokens off`, the minimised JSON
  access-log format `edge_json` (IPs cut to /24 or /48, no query strings, no
  `X-Forwarded-For`), and rate-limit zones that nothing uses yet. Real client IP
  (`CF-Connecting-IP`) and `limit_req` come later, once the origin's AAAA record
  is gone.
- `nginx-proxy/snippets/` (not loaded by the `conf.d/*.conf` glob):
  `security-headers.conf` (HSTS `max-age=86400`, nosniff, `X-Frame-Options: DENY`,
  Referrer-Policy, Permissions-Policy, COOP, CORP, and a
  `Content-Security-Policy-Report-Only` that allows exactly what the current
  bundle loads, including Google Fonts), `server-common.conf` (access log, 1 MB
  body limit, the headers) and `proxy-common.conf` (the `proxy_set_header`
  lines, now in one place; `X-Forwarded-For` is replaced, not appended; 5 s
  connect / 30 s read timeouts).
- `default.conf`: `www.yuriodev.co.uk` gets its own server that answers
  `301 https://yuriodev.co.uk$request_uri`; `:80` redirects only our four
  hostnames. dev/stage keep basic auth, `X-Robots-Tag` and `no-store`, and hide
  any `Cache-Control` the app image sends so exactly one is served.

The CSP is report-only and there is no report endpoint yet: violations show
only in the browser's DevTools console. Cloudflare's own HSTS setting stays
off (one header, one place).

How it ships. Two paths, as for every change on this box:

- **Path B, live-bound files** (`nginx-proxy/`, `docker-compose.yml`,
  `deploy/{dev,stage}/compose.yml`, `env/*.env`, `deploy/agent/`): applied and
  committed in the live tree with explicit paths, then pushed straight to
  `master`.
- **Path A, everything else** (app code, CI, scripts, docs): a branch and a PR.

This change has one of each. The `nginx-proxy/` part goes through path B
below. The branch's doc edits (this section, `CLAUDE.md`, `.claude/`) arrive
afterwards through the branch's PR (step 7), where any conflict with other
doc edits is resolved like any other PR. Do not merge that PR before step 6:
the catch-up pull would then put the new proxy files on the live disk, where
the next reload or restart would pick them up.

From the live tree, every step on Yurii's OK. Nothing changes on the running
proxy until the reload in step 5, but the files are on disk from step 2, so
`nginx -t` runs straight away:

```bash
cd ~/yuriodev-deployment && git status --short          # must be clean
# 0. Baseline (see "Verify" below): save the header check and smoke test output.
#    Then catch the live tree up with origin/master. A pull is a production
#    change, so pause the agent first:
touch ~/.yuriodev-deploy-paused
git fetch origin && git log --oneline HEAD..origin/master
git diff --stat HEAD...origin/master -- nginx-proxy docker-compose.yml deploy/dev deploy/stage deploy/agent 'env/*.env'
#    ^ must print nothing: path A never touches live-bound files. If it lists any, stop:
#      that change needs its own runbook before this one.
git pull --ff-only
rm ~/.yuriodev-deploy-paused
# 1. Fetch the reviewed branch (pushed for review; fetched as a ref, never checked out)
#    and preview what gets applied: the branch's nginx-proxy/ changes and nothing else.
git fetch origin ops/proxy-hardening && REF=$(git rev-parse FETCH_HEAD)
git diff --stat HEAD..."$REF" -- nginx-proxy/            # 00-http.conf, 10-catchall.conf, default/dev/stage.conf, snippets/*.conf
git diff HEAD..."$REF" -- nginx-proxy/ | git apply --check && echo "applies cleanly"
#    If --check fails, nothing has changed: master gained other nginx-proxy/ edits
#    since the branch was cut. Rebase the branch in a clone (never here), review
#    again, start over.
# 2. Apply to the working tree and index. git apply is all or nothing: no conflict
#    markers, no half-applied state.
git diff HEAD..."$REF" -- nginx-proxy/ | git apply --index
git status --short    # only nginx-proxy/ paths: M default.conf dev.conf stage.conf, A 00-http.conf 10-catchall.conf snippets/*.conf
# 3. Validate at once (a proxy restart with a bad config is a full outage)
docker exec yuriodev-proxy nginx -t
#    On failure, undo before anything reloads (the exact reverse of step 2):
#    git diff HEAD..."$REF" -- nginx-proxy/ | git apply -R --index && git status --short   # prints nothing
# 4. Commit exactly these paths (add -c user.name=... -c user.email=... if the box has no git identity)
git diff --cached --stat                                  # nginx-proxy/ only
git commit -m "feat(proxy): refuse unknown hosts, add security headers, redirect www"
# 5. Reload (only with Yurii's OK; a failed reload keeps the old config)
docker exec yuriodev-proxy nginx -s reload
# 6. Verify (below), then push. HEAD is origin/master (as of step 0) plus the step-4 commit:
git fetch origin && git log --oneline HEAD..origin/master  # expect nothing
#    If it prints commits (a PR merged meanwhile): ask, pause the agent, re-run step 0's
#    `git diff --stat` check, then `git rebase origin/master`. The one local commit
#    touches only nginx-proxy/, which path A never does, so it replays cleanly; if it
#    stops anyway, `git rebase --abort` restores the state before the rebase.
#    Unpause afterwards.
git push origin master
# 7. Merge the branch's PR (merge commit or squash). master already holds the same
#    nginx-proxy/ content, so the PR adds only the docs. Then catch the live tree up
#    as in step 0 (pause, the `git diff --stat` check, `git pull --ff-only`, unpause).
```

Verify, origin (from the box):

```bash
H='^(strict-transport-security|content-security-policy-report-only|x-content-type-options|x-frame-options|referrer-policy|permissions-policy|cross-origin-opener-policy|cross-origin-resource-policy|server):'
for h in yuriodev.co.uk dev.yuriodev.co.uk stage.yuriodev.co.uk; do echo "== $h"; curl -skI --max-time 10 --resolve "$h:443:127.0.0.1" "https://$h/" | grep -iE "$H"; done   # 8 headers each + "server: nginx" (no version); dev/stage answer 401 and still carry them
curl -skI --max-time 10 --resolve yuriodev.co.uk:443:127.0.0.1 https://yuriodev.co.uk/api/health | grep -iE "$H"                                               # same set on the API
curl -sk  --max-time 10 -o /dev/null -w '%{http_code}\n' --resolve yuriodev.co.uk:443:127.0.0.1 https://yuriodev.co.uk/                                         # 200
curl -sk  --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}\n' --resolve www.yuriodev.co.uk:443:127.0.0.1 'https://www.yuriodev.co.uk/x?y=1'         # 301 https://yuriodev.co.uk/x?y=1
curl -sk  --max-time 10 -o /dev/null -w '%{http_code}\n' https://127.0.0.1/                                                                                   # 000 (no SNI: handshake refused)
curl -sk  --max-time 10 -o /dev/null -w '%{http_code}\n' --resolve api.yuriodev.co.uk:443:127.0.0.1 https://api.yuriodev.co.uk/                              # 000 (unknown SNI)
curl -sk  --max-time 10 -o /dev/null -w '%{http_code}\n' --resolve yuriodev.co.uk:443:127.0.0.1 -H 'Host: example.com' https://yuriodev.co.uk/                # 000 (444)
curl -s   --max-time 10 -o /dev/null -w '%{http_code}\n' -H 'Host: example.com' http://127.0.0.1/                                                             # 000 (444)
curl -s   --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}\n' --resolve yuriodev.co.uk:80:127.0.0.1 http://yuriodev.co.uk/                          # 301 https://yuriodev.co.uk/
for e in dev stage; do curl -skI --max-time 10 --resolve "$e.yuriodev.co.uk:443:127.0.0.1" "https://$e.yuriodev.co.uk/" | grep -iE '^(HTTP|x-robots-tag|cache-control)'; done   # 401, noindex, one no-store
docker exec yuriodev-proxy wget -qO- http://127.0.0.1/healthz                                                                                                 # ok
docker ps --filter name=yuriodev-proxy --format '{{.Status}}'                                                                                                  # (healthy)
docker compose logs --since 5m --tail 5 proxy                                                                                                                  # JSON access lines ("ip" is Cloudflare's /24 for now)
docker compose logs --since 5m proxy 2>&1 | grep -cE '"status":5[0-9]{2}'                                                                                      # 0: proxy 5xx, as /check-logs now greps the JSON lines
.claude/scripts/smoke-test.sh                                                                                                                                  # RESULT: healthy
```

Verify, edge (through Cloudflare; a fresh shell, so `H` is set again):

```bash
H='^(strict-transport-security|content-security-policy-report-only|x-content-type-options|x-frame-options|referrer-policy|permissions-policy|cross-origin-opener-policy|cross-origin-resource-policy|server):'
curl -sI --max-time 10 --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/ | grep -iE "$H"                                               # all 8 headers (Cloudflare replaces "server")
curl -sI --max-time 10 --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/ | grep -ci '^strict-transport-security:'                      # 1 (Cloudflare adds no second HSTS)
curl -s  --max-time 10 --doh-url https://1.1.1.1/dns-query https://yuriodev.co.uk/api/health | python3 -m json.tool                              # healthy, environment prod
curl -s  --max-time 10 --doh-url https://1.1.1.1/dns-query -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.yuriodev.co.uk/x?y=1'   # 301 https://yuriodev.co.uk/x?y=1
for e in dev stage; do curl -s --max-time 10 --doh-url https://1.1.1.1/dns-query -o /dev/null -w "$e %{http_code}\n" "https://$e.yuriodev.co.uk/"; done   # 401 401
```

Verify, origin addresses from outside (Yurii's laptop, not the box; the IPv6 line
needs a v6-capable network):

```bash
curl -sk    --max-time 10 -o /dev/null -w '%{http_code}\n' "https://<origin-ipv4>/"     # 000 (no SNI: handshake refused)
curl -sk -g --max-time 10 -o /dev/null -w '%{http_code}\n' "https://[<origin-ipv6>]/"   # 000
```

Then, in a browser (both themes; `/`, an unknown path, the command palette and
the terminal): DevTools shows zero `[Report Only]` CSP messages and no MIME or
nosniff errors. `https://api.yuriodev.co.uk/` through Cloudflare now fails with
525 (the origin refuses that SNI) until its DNS record is deleted in Cloudflare.

Rollback: `git revert --no-edit <sha of the step-4 commit>` (restores the three
vhosts and removes the new files; it touches only `nginx-proxy/`),
`docker exec yuriodev-proxy nginx -t`, `docker exec yuriodev-proxy nginx -s
reload`, push. Browsers keep the 1-day HSTS policy they already saw, which is
harmless for an HTTPS-only site.

## Making the repository and the images private

The repository and its two GHCR packages are public today, and the box pulls
anonymously. Going private is three owner-only steps, in this order, so the
deploy agent never loses its pulls:

1. **Give the box a read-only registry login** (before the packages go
   private). On GitHub: Settings -> Developer settings -> Personal access
   tokens (classic) -> a token with only `read:packages`. On the box, as the
   user whose crontab runs the deploy agent:
   ```
   docker login ghcr.io -u YuriiOks     # paste the token at the prompt
   ```
   Docker stores it in `~/.docker/config.json` (mode 600); `docker compose
   pull` in `deploy/agent/yuriodev-deploy.sh` then uses it with no code
   change. Check with `docker compose -f deploy/dev/compose.yml pull -q`.
2. **Make both packages private**: on each of `yuriodev-frontend` and
   `yuriodev-backend`, Package settings -> Change visibility -> Private, and
   under "Manage Actions access" keep this repository with Write, so the
   workflows can still push and retag.
3. **Make the repository private**: Settings -> General -> Danger Zone ->
   Change visibility.

After the switch:
- Actions minutes are no longer free. The monitor runs hourly for that reason
  (`uptime.yml`); CI with the e2e job is the other large consumer, so watch
  Settings -> Billing -> Actions in the first month.
- `docker buildx imagetools inspect` and other registry reads from another
  machine need the same kind of login.
- Update the wording that still says the pulls are anonymous or the repo is
  public: the "anonymous" notes in this file and in
  `deploy/agent/yuriodev-deploy.sh`, `.claude/commands/deploy-check.md` and
  `.claude/commands/deploy.md`, and golden rule 8 in `CLAUDE.md`.
- Rollback is unchanged: the token is read-only, so retags still run through
  GitHub Actions.

## Where credentials live (paths only — never print these)

- Dev/stage basic auth: htpasswd file at `nginx-proxy/auth/envs.htpasswd`
  (gitignored); plaintext credentials at `~/.config/yuriodev/basic-auth.txt`
  (mode 600).
- Backend runtime secrets, current: `env/<env>.secrets.env` (gitignored,
  mode 600, one file per environment, created on the machine that runs it —
  none exist on this box yet); variable names only in
  `env/secrets.env.example`. See "Environment config" above.
- Origin TLS: `nginx-proxy/certs/origin.{pem,key}` (gitignored).
- GHCR: no credentials on the box at all — every pull is anonymous against
  public packages; every push/retag happens inside GitHub Actions using the
  repo's built-in `GITHUB_TOKEN`.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| 502/504 on a vhost (prod/dev/stage) | The upstream container for that env is down or unhealthy | `docker compose ps` (prod) or `docker compose -f deploy/<env>/compose.yml ps`; `docker compose logs --tail 200 <svc>` |
| 401 on dev/stage | Basic auth working as intended, or wrong/missing credentials | Expected without credentials; with credentials, compare against `~/.config/yuriodev/basic-auth.txt` and `nginx-proxy/auth/envs.htpasswd` |
| dev not running a branch after its push | only a branch named `dev/*` moves dev by itself (any other branch is built and scanned, and put on dev with `gh workflow run images.yml -f branch=<name>`), CI or the build failed (or CI was cancelled by a newer push to that branch), the pusher isn't the repository owner (CI only, no build), another `dev/*` branch's build finished after it (the last build to finish wins), a `master` build ended the preview, the branch moved on before the retag, or the agent is paused/not running | CI: `gh run list --workflow=ci.yml --branch <name>` (push-triggered, so `--branch` works); Images: `gh run list --workflow=images.yml --limit 10` and read the titles (`Images: <name> @ <sha>`; never `--branch`/`--commit`, those runs are filed under master's tip); whether `dev-<sha>`/`sha-<sha>` exists (`docker buildx imagetools inspect`); dev's `/api/health` `ref`/`revision`; `ls ~/.yuriodev-deploy-paused`; heartbeat freshness; `tail ~/.local/state/yuriodev-deploy.log`. `gh workflow run images.yml -f branch=<name>` puts an already-built branch back |
| stage not following a `master` push | CI or the build failed for that commit (no `sha-<commit>` for both services yet), or the agent is paused/not running (an rc tag pins stage only until the next `master` build) | `gh run list --workflow=ci.yml --branch master`; Images by title as above; `docker buildx imagetools inspect` of `sha-<commit>` vs `:stage`; stage's `/api/health` `revision`; the agent checks as above |
| stage not moving on an rc tag | Tag doesn't match the rc regex, CI not green for that SHA, its `sha-<commit>` images not built within ~15 minutes, or `promote-stage.yml` failed | `gh run list --workflow=promote-stage.yml`; confirm the tag is exactly `vX.Y.Z-rc.N`; confirm the tagged commit is on `master`, `CI` succeeded for it and `sha-<commit>` exists for both services |
| production promotion blocked at the gate ("tag the master commit stage is running") | After waiting up to ~15 minutes, `:stage` still isn't running the digest of the tagged commit (a newer `master` build moved it on, or that commit was never built as `sha-<commit>`) | Release the commit stage runs now (`/deploy-check`), or pin stage to the tagged commit with an rc tag, then retag `vX.Y.Z` |
| production promotion stuck | Waiting on `production` environment approval | Approve the run in the Actions UI (reviewer `YuriiOks`) |
| Agent log shows `ROLLED BACK` / `SKIPPED quarantined` and an env stays on the old revision | The new image failed its health check on the box; the agent put the previous image back and quarantined the digest | `cat ~/.local/state/yuriodev-deploy.quarantine/<env>.<svc>.failed.log` (health and last 200 log lines of the failed container, saved before the rollback deleted it; `docker compose logs` now shows only the rolled-back container); fix and ship a new commit/tag (lifts it by itself), or reset it by hand — see "Automatic rollback and quarantine" |
| Agent log shows `ROLLBACK FAILED (<cause>)` or `ERROR no healthy image is running` | The previous image could not be restored or is unhealthy too (likely an environment-side cause: env file, proxy, network, daemon); the `.broken` marker keeps the agent exiting 1 and the ping off | The `.failed.log` above, `docker compose [-f deploy/<env>/compose.yml] logs --tail 200 <svc>` for the container running now, and `/smoke-test`; the service needs a human |
| Agent log shows `FAILED compose up while deploying ...; nothing was recreated` every minute | `docker compose up` itself fails (daemon, port, compose file); the running container was not touched | Run the same `docker compose [-f deploy/<env>/compose.yml] up -d --no-deps <svc>` by hand after `touch ~/.yuriodev-deploy-paused` to see the error (a production change for prod: ask first) |
| Agent log shows `REFUSED image without explicit tag` | A compose file's `image:` was edited to drop its tag | Compose files must pin `:dev` / `:stage` / `:production` explicitly — the agent refuses to guess `:latest` |
| Cloudflare 526 | Origin certificate invalid/expired | See `/cert-status`; certs live at `nginx-proxy/certs/origin.{pem,key}` |
| `/health` or `/api/health` reports the wrong `environment` | Wrong or missing `env/<env>.env` value, or the service was never recreated after an env-file edit (the deploy agent doesn't do this) | Check the compose file's `env_file` order, then follow "Environment config" above to recreate the one service |
| `Proxy image` workflow (`proxy-image.yml`) fails | A fixable HIGH/CRITICAL CVE in the pinned nginx image (gates nothing: app images, `:dev`/`:stage` and releases keep moving) | Merge Dependabot's `docker-compose` digest bump (or pin a fresh digest), then roll it out: "The proxy image" above |
| CI's backend Trivy step fails | A fixable HIGH/CRITICAL CVE in a pin in `backend/requirements.txt` | Bump that pin to the fixed version the report names |
| Production monitor issue opened (`monitor` label) | `uptime.yml` found `/`, `/api/health`, or the revision-vs-latest-release check failing from outside | `gh issue list --label monitor --state open` for the exact problem list; then `/smoke-test` from the box itself |
