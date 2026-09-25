#!/bin/bash
# Read-only smoke test of yuriodev.co.uk: containers (prod/dev/stage), origin (via this box),
# dev/stage basic auth, Cloudflare edge, internal health, origin TLS cert, deploy agent,
# production image freshness, host resources. No POSTs, no LLM calls, no state changes.
# Usage: .claude/scripts/smoke-test.sh        Exit code = number of FAIL lines (0 = healthy).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
fails=0
row() { printf '%-5s %-26s %s\n' "$1" "$2" "$3"; [ "$1" = FAIL ] && fails=$((fails + 1)); return 0; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "${@:3}" "$1" 2>/dev/null || true; }

# 1. containers: production (compose v2, project yuriodev-deployment) - down is a FAIL
ps_out=$(timeout 10 docker compose ps -a --format '{{.Name}} {{.State}}' 2>/dev/null)
total=$(printf '%s\n' "$ps_out" | grep -c .)
bad=$(printf '%s\n' "$ps_out" | awk 'NF && $2!="running"{print $1"("$2")"}' | tr '\n' ' ')
if [ "$total" -eq 0 ]; then row FAIL "containers (prod)" "docker compose ps returned nothing"
elif [ -n "$bad" ]; then row FAIL "containers (prod)" "not running: $bad"
else row PASS "containers (prod)" "$total/$total running"; fi

# 1b. containers: dev / stage (secondary environments) - missing or down is only a WARN
env_containers() {  # label compose-file
  local label="$1" file="$2" out tot b
  if [ ! -f "$file" ]; then row WARN "containers ($label)" "compose file missing: $file"; return; fi
  out=$(timeout 10 docker compose -f "$file" ps -a --format '{{.Name}} {{.State}}' 2>/dev/null)
  tot=$(printf '%s\n' "$out" | grep -c .)
  if [ "$tot" -eq 0 ]; then row WARN "containers ($label)" "no containers (project not up)"; return; fi
  b=$(printf '%s\n' "$out" | awk 'NF && $2!="running"{print $1"("$2")"}' | tr '\n' ' ')
  if [ -n "$b" ]; then row WARN "containers ($label)" "not running: $b"
  else row PASS "containers ($label)" "$tot/$tot running"; fi
}
env_containers dev "$ROOT/deploy/dev/compose.yml"
env_containers stage "$ROOT/deploy/stage/compose.yml"

# 2. origin through the local proxy (/etc/hosts maps yuriodev.co.uk to this box; -k = routing check only)
c=$(code "https://yuriodev.co.uk/" 10 -k --resolve yuriodev.co.uk:443:127.0.0.1)
[ "$c" = 200 ] && row PASS "origin /" "$c" || row FAIL "origin /" "HTTP $c (expected 200)"
c=$(code "http://yuriodev.co.uk/" 10 --resolve yuriodev.co.uk:80:127.0.0.1)
[ "$c" = 301 ] && row PASS "origin http->https" "$c" || row WARN "origin http->https" "HTTP $c (expected 301)"
# the proxy must reach the backend container itself (FastAPI answers 404 for /api/*; 5xx = proxy cannot reach it)
c=$(code "https://yuriodev.co.uk/api/health" 10 -k --resolve yuriodev.co.uk:443:127.0.0.1)
case "$c" in 5??|000) row FAIL "origin /api/ -> backend" "HTTP $c: proxy cannot reach the backend" ;; *) row PASS "origin /api/ -> backend" "$c (answered by the backend)" ;; esac

# 2b. dev / stage through the origin: basic auth must gate them (401 with no credentials,
# 200 with the credentials from ~/.config/yuriodev/basic-auth.txt). Never echo the credentials.
# File format: lines "user: X" / "password: Y". Missing file -> WARN and skip the authed half.
auth_file="$HOME/.config/yuriodev/basic-auth.txt"
auth_user="" auth_pass=""
if [ -f "$auth_file" ]; then
  auth_user=$(sed -n 's/^user:[[:space:]]*//p' "$auth_file" | head -1)
  auth_pass=$(sed -n 's/^password:[[:space:]]*//p' "$auth_file" | head -1)
  [ -z "$auth_user" ] || [ -z "$auth_pass" ] && row WARN "dev/stage credentials" "$auth_file present but user/password line missing"
