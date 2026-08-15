#!/bin/bash
# agent/dashboard/open-dashboard.sh — start the sweep dashboard if it is not already running, then open it
# in the default browser. Intended to be wired to a desktop-widget button.
#
# IT ONLY OPENS A UI. It NEVER launches run-sweep.sh or any queue item. Launching a sweep is gated behind
# the dashboard's own preflight (tree clean, claude on PATH, server up, prices frozen, a COMPLETE item) —
# a widget button must never be the thing that starts a multi-hour unattended run.
#
# Widgets / launchd / cron get a MINIMAL environment: PATH is set explicitly here and node is resolved by
# absolute path, the same discipline the launchd plist needs. Every path is quoted (the & in EasyM&A splits
# an unquoted path).
set -uo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"  # ~/.local/bin = where claude lives; the dashboard inherits this PATH and the runner inherits it in turn

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$DIR/server.js"
LOG="$DIR/dashboard.log"
PORT="${DASH_PORT:-3002}"
URL="http://localhost:${PORT}"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then for c in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do [ -x "$c" ] && NODE="$c" && break; done; fi

logln() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG" 2>/dev/null; }
port_up() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }   # bash /dev/tcp probe — no lsof/curl needed

if port_up; then
  logln "dashboard already listening on ${PORT} — not spawning another process"
else
  if [ ! -f "$SERVER" ]; then logln "FATAL: server not found at ${SERVER}"; printf 'FATAL: dashboard server not found at %s (see %s)\n' "$SERVER" "$LOG" >&2; exit 1; fi
  if [ -z "$NODE" ]; then logln "FATAL: node not found (PATH=${PATH})"; printf 'FATAL: node not found on PATH (see %s)\n' "$LOG" >&2; exit 1; fi
  logln "starting dashboard: ${NODE} ${SERVER} on ${PORT}"
  nohup "$NODE" "$SERVER" >> "$LOG" 2>&1 &          # detached; output to the log (widget has no terminal)
  up=""; i=0
  while [ "$i" -lt 20 ]; do                          # wait up to ~10s for the port to accept
    if port_up; then up=1; break; fi
    sleep 0.5; i=$((i + 1))
  done
  if [ -z "$up" ]; then logln "FATAL: dashboard did not come up on ${PORT} within 10s"; printf 'FATAL: dashboard did not come up on %s within 10s (see %s)\n' "$PORT" "$LOG" >&2; exit 1; fi
  logln "dashboard up on ${PORT}"
fi

if [ "${NO_OPEN:-0}" = "1" ]; then
  logln "NO_OPEN=1 — skipping browser open (would open ${URL})"
else
  if command -v open >/dev/null 2>&1; then open -na "Google Chrome" --args --app="${URL}" --window-size=840,990 --window-position=340,80 && logln "opened ${URL} in default browser"; else logln "no 'open' command — browse to ${URL} manually"; fi
fi
exit 0
