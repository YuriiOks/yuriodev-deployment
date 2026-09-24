#!/bin/bash
# Deploy agent for yuriodev.co.uk: follow the registry tags that GitHub Actions moves.
# For each enabled environment, pull its images (anonymous; the packages are public)
# and recreate only the services whose image changed. Never builds, needs no
# credentials. Runs from the user crontab every minute:
#   * * * * * ENABLED_ENVS="dev" /home/yurii/yuriodev-deployment/deploy/agent/yuriodev-deploy.sh
# Kill switch: touch ~/.yuriodev-deploy-paused (running containers keep running).
# Log: ~/.local/state/yuriodev-deploy.log   Heartbeat: ~/.local/state/yuriodev-deploy.heartbeat
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$HOME/.local/state"
LOG="$STATE/yuriodev-deploy.log"
mkdir -p "$STATE"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

[ -e "$HOME/.yuriodev-deploy-paused" ] && exit 0
exec 9>"$STATE/yuriodev-deploy.lock"
flock -n 9 || exit 0

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
services_of() {
  docker compose -f "$1" config --format json 2>/dev/null | python3 -c '
import json, sys
for name, s in json.load(sys.stdin)["services"].items():
    img = s.get("image", "")
    if not img.startswith("ghcr.io/"):
        continue
    port = "8000" if "backend" in name else "80"
    print(name, img, s.get("container_name", ""), port)'
}

healthy() {  # container port -> 0 if it answers through the proxy network
  local path=/; [ "$2" = 8000 ] && path=/health
  for _ in 1 2 3 4 5 6; do
    docker exec yuriodev-proxy wget -qO- -T 5 "http://$1:$2$path" >/dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

for env in ${ENABLED_ENVS:-dev}; do
  file=$(compose_file "$env") || { log "$env ERROR unknown environment"; continue; }
  [ -f "$file" ] || { log "$env ERROR missing $file"; continue; }
  while read -r svc image container port; do
    [ -n "$svc" ] || continue
    tag="${image##*/}"
    case "$tag" in *:*) ;; *) log "$env $svc REFUSED image without explicit tag: $image"; continue ;; esac
    if ! docker compose -f "$file" pull -q "$svc" >/dev/null 2>&1; then
      log "$env $svc ERROR pull failed for $image"; continue
    fi
    want=$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)
    have=$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)
    [ -n "$want" ] && [ "$want" = "$have" ] && continue
    digest=$(docker image inspect -f '{{index .RepoDigests 0}}' "$image" 2>/dev/null)
    if docker compose -f "$file" up -d --no-deps "$svc" >/dev/null 2>&1 && healthy "$container" "$port"; then
      log "$env $svc DEPLOYED $digest"
    else
      log "$env $svc FAILED health check after deploying $digest"
    fi
  done < <(services_of "$file")
done

docker image prune -f >/dev/null 2>&1
touch "$STATE/yuriodev-deploy.heartbeat"
