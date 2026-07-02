#!/usr/bin/env bash
#
# Shade watchdog — restarts shade-backend when its Slack socket silently dies or
# the process hangs. systemd's Restart=on-failure only catches crashes; this
# covers the "process alive but socket dead" case that stranded Slack on
# 2026-05-27 (repeated "Expected 101" / pong-timeout, no recovery).
#
# Detection: polls the backend health endpoints.
#   /health/slack -> 200 healthy, 503 unhealthy (dead socket / orchestrator down)
#   /health       -> liveness fallback (and tells us if /health/slack predates a deploy)
# Restarts after FAIL_THRESHOLD consecutive bad checks, with a cooldown after
# each restart and an hourly cap so a hard failure (e.g. revoked token) doesn't
# become a restart storm.
#
# Runs as a long-lived systemd service (see shade-watchdog.service). All config
# is via environment variables with the defaults below.
set -uo pipefail

SERVICE="${SERVICE:-shade-backend}"
SLACK_HEALTH_URL="${SLACK_HEALTH_URL:-http://localhost:3000/health/slack}"
BASE_HEALTH_URL="${BASE_HEALTH_URL:-http://localhost:3000/health}"
INTERVAL="${INTERVAL:-30}"            # seconds between checks
TIMEOUT="${TIMEOUT:-8}"               # per-request curl timeout
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}" # consecutive bad checks before restart
COOLDOWN="${COOLDOWN:-180}"           # seconds to wait after a restart
MAX_RESTARTS_PER_HOUR="${MAX_RESTARTS_PER_HOUR:-4}"
BACKOFF="${BACKOFF:-1800}"            # seconds to pause when the hourly cap is hit

log() { echo "$(date -Is) $*"; }

fails=0
declare -a restart_times=()

# Classify a single health check. Echoes one of:
#   HEALTHY | SLACK_DOWN | PROC_DOWN | UNKNOWN
check() {
  local body http ec
  body="$(curl -s -m "$TIMEOUT" -w $'\n%{http_code}' "$SLACK_HEALTH_URL" 2>/dev/null)"
  ec=$?
  if [ $ec -ne 0 ]; then
    # Couldn't connect/timed out — process is down or hung.
    echo "PROC_DOWN"
    return
  fi

  http="${body##*$'\n'}"
  body="${body%$'\n'*}"

  case "$http" in
    200)
      echo "HEALTHY"
      ;;
    404)
      # /health/slack not present yet (backend predates this feature). Fall back
      # to plain liveness: if the base health endpoint answers, the process is
      # fine and we simply can't see Slack health yet.
      if curl -fs -m "$TIMEOUT" "$BASE_HEALTH_URL" >/dev/null 2>&1; then
        echo "UNKNOWN"
      else
        echo "PROC_DOWN"
      fi
      ;;
    503)
      case "$body" in
        *'orchestrator not running'*) echo "PROC_DOWN" ;;
        *) echo "SLACK_DOWN" ;;
      esac
      ;;
    *)
      echo "PROC_DOWN"
      ;;
  esac
}

restart_allowed() {
  # Prune restart timestamps older than an hour, then check the cap.
  local now cutoff kept=()
  now=$(date +%s)
  cutoff=$((now - 3600))
  for t in "${restart_times[@]:-}"; do
    [ -n "$t" ] && [ "$t" -ge "$cutoff" ] && kept+=("$t")
  done
  restart_times=("${kept[@]:-}")
  # Count non-empty entries.
  local count=0
  for t in "${restart_times[@]:-}"; do [ -n "$t" ] && count=$((count + 1)); done
  [ "$count" -lt "$MAX_RESTARTS_PER_HOUR" ]
}

do_restart() {
  local reason="$1"
  if ! restart_allowed; then
    log "WARN restart suppressed ($reason): $MAX_RESTARTS_PER_HOUR restarts in the last hour; backing off ${BACKOFF}s. A restart isn't fixing this — check tokens/network."
    sleep "$BACKOFF"
    fails=0
    return
  fi
  log "RESTART $SERVICE ($reason; $fails consecutive bad checks)"
  if sudo -n systemctl restart "$SERVICE"; then
    restart_times+=("$(date +%s)")
    log "RESTART issued; cooling down ${COOLDOWN}s"
  else
    log "ERROR systemctl restart $SERVICE failed (sudo -n)"
  fi
  fails=0
  sleep "$COOLDOWN"
}

log "shade-watchdog starting: service=$SERVICE url=$SLACK_HEALTH_URL interval=${INTERVAL}s threshold=$FAIL_THRESHOLD"

while true; do
  status="$(check)"
  case "$status" in
    HEALTHY|UNKNOWN)
      if [ "$fails" -gt 0 ]; then
        log "recovered (status=$status)"
      fi
      fails=0
      ;;
    SLACK_DOWN|PROC_DOWN)
      fails=$((fails + 1))
      log "unhealthy (status=$status, $fails/$FAIL_THRESHOLD)"
      if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
        do_restart "$status"
      fi
      ;;
  esac
  sleep "$INTERVAL"
done
