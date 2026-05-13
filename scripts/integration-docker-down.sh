#!/bin/sh
set -eu

COMPOSE_FILE=${SCPS_DOCKER_COMPOSE_FILE:-docker-compose.integration.yml}
PROJECT_NAME=${SCPS_DOCKER_PROJECT:-scps-integration}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  else
    echo "docker compose is required" >&2
    exit 1
  fi
}

if [ "${SCPS_DOCKER_KEEP_VOLUMES:-0}" = "1" ]; then
  compose down --remove-orphans
else
  compose down -v --remove-orphans
fi
