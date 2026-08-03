#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
artifact_dir="$root/.package-test"
project_name="scps-package-smoke"
port="${SCPS_PACKAGE_TEST_PORT:-3345}"
compose="$root/docker-compose.integration.yml"

cleanup() {
  docker compose -p "$project_name" -f "$compose" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$artifact_dir"
}
trap cleanup EXIT INT TERM
cleanup
mkdir -p "$artifact_dir/project"

npm pack --ignore-scripts --pack-destination "$artifact_dir" >/dev/null
package_file="$(find "$artifact_dir" -maxdepth 1 -type f -name 'saltcorn-project-sync-*.tgz' -print -quit)"
if [ -z "$package_file" ]; then
  echo "npm pack did not create the package artifact" >&2
  exit 2
fi

mkdir -p "$artifact_dir/unpacked"
tar -xzf "$package_file" -C "$artifact_dir/unpacked"
npm install \
  --prefix "$artifact_dir/unpacked/package" \
  --omit=dev \
  --ignore-scripts \
  --no-audit \
  --no-fund >/dev/null

unset SCPS_PLUGIN_NPM_SPEC
export SCPS_PLUGIN_DIRECTORY="/plugin/.package-test/unpacked/package"
export SCPS_PROJECT_HOST_DIR="$artifact_dir/project"
export SCPS_SALTCORN_PORT="$port"
export SCPS_RESET_SCHEMA=1

docker compose -p "$project_name" -f "$compose" up -d >/dev/null
for _ in $(seq 1 90); do
  container="$(docker compose -p "$project_name" -f "$compose" ps -q saltcorn)"
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
  [ "$state" = "healthy" ] && break
  sleep 2
done
if [ "${state:-}" != "healthy" ]; then
  docker compose -p "$project_name" -f "$compose" logs --tail 200 >&2
  echo "Packed plugin did not become healthy in Saltcorn" >&2
  exit 3
fi

response="$(curl -fsS \
  -H "Authorization: Bearer ${SALTCORN_PROJECT_SYNC_API_TOKEN:-scps-docker-token}" \
  "http://127.0.0.1:$port/project-sync/api/info")"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.ok !== true) throw new Error(`Plugin info failed: ${process.argv[1]}`);
console.log(`Packed plugin Saltcorn smoke passed: ${result.saltcorn_version || "version reported"}`);
' "$response"

token="${SALTCORN_PROJECT_SYNC_API_TOKEN:-scps-docker-token}"
package_version="$(node -p "require('$artifact_dir/unpacked/package/package.json').version")"
ledger_payload="$(printf '{\"request_id\":\"package-smoke-001\",\"deployment_id\":\"deploy-package-smoke\",\"project\":\"package-smoke\",\"version\":\"%s\",\"environment\":\"test\",\"status\":\"verified\",\"operations\":{\"count\":0},\"warnings\":{\"count\":0},\"convergence\":{\"ok\":true,\"operations\":0}}' "$package_version")"
ledger_post() {
  local out code
  out="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$ledger_payload" "http://127.0.0.1:$port/project-sync/api/deployments" 2>/dev/null)"
  code="$(node -e 'try{const b=JSON.parse(process.argv[1]);console.log(b&&b.ok===true?"200":"500")}catch(e){console.log("500")}' "$out")"
  if [ "$code" != "200" ]; then
    echo "Ledger POST failed. Response body:" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s' "$out"
}
created="$(ledger_post)" || exit 1
replayed="$(ledger_post)" || exit 1
listed="$(curl -fsS -H "Authorization: Bearer $token" "http://127.0.0.1:$port/project-sync/api/deployments")"
node -e '
const created = JSON.parse(process.argv[1]);
const replayed = JSON.parse(process.argv[2]);
const listed = JSON.parse(process.argv[3]);
if (!created.ok || created.created !== true) throw new Error(`Ledger create failed: ${process.argv[1]}`);
if (!replayed.ok || replayed.created !== false) throw new Error(`Ledger replay failed: ${process.argv[2]}`);
if (!listed.ok || listed.records.length !== 1) throw new Error(`Ledger list failed: ${process.argv[3]}`);
console.log("Packed plugin deployment ledger smoke passed");
' "$created" "$replayed" "$listed"
