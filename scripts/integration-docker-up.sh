#!/bin/sh
set -eu

COMPOSE_FILE=${SCPS_DOCKER_COMPOSE_FILE:-docker-compose.integration.yml}
PROJECT_NAME=${SCPS_DOCKER_PROJECT:-scps-integration}
PORT=${SCPS_SALTCORN_PORT:-3333}
TOKEN=${SALTCORN_PROJECT_SYNC_API_TOKEN:-scps-docker-token}
BASE_URL=${SALTCORN_PROJECT_SYNC_BASE_URL:-http://127.0.0.1:$PORT}
PROJECT_HOST_DIR=${SCPS_PROJECT_HOST_DIR:-/home/devgiu/dev/test-project-sync}

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

if [ "${SCPS_DOCKER_REUSE:-0}" != "1" ]; then
  compose down -v --remove-orphans >/dev/null 2>&1 || true
fi

SCPS_PROJECT_HOST_DIR="$PROJECT_HOST_DIR" compose up -d

echo "Waiting for Saltcorn Project Sync at $BASE_URL ..."
SALTCORN_PROJECT_SYNC_BASE_URL="$BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$TOKEN" \
node <<'NODE'
const baseUrl = process.env.SALTCORN_PROJECT_SYNC_BASE_URL || 'http://127.0.0.1:3333';
const token = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN || 'scps-docker-token';
const deadline = Date.now() + Number(process.env.SCPS_DOCKER_WAIT_MS || 180000);
async function poll() {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/project-sync/api/info`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (res.ok) {
      console.log(text);
      process.exit(0);
    }
    if (Date.now() > deadline) throw new Error(`HTTP ${res.status}: ${text}`);
  } catch (err) {
    if (Date.now() > deadline) {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    }
  }
  setTimeout(poll, 2000);
}
poll();
NODE

cat <<EOF

Docker integration environment is ready.

export SALTCORN_PROJECT_SYNC_ADAPTER=rest
export SALTCORN_PROJECT_SYNC_BASE_URL=$BASE_URL
export SALTCORN_PROJECT_SYNC_API_TOKEN=$TOKEN
# Optional for manual smoke runs; npm run test:integration:docker enables this automatically.
export SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1

EOF