else
  row WARN "dev/stage credentials" "$auth_file missing, skipping authed origin checks"
fi
env_auth() {  # label host
  local label="$1" host="$2" c
  c=$(code "https://$host/" 10 -k --resolve "$host:443:127.0.0.1")
  case "$c" in
    401) row PASS "$label origin (no auth)" "401 (auth required)" ;;
    000) row WARN "$label origin (no auth)" "no response (env likely down)" ;;
    *)   row WARN "$label origin (no auth)" "HTTP $c (expected 401)" ;;
  esac
  if [ -n "$auth_user" ] && [ -n "$auth_pass" ]; then
    c=$(code "https://$host/" 10 -k --resolve "$host:443:127.0.0.1" -u "$auth_user:$auth_pass")
    case "$c" in
      200) row PASS "$label origin (with auth)" "200" ;;
      000) row WARN "$label origin (with auth)" "no response (env likely down)" ;;
      *)   row WARN "$label origin (with auth)" "HTTP $c (expected 200)" ;;
    esac
  fi
}
env_auth dev dev.yuriodev.co.uk
env_auth stage stage.yuriodev.co.uk

# 3. Cloudflare edge (real DNS via DoH; plain DNS on this box points at the origin)
c=$(code "https://yuriodev.co.uk/" 15 --doh-url https://1.1.1.1/dns-query)
case "$c" in
  200) row PASS "edge (Cloudflare) /" "$c" ;;
  526) row FAIL "edge (Cloudflare) /" "526: Cloudflare rejects the origin certificate (see /cert-status)" ;;
  52?) row FAIL "edge (Cloudflare) /" "$c: Cloudflare cannot reach a healthy origin" ;;
  *)   row FAIL "edge (Cloudflare) /" "HTTP $c" ;;
esac

# 4. internal health (read-only GETs from inside the proxy network)
out=$(timeout 10 docker exec yuriodev-proxy wget -qO- -T 5 http://yuriodev-backend:8000/health 2>/dev/null)
case "$out" in *healthy*) row PASS "backend /health" "ok" ;; *) row FAIL "backend /health" "no healthy response" ;; esac
if timeout 10 docker exec yuriodev-proxy nginx -t >/dev/null 2>&1; then row PASS "proxy nginx -t" "config ok"
else row FAIL "proxy nginx -t" "config test failed"; fi

