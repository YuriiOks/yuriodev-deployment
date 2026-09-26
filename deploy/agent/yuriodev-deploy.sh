#!/bin/bash
# Deploy agent for yuriodev.co.uk: follow the registry tags that GitHub Actions moves.
# For each enabled environment, pull its images (anonymous; the packages are public)
# and recreate only the services whose image changed. If a recreated service does not
# come healthy, put the image it ran before back, wait for that to come healthy, and
# quarantine the failed digest until the registry tag moves to a different one.
# Never builds, needs no credentials. Runs from the user crontab every minute:
#   * * * * * ENABLED_ENVS="dev" /home/yurii/yuriodev-deployment/deploy/agent/yuriodev-deploy.sh
# Kill switch: touch ~/.yuriodev-deploy-paused (running containers keep running).
# Log: ~/.local/state/yuriodev-deploy.log (rotated above 5 MB, 3 old files kept)
# Heartbeat: ~/.local/state/yuriodev-deploy.heartbeat
# Quarantine: ~/.local/state/yuriodev-deploy.quarantine/<env>.<service> holds the failed digest;
#   <env>.<service>.failed.log  the failed container's last logs and health, saved before the rollback
#   <env>.<service>.broken      no healthy image is left running: every run exits 1 until it clears
#   <env>.<service>.upfailed    `compose up` failed and nothing changed (not a quarantine; retried)
# Optional, each a one-line URL in a file of mode 600 or 400 owned by this user (never in the repo):
#   ~/.config/yuriodev/deploy-alert-url  gets a POST with a short message on a failed deploy
#   ~/.config/yuriodev/deploy-ping-url   gets a GET after every run that exits 0
# Exit status: 0, or 1 when any enabled environment logged ERROR/FAILED/REFUSED or has a
# .broken service.
set -eEuo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$HOME/.local/state"
LOG="$STATE/yuriodev-deploy.log"
LOG_MAX_BYTES=$((5 * 1024 * 1024))
LOG_KEEP=3
QUARANTINE="$STATE/yuriodev-deploy.quarantine"
CONFIG="$HOME/.config/yuriodev"
mkdir -p "$STATE"
# Bookkeeping never ends a run: a full disk or an unwritable file must not stop a rollback
# or an alert. Only the heartbeat at the very end is allowed to fail loudly.
log() { { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; } 2>/dev/null || true; }
put() {  # file line -> write one line to the file, or log a WARN
  { mkdir -p "${1%/*}" && printf '%s\n' "$2" >"$1"; } 2>/dev/null || log "WARN cannot write $1"
}
drop() {  # files... -> remove them, or log a WARN
  rm -f "$@" 2>/dev/null || log "WARN cannot remove $*"
}
warn_once() {  # id message -> log "WARN message" once, until clear_warn id (no WARN every minute)
  local m="$STATE/yuriodev-deploy.warned.$1"
  if [ "$(cat "$m" 2>/dev/null || true)" != "$2" ]; then log "WARN $2"; put "$m" "$2"; fi
}
clear_warn() { if [ -e "$STATE/yuriodev-deploy.warned.$1" ]; then drop "$STATE/yuriodev-deploy.warned.$1"; fi; }
# An unexpected failure ends the run before the heartbeat, so the heartbeat goes stale.
# (-E hands the trap to $(...) subshells too; log once, from the main shell.)
trap 'st=$?; [ "$BASH_SUBSHELL" != 0 ] || log "ERROR agent aborted at line $LINENO (status $st)"' ERR

if [ -e "$HOME/.yuriodev-deploy-paused" ]; then exit 0; fi
exec 9>"$STATE/yuriodev-deploy.lock"
flock -n 9 || exit 0

rotate_log() {  # yuriodev-deploy.log -> .1 -> .2 -> .3 once it passes LOG_MAX_BYTES
  local size i
  size=$(stat -c %s "$LOG" 2>/dev/null) || return 0
  if [ "$size" -le "$LOG_MAX_BYTES" ]; then return 0; fi
  for ((i = LOG_KEEP - 1; i >= 1; i--)); do
    if [ -f "$LOG.$i" ]; then mv -f "$LOG.$i" "$LOG.$((i + 1))" 2>/dev/null || true; fi
  done
  mv -f "$LOG" "$LOG.1" 2>/dev/null || true
}
rotate_log

compose_file() {
  case "$1" in
    dev)   echo "$ROOT/deploy/dev/compose.yml" ;;
    stage) echo "$ROOT/deploy/stage/compose.yml" ;;
    prod)  echo "$ROOT/docker-compose.yml" ;;
    *)     return 1 ;;
  esac
}

