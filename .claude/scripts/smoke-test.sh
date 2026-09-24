#!/bin/bash
# Read-only smoke test of yuriodev.co.uk: containers, origin (via this box), Cloudflare edge,
# internal health, origin TLS cert, host resources. No POSTs, no LLM calls, no state changes.
# Usage: .claude/scripts/smoke-test.sh        Exit code = number of FAIL lines (0 = healthy).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
fails=0
row() { printf '%-5s %-26s %s\n' "$1" "$2" "$3"; [ "$1" = FAIL ] && fails=$((fails + 1)); return 0; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "${@:3}" "$1" 2>/dev/null || true; }

# 1. containers (compose v2, project yuriodev-deployment)
ps_out=$(timeout 10 docker compose ps -a --format '{{.Name}} {{.State}}' 2>/dev/null)
total=$(printf '%s\n' "$ps_out" | grep -c .)
bad=$(printf '%s\n' "$ps_out" | awk 'NF && $2!="running"{print $1"("$2")"}' | tr '\n' ' ')
if [ "$total" -eq 0 ]; then row FAIL containers "docker compose ps returned nothing"
elif [ -n "$bad" ]; then row FAIL containers "not running: $bad"
else row PASS containers "$total/$total running"; fi

# 2. origin through the local proxy (/etc/hosts maps yuriodev.co.uk to this box; -k = routing check only)
c=$(code "https://yuriodev.co.uk/" 10 -k --resolve yuriodev.co.uk:443:127.0.0.1)
[ "$c" = 200 ] && row PASS "origin /" "$c" || row FAIL "origin /" "HTTP $c (expected 200)"
c=$(code "http://yuriodev.co.uk/" 10 --resolve yuriodev.co.uk:80:127.0.0.1)
[ "$c" = 301 ] && row PASS "origin http->https" "$c" || row WARN "origin http->https" "HTTP $c (expected 301)"

# 3. Cloudflare edge (real DNS via DoH; plain DNS on this box points at the origin)
c=$(code "https://yuriodev.co.uk/" 15 --doh-url https://1.1.1.1/dns-query)
case "$c" in
  200) row PASS "edge (Cloudflare) /" "$c" ;;
  526) row FAIL "edge (Cloudflare) /" "526: Cloudflare rejects the origin certificate (see /cert-status)" ;;
  52?) row FAIL "edge (Cloudflare) /" "$c: Cloudflare cannot reach a healthy origin" ;;
  *)   row FAIL "edge (Cloudflare) /" "HTTP $c" ;;
esac

# 4. internal health (read-only GETs from inside the proxy network)
out=$(timeout 10 docker exec yuriodev-proxy wget -qO- -T 5 http://backend:8000/health 2>/dev/null)
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

# 6. host resources (WARN only)
avail=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
load=$(cut -d' ' -f1 /proc/loadavg)
[ "${avail:-0}" -ge 1500 ] && row PASS memory "${avail} MiB available" || row WARN memory "${avail} MiB available (<1500: no image builds)"
[ "${disk:-100}" -lt 85 ] && row PASS disk "/ ${disk}% used" || row WARN disk "/ ${disk}% used"
row INFO load "$load (4 vCPU)"

echo "---"
[ "$fails" -eq 0 ] && echo "RESULT: healthy" || echo "RESULT: $fails check(s) failed"
exit "$fails"
