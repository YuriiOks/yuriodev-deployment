#!/bin/bash
# SessionStart hook (all sources: startup/resume/clear/compact) for /home/yurii/yuriodev-deployment.
# Prints a short live-status banner that Claude sees as context. Read-only, fail-open, ~0.5 s.
cat >/dev/null 2>&1 || true
ROOT="${CLAUDE_PROJECT_DIR:-/home/yurii/yuriodev-deployment}"
cd "$ROOT" 2>/dev/null || exit 0

g() { git --no-optional-locks -c core.fsmonitor=false "$@" 2>/dev/null; }
branch=$(g branch --show-current)
staged=$(g diff --no-ext-diff --cached --name-only | grep -c . )
states=$(timeout 5 docker compose ps -a --format '{{.State}}' 2>/dev/null)
total=$(printf '%s\n' "$states" | grep -c . )
running=$(printf '%s\n' "$states" | grep -c '^running$' )
end=$(timeout 4 openssl s_client -connect 127.0.0.1:443 -servername yuriodev.co.uk </dev/null 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$end" ] && days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 )) 2>/dev/null; then
  if [ "$days" -lt 0 ]; then cert="ORIGIN CERT EXPIRED $(( -days ))d ago -> Cloudflare 526, site down (run /cert-status)"
  elif [ "$days" -lt 14 ]; then cert="origin cert expires in ${days}d (run /cert-status)"
  else cert="origin cert ${days}d left"; fi
else
  cert="origin cert: unknown (proxy not answering on 127.0.0.1:443)"
fi
load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)
mem=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)

echo "yuriodev-deployment: PRODUCTION runs live from this directory | branch ${branch:-?} | ${staged:-?} staged paths | containers ${running:-?}/${total:-?} running | ${cert} | load ${load:-?} | ${mem:-?} MiB free"
echo "Rules: CLAUDE.md 'Golden rules' (compose v2, one service at a time, ask before any container/git state change). Tools: /smoke-test /check-logs /cert-status /deploy-check /deploy. Open work: docs/backlog.md."
exit 0