# "service image container port" for every service of a compose file that runs a
# registry image (prod's proxy uses nginx:stable-alpine and is managed by hand).
# Reads the YAML itself: `docker compose config` would load the env_file secrets.
services_of() {
  python3 - "$1" <<'PY'
import sys, yaml
for name, s in (yaml.safe_load(open(sys.argv[1])) or {}).get("services", {}).items():
    img = (s or {}).get("image", "")
    if not img.startswith("ghcr.io/"):
        continue
    port = "8000" if "backend" in name else "80"
    print(name, img, s.get("container_name", ""), port)
PY
}

healthy() {  # container port -> 0 once healthy
  # Images with a HEALTHCHECK: wait for Docker's verdict (up to ~90 s).
  # Without one (older images): fall back to a request through the proxy network.
  local status path=/
  if [ -n "$(docker inspect -f '{{if .Config.Healthcheck}}yes{{end}}' "$1" 2>/dev/null || true)" ]; then
    for _ in $(seq 1 30); do
      status=$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null) || status=""
      [ "$status" = healthy ] && return 0
      [ "$status" = unhealthy ] && return 1
      sleep 3
    done
    return 1
  fi
  [ "$2" = 8000 ] && path=/health
  for _ in 1 2 3 4 5 6; do
    docker exec yuriodev-proxy wget -qO- -T 5 "http://$1:$2$path" >/dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

repo_digest() {  # image repo -> "repo@sha256:..." of the local image, or nothing
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | grep -m 1 -F "$2@" || true
}

config_url() {  # name -> the URL in ~/.config/yuriodev/<name>, only from a private file
  local name=$1 f="$CONFIG/$1" mode owner url
  if [ ! -f "$f" ]; then clear_warn "$name"; return 1; fi
  mode=$(stat -c %a "$f") && owner=$(stat -c %u "$f") || return 1
  if [ "$owner" != "$(id -u)" ] || { [ "$mode" != 600 ] && [ "$mode" != 400 ]; }; then
    warn_once "$name" "ignoring $f: needs mode 600 (or 400) and this user as owner (has $mode, uid $owner)"
    return 1
  fi
  url=$(head -n 1 "$f" 2>/dev/null | tr -d '[:space:]') || url=""
  case "$url" in
    https://*|http://*) clear_warn "$name"; printf '%s\n' "$url" ;;
    *) warn_once "$name" "ignoring $f: the first line is not an http(s) URL"; return 1 ;;
  esac
}

alert() {  # message -> POSTed to the alert URL, if one is configured (the URL is never logged)
  local url
  url=$(config_url deploy-alert-url) || return 0
  if ! curl -fsS -m 10 --retry 2 -o /dev/null --data-binary "yuriodev-deploy on ${HOSTNAME:-?}: $*" "$url" 2>/dev/null; then
    log "WARN alert delivery failed"
  fi
}

ping_success() {  # dead-man's switch: GET the ping URL, if one is configured
  local url
  url=$(config_url deploy-ping-url) || return 0
  if curl -fsS -m 10 --retry 2 -o /dev/null "$url" 2>/dev/null; then
    clear_warn ping-delivery
  else
    warn_once ping-delivery "success ping failed"
  fi
}

evidence() {  # container file what -> the container's health and last 200 log lines (best effort)
  { mkdir -p "${2%/*}" && {
      printf '# %s %s\n# health: ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3"
      docker inspect -f '{{json .State.Health}}' "$1" 2>&1 || echo "(unavailable)"
      printf '# docker logs --tail 200 %s\n' "$1"
      docker logs --tail 200 "$1" 2>&1 || echo "(unavailable)"
    } >"$2"; } 2>/dev/null || log "WARN cannot write $2"
}

quarantine() {  # qfile key [broken] -> record a quarantined digest (and whether nothing healthy runs)
  put "$1" "$2"
  drop "$1.noted" "$1.upfailed"
  if [ "${3:-}" = broken ]; then put "$1.broken" "$2"; else drop "$1.broken"; fi
}

