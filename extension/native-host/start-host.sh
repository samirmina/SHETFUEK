#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
SERVICE="native-host"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/host-docker.log"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] [start-host.sh] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "ERROR: docker CLI not found in PATH"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    log "ERROR: Docker daemon unreachable. If permission denied, re-login to WSL so the docker group membership takes effect."
    exit 1
  fi
}

wait_ready() {
  local i
  for i in $(seq 1 30); do
    if curl -s --max-time 2 -X POST "http://127.0.0.1:27183/api/ping" \
      -H "Content-Type: application/json" -d '{"action":"ping"}' 2>/dev/null | grep -q '"success"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

case "${1:-up}" in
  up)
    log "========================================"
    log "Starting native host (Docker Compose)"
    log "Compose file: $COMPOSE_FILE"
    check_docker
    docker compose -f "$COMPOSE_FILE" up -d --build "$SERVICE"
    log "Waiting for http://localhost:27183 ..."
    if wait_ready; then
      log "native-host is UP on http://localhost:27183"
      log "Ping response: $(curl -s -X POST "http://127.0.0.1:27183/api/ping" -H "Content-Type: application/json" -d '{"action":"ping"}')"
    else
      log "WARN: native-host not ready after 60s. Inspect with: docker compose -f $COMPOSE_FILE logs $SERVICE"
    fi
    ;;
  down)
    check_docker
    log "Stopping native host"
    docker compose -f "$COMPOSE_FILE" down
    ;;
  logs)
    check_docker
    docker compose -f "$COMPOSE_FILE" logs -f "$SERVICE"
    ;;
  status)
    check_docker
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  restart)
    check_docker
    log "Restarting native host"
    docker compose -f "$COMPOSE_FILE" restart "$SERVICE"
    ;;
  *)
    echo "Usage: $0 [up|down|logs|status|restart]"
    exit 2
    ;;
esac