# 5. origin TLS certificate served by the proxy
end=$(timeout 5 openssl s_client -connect 127.0.0.1:443 -servername yuriodev.co.uk </dev/null 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$end" ]; then row FAIL "origin cert" "could not read the served certificate"
else
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  if [ "$days" -lt 0 ]; then row FAIL "origin cert" "EXPIRED $(( -days ))d ago ($end)"
  elif [ "$days" -lt 14 ]; then row WARN "origin cert" "expires in ${days}d ($end)"
  else row PASS "origin cert" "${days}d left ($end)"; fi
fi

# 6. deploy agent: heartbeat freshness + recent log errors (never builds/pulls itself here, read-only)
paused_file="$HOME/.yuriodev-deploy-paused"
heartbeat="$HOME/.local/state/yuriodev-deploy.heartbeat"
if [ -e "$paused_file" ]; then
  row INFO "deploy agent" "paused ($paused_file present)"
elif [ ! -e "$heartbeat" ]; then
  row WARN "deploy agent" "heartbeat missing: $heartbeat"
else
  hb_age=$(( $(date +%s) - $(stat -c %Y "$heartbeat" 2>/dev/null || echo 0) ))
  if [ "$hb_age" -gt 300 ]; then row WARN "deploy agent" "heartbeat stale (${hb_age}s old, >5m)"
  else row PASS "deploy agent" "heartbeat ${hb_age}s old"; fi
fi
deploy_log="$HOME/.local/state/yuriodev-deploy.log"
if [ -f "$deploy_log" ]; then
  bad_lines=$(tail -n 50 "$deploy_log" | grep -Ec 'FAILED|ERROR|REFUSED')
  if [ "$bad_lines" -gt 0 ]; then row WARN "deploy agent log" "$bad_lines FAILED/ERROR/REFUSED line(s) in last 50"
  else row PASS "deploy agent log" "clean (last 50 lines)"; fi
else
  row WARN "deploy agent log" "log missing: $deploy_log"
fi

# 7. production image freshness: only when docker-compose.yml pins an image: (still build:-only -> INFO).
# Reads the compose FILE directly (never `docker compose config`, which would load the env files).
compose_service_image() {  # service -> "image:" value under that top-level service block, if any
  awk -v svc="$1" '
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { in_svc = ($0 == "  "svc":") }
    in_svc && /^    image:[[:space:]]*/ { sub(/^    image:[[:space:]]*/, ""); gsub(/^["'"'"']|["'"'"']$/, ""); print; exit }
  ' "$ROOT/docker-compose.yml"
}
prod_digest() {  # svc container-name
  local svc="$1" container="$2" image want have
  image=$(compose_service_image "$svc")
  [ -n "$image" ] || return 1
  case "$image" in ghcr.io/*) ;; *) return 1 ;; esac
  want=$(timeout 5 docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)
  have=$(timeout 5 docker inspect -f '{{.Image}}' "$container" 2>/dev/null)
  if [ -z "$want" ]; then row WARN "prod digest ($svc)" "not cached locally: $image"
  elif [ -z "$have" ]; then row WARN "prod digest ($svc)" "container not found: $container"
  elif [ "$want" = "$have" ]; then row INFO "prod digest ($svc)" "running container matches local $image"
  else row WARN "prod digest ($svc)" "running container != local $image (redeploy pending?)"; fi
  return 0
}
fe_checked=1; be_checked=1
prod_digest frontend yuriodev-frontend || fe_checked=0
prod_digest backend yuriodev-backend || be_checked=0
[ "$fe_checked" -eq 0 ] && [ "$be_checked" -eq 0 ] && row INFO "prod digest" "docker-compose.yml uses build: only (no registry image yet)"

# 7b. proxy pin rollout: the deploy agent never touches the proxy, so after a digest bump the
# running proxy lags behind the pin until someone recreates it by hand.
proxy_pin=$(compose_service_image proxy)
case "$proxy_pin" in
  *@sha256:*)
    proxy_ref="${proxy_pin%%@*}"; proxy_ref="${proxy_ref%:*}@${proxy_pin#*@}"   # name:tag@sha256:x -> name@sha256:x
    want=$(timeout 5 docker image inspect -f '{{.Id}}' "$proxy_ref" 2>/dev/null)
    have=$(timeout 5 docker inspect -f '{{.Image}}' yuriodev-proxy 2>/dev/null)
    if [ -z "$want" ]; then row INFO "prod digest (proxy)" "pinned image not cached locally: pin not rolled out (deploy/README.md, The proxy image)"
    elif [ -z "$have" ]; then row WARN "prod digest (proxy)" "container not found: yuriodev-proxy"
    elif [ "$want" = "$have" ]; then row PASS "prod digest (proxy)" "running proxy matches the pinned digest"
    else row WARN "prod digest (proxy)" "running proxy != pinned digest: pin not rolled out (deploy/README.md, The proxy image)"; fi ;;
  *) row WARN "prod digest (proxy)" "proxy image '${proxy_pin:-?}' is not pinned by digest" ;;
esac

# 8. host resources (WARN only)
avail=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
load=$(cut -d' ' -f1 /proc/loadavg)
[ "${avail:-0}" -ge 1500 ] && row PASS memory "${avail} MiB available" || row WARN memory "${avail} MiB available (<1500: no image builds)"
[ "${disk:-100}" -lt 85 ] && row PASS disk "/ ${disk}% used" || row WARN disk "/ ${disk}% used"
row INFO load "$load (4 vCPU)"

echo "---"
[ "$fails" -eq 0 ] && echo "RESULT: healthy" || echo "RESULT: $fails check(s) failed"
exit "$fails"