rc=0
deploy() {  # env file service image container port; sets rc=1 on any failure
  local env=$1 file=$2 svc=$3 image=$4 container=$5 port=$6
  local repo="${image%:*}" q="$QUARANTINE/$1.$3" want have now digest key why rb quarantined=""
  case "${image##*/}" in *:*) ;; *) log "$env $svc REFUSED image without explicit tag: $image"; rc=1; return 0 ;; esac
  local held="$repo:quarantined-$env"   # keeps a quarantined image's layers, so re-pulls are cheap
  if ! docker compose -f "$file" pull -q "$svc" </dev/null >/dev/null 2>&1; then
    log "$env $svc ERROR pull failed for $image"; rc=1; return 0
  fi
  want=$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null) || want=""
  have=$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null) || have=""
  if [ -z "$want" ]; then log "$env $svc ERROR no local image for $image after the pull"; rc=1; return 0; fi
  digest=$(repo_digest "$image" "$repo")
  key=${digest:-$want}

  if [ -f "$q" ]; then
    quarantined=$(head -n 1 "$q" 2>/dev/null) || { log "$env $svc ERROR cannot read $q"; rc=1; return 0; }
  fi
  if [ -n "$quarantined" ] && [ "$quarantined" != "$key" ]; then
    drop "$q" "$q.noted" "$q.broken" "$q.failed.log"
    docker image rm "$held" >/dev/null 2>&1 || true
    log "$env $svc QUARANTINE lifted: the tag moved from $quarantined to $key"
    quarantined=""
  fi

  if [ -n "$quarantined" ]; then
    if [ "$want" != "$have" ]; then
      # Point the local tag back at what is running (or drop it when nothing runs), so a
      # manual `up` cannot start the failed image; the held tag keeps its layers.
      docker tag "$want" "$held" >/dev/null 2>&1 || true
      if [ -n "$have" ]; then
        docker tag "$have" "$image" >/dev/null 2>&1 || true
      else
        docker image rm "$image" >/dev/null 2>&1 || true
      fi
    fi
    if [ -e "$q.broken" ]; then rc=1; fi   # no healthy image runs: keep the dead-man's switch down
    if [ ! -e "$q.noted" ]; then
      if [ -e "$q.broken" ]; then
        log "$env $svc SKIPPED quarantined $key; ERROR no healthy image is running, needs a human (see deploy/README.md)"
      else
        log "$env $svc SKIPPED quarantined $key (see deploy/README.md to retry it)"
      fi
      put "$q.noted" "$key"
    fi
    return 0
  fi

  if [ "$want" = "$have" ]; then
    if [ -e "$q.upfailed" ]; then drop "$q.upfailed"; fi
    return 0
  fi

  why=""
  if ! docker compose -f "$file" up -d --no-deps "$svc" </dev/null >/dev/null 2>&1; then
    why="compose up while deploying"
  elif ! healthy "$container" "$port"; then
    why="health check after deploying"
  fi
  if [ -z "$why" ]; then
    log "$env $svc DEPLOYED $digest"
    docker image rm "$held" >/dev/null 2>&1 || true   # left over if the quarantine was reset by hand
    drop "$q.upfailed" "$q.broken" "$q.failed.log"
    return 0
  fi

  rc=1
  now=$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null) || now=""
  if [ "$why" = "compose up while deploying" ] && [ "$now" = "$have" ]; then
    # Nothing was recreated and the new image never ran: no rollback, no quarantine; retry next run.
    log "$env $svc FAILED compose up while deploying $digest; nothing was recreated (still running ${have:-nothing}); retrying next run"
    if [ "$(cat "$q.upfailed" 2>/dev/null || true)" != "$key" ]; then
      alert "$env $svc FAILED compose up while deploying $key; nothing was recreated; retrying every minute"
      put "$q.upfailed" "$key"
    fi
    return 0
  fi

  # The rollback recreates the container, which deletes it and its logs: keep them first.
  if [ -n "$now" ]; then evidence "$container" "$q.failed.log" "$env $svc FAILED $why $key"; fi
  docker tag "$want" "$held" >/dev/null 2>&1 || true
  if [ -z "$have" ]; then
    log "$env $svc FAILED $why $digest; no previous container to roll back to; quarantined $key"
    alert "$env $svc FAILED $why $key; no previous image to roll back to; quarantined; needs a human"
    quarantine "$q" "$key" broken
    return 0
  fi
  log "$env $svc FAILED $why $digest; rolling back to $have"
  if ! docker tag "$have" "$image" >/dev/null 2>&1; then
    rb="re-tagging the previous image failed"
  elif ! docker compose -f "$file" up -d --no-deps --force-recreate "$svc" </dev/null >/dev/null 2>&1; then
    rb="compose up of the previous image failed"
  elif ! healthy "$container" "$port"; then
    rb="the previous image is unhealthy too"
  else
    rb=""
  fi
  if [ -z "$rb" ]; then
    log "$env $svc ROLLED BACK to $have; quarantined $key"
    alert "$env $svc FAILED $why $key; rolled back to the previous image; quarantined"
    quarantine "$q" "$key"
  else
    log "$env $svc ROLLBACK FAILED to $have ($rb); quarantined $key"
    alert "$env $svc FAILED $why $key, and the rollback to the previous image failed ($rb); quarantined; needs a human"
    quarantine "$q" "$key" broken
  fi
}

for env in ${ENABLED_ENVS:-dev}; do
  file=$(compose_file "$env") || { log "$env ERROR unknown environment"; rc=1; continue; }
  [ -f "$file" ] || { log "$env ERROR missing $file"; rc=1; continue; }
  services=$(services_of "$file") || { log "$env ERROR cannot read services from $file"; rc=1; continue; }
  while read -r svc image container port; do
    [ -n "$svc" ] || continue
    deploy "$env" "$file" "$svc" "$image" "$container" "$port"
  done <<<"$services"
done

docker image prune -f >/dev/null 2>&1 || true
touch "$STATE/yuriodev-deploy.heartbeat"
if [ "$rc" -eq 0 ]; then ping_success; fi
exit "$rc"
