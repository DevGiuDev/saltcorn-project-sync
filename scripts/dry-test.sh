#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
#  Saltcorn Project Sync — Dry Test
#
#  Two-phase local validation before pushing to test:
#
#  Phase 1 (plan):  export remote state, compute diff + plan
#  Phase 2 (apply): spin up Docker, restore remote state,
#                   apply branch changes, report results
#
#  Usage:
#    export SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn-test.example.com
#    export SALTCORN_PROJECT_SYNC_API_TOKEN=your-secret-token
#    git checkout test
#    ./scripts/dry-test.sh              # both phases
#    ./scripts/dry-test.sh --plan-only  # phase 1 only
# ═══════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $ROOT_DIR/bin/saltcorn-project-sync.js"

# ─── Colors/helpers ────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

step()   { echo ""; echo -e "${CYAN}▸ $1${RESET}"; }
ok()     { echo -e "  ${GREEN}✅ $1${RESET}"; }
warn()   { echo -e "  ${YELLOW}⚠️  $1${RESET}"; }
fail()   { echo -e "  ${RED}❌ $1${RESET}"; }
die()    { fail "$1"; exit 1; }
info()   { echo -e "  ${DIM}$1${RESET}"; }

section() {
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  $1${RESET}"
  echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
}

# ─── Config ────────────────────────────────────────────────
REMOTE_BASE_URL="${SALTCORN_PROJECT_SYNC_BASE_URL:-}"
REMOTE_TOKEN="${SALTCORN_PROJECT_SYNC_API_TOKEN:-}"
PLAN_ONLY=false
KEEP_DOCKER=false
KEEP_WORK_DIR=false

for arg in "$@"; do
  case "$arg" in
    --plan-only)   PLAN_ONLY=true ;;
    --keep-docker) KEEP_DOCKER=true ;;
    --keep-work)   KEEP_WORK_DIR=true ;;
    --help|-h)
      echo "Usage: $0 [--plan-only] [--keep-docker] [--keep-work]"
      echo ""
      echo "  --plan-only    Only compute diff+plan (no Docker)"
      echo "  --keep-docker  Leave Docker running after phase 2"
      echo "  --keep-work    Preserve temp working directory"
      exit 0
      ;;
  esac
done

# ─── Preflight checks ─────────────────────────────────────
[ -z "$REMOTE_BASE_URL" ] && die "SALTCORN_PROJECT_SYNC_BASE_URL is not set"
[ -z "$REMOTE_TOKEN" ] && die "SALTCORN_PROJECT_SYNC_API_TOKEN is not set"

DOCKER_PROJECT="scps-dry-test"
LOCAL_PORT="${DRY_TEST_PORT:-4333}"
LOCAL_TOKEN="dry-test-local-token"
LOCAL_BASE_URL="http://127.0.0.1:${LOCAL_PORT}"
WORK_DIR=""

cleanup() {
  local exit_code=$?
  echo ""
  if [ "$KEEP_DOCKER" = false ] && [ -n "$WORK_DIR" ] && [ "$PLAN_ONLY" = false ]; then
    step "Cleaning up Docker..."
    SCPS_DOCKER_PROJECT="$DOCKER_PROJECT" \
      "$SCRIPT_DIR/integration-docker-down.sh" 2>/dev/null || true
  fi
  if [ "$KEEP_WORK_DIR" = false ] && [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/scps-dry-test.XXXXXX")"

BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo 'detached')"
COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"

section "Saltcorn Project Sync — Dry Test"
info "Branch:  ${BRANCH}"
info "Commit:  ${COMMIT}"
info "Remote:  ${REMOTE_BASE_URL}"
info "Plan only: ${PLAN_ONLY}"

# ════════════════════════════════════════════════════════════
#  PHASE 1: Plan preview
# ════════════════════════════════════════════════════════════

section "Phase 1: Plan preview"

# ─── 1a: Connect to remote ────────────────────────────────
step "Connecting to remote Saltcorn..."
REMOTE_INFO=$(SALTCORN_PROJECT_SYNC_ADAPTER=rest \
  SALTCORN_PROJECT_SYNC_BASE_URL="$REMOTE_BASE_URL" \
  SALTCORN_PROJECT_SYNC_API_TOKEN="$REMOTE_TOKEN" \
  "$CLI" doctor-live --adapter rest 2>&1) || {
  fail "Cannot connect to $REMOTE_BASE_URL"
  echo "$REMOTE_INFO"
  exit 1
}
ok "Connected to $REMOTE_BASE_URL"

# ─── 1b: Export remote state ──────────────────────────────
step "Exporting current state from remote..."
REMOTE_STATE_DIR="$WORK_DIR/remote-state"
mkdir -p "$REMOTE_STATE_DIR"
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$REMOTE_BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$REMOTE_TOKEN" \
  "$CLI" export --adapter rest --out "$REMOTE_STATE_DIR" 2>&1
ok "Remote state exported to ${REMOTE_STATE_DIR}"

# ─── 1c: Validate local project ───────────────────────────
step "Validating local project..."
VALIDATE_OUT=$("$CLI" validate 2>&1) && {
  ok "Project validation passed"
} || {
  warn "Project validation issues:"
  echo "$VALIDATE_OUT"
}

# ─── 1d: Dependency check ─────────────────────────────────
step "Checking dependencies..."
DEPS_OUT=$("$CLI" deps 2>&1) && {
  ok "Dependencies OK"
} || {
  warn "Dependency issues:"
  echo "$DEPS_OUT"
}

# ─── 1e: Diff ──────────────────────────────────────────────
TENANT_EXPORT="$REMOTE_STATE_DIR/tenant-export.json"

if [ ! -f "$TENANT_EXPORT" ]; then
  die "tenant-export.json not found in remote export"
fi

step "Computing diff against remote state..."
DIFF_OUT=$("$CLI" diff --tenant-export "$TENANT_EXPORT" 2>&1)
DIFF_EXIT=$?
echo "$DIFF_OUT"
if [ $DIFF_EXIT -eq 0 ]; then
  ok "Diff computed"
else
  warn "Diff exited with code $DIFF_EXIT"
fi

# ─── 1f: Plan ──────────────────────────────────────────────
step "Computing plan for test environment..."
PLAN_OUT=$("$CLI" plan --env test --tenant-export "$TENANT_EXPORT" 2>&1)
PLAN_EXIT=$?
echo "$PLAN_OUT"

# Try to extract structured info from plan JSON output
PLAN_JSON=""
if [ -f "$TENANT_EXPORT" ]; then
  # The plan command outputs JSON — try to parse it
  PLAN_JSON=$(echo "$PLAN_OUT" | tail -1)
fi

if [ $PLAN_EXIT -eq 0 ]; then
  ok "Plan computed"
else
  warn "Plan has issues (exit code $PLAN_EXIT)"
fi

# ─── 1g: Report ───────────────────────────────────────────
step "Generating full report..."
REPORT_FILE="$WORK_DIR/dry-test-report.md"
"$CLI" report --env test --tenant-export "$TENANT_EXPORT" --out "$REPORT_FILE" 2>/dev/null || true

if [ -f "$REPORT_FILE" ]; then
  ok "Report saved: ${REPORT_FILE}"
  echo ""
  cat "$REPORT_FILE"
fi

if [ "$PLAN_ONLY" = true ]; then
  section "Plan-only mode — done"
  info "Report:   ${REPORT_FILE}"
  info "Export:   ${REMOTE_STATE_DIR}"
  exit 0
fi

# ════════════════════════════════════════════════════════════
#  PHASE 2: Full Docker dry test
# ════════════════════════════════════════════════════════════

section "Phase 2: Full Docker dry test"

# ─── 2a: Spin up Docker ───────────────────────────────────
step "Spinning up disposable Docker Saltcorn on port ${LOCAL_PORT}..."

# We need a project dir for Docker to mount.
# Create a minimal one that includes the remote state as the "project".
DOCKER_PROJECT_DIR="$WORK_DIR/docker-project"
mkdir -p "$DOCKER_PROJECT_DIR"

# Copy the remote export as the project state to restore
cp -r "$REMOTE_STATE_DIR"/* "$DOCKER_PROJECT_DIR/" 2>/dev/null || true

# Ensure a manifest exists so the entrypoint finds a project
if [ ! -f "$DOCKER_PROJECT_DIR/saltcorn.project.json" ]; then
  node -e "
    const fs = require('fs');
    const manifest = {
      name: 'dry-test-clone',
      slug: 'dry-test-clone',
      version: '1.0.0',
      format_version: 1,
      saltcorn_version: '>=1.0.0'
    };
    fs.writeFileSync('$DOCKER_PROJECT_DIR/saltcorn.project.json', JSON.stringify(manifest, null, 2));
  "
fi

# Copy plugin lock from the real project if available
for lock in plugins.lock.json plugins.lock.integration.json; do
  if [ -f "$ROOT_DIR/$lock" ] && [ ! -f "$DOCKER_PROJECT_DIR/$lock" ]; then
    cp "$ROOT_DIR/$lock" "$DOCKER_PROJECT_DIR/$lock"
  fi
done

SCPS_DOCKER_PROJECT="$DOCKER_PROJECT" \
SCPS_SALTCORN_PORT="$LOCAL_PORT" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$LOCAL_TOKEN" \
SCPS_PROJECT_HOST_DIR="$DOCKER_PROJECT_DIR" \
SCPS_RESET_SCHEMA=1 \
SCPS_DOCKER_REUSE=0 \
  "$SCRIPT_DIR/integration-docker-up.sh" || {
  die "Docker failed to start"
}
ok "Docker Saltcorn ready at ${LOCAL_BASE_URL}"

# ─── 2b: Restore remote state into Docker ─────────────────
step "Restoring remote state into Docker..."
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$LOCAL_BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$LOCAL_TOKEN" \
SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1 \
  "$CLI" apply --adapter rest --env dev 2>&1 | tee "$WORK_DIR/restore.log" || {
  warn "Restore had issues (this may be expected if plugins are missing in Docker)"
}

# ─── 2c: Verify restore — export Docker state ─────────────
step "Verifying restored state..."
DOCKER_STATE_DIR="$WORK_DIR/docker-state-restored"
mkdir -p "$DOCKER_STATE_DIR"
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$LOCAL_BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$LOCAL_TOKEN" \
  "$CLI" export --adapter rest --out "$DOCKER_STATE_DIR" 2>&1
ok "Docker state exported for comparison"

# Quick count comparison
REMOTE_TABLES=$(node -e "try{const d=require('$REMOTE_STATE_DIR/tenant-export.json');console.log(Object.keys(d.tables||{}).length)}catch(e){console.log('?')}")
DOCKER_TABLES=$(node -e "try{const d=require('$DOCKER_STATE_DIR/tenant-export.json');console.log(Object.keys(d.tables||{}).length)}catch(e){console.log('?')}")
REMOTE_VIEWS=$(node -e "try{const d=require('$REMOTE_STATE_DIR/tenant-export.json');console.log(Object.keys(d.views||{}).length)}catch(e){console.log('?')}")
DOCKER_VIEWS=$(node -e "try{const d=require('$DOCKER_STATE_DIR/tenant-export.json');console.log(Object.keys(d.views||{}).length)}catch(e){console.log('?')}")

info "Tables:  remote=${REMOTE_TABLES}  docker=${DOCKER_TABLES}"
info "Views:   remote=${REMOTE_VIEWS}  docker=${DOCKER_VIEWS}"

# ─── 2d: Apply branch changes to Docker ───────────────────
step "Applying branch changes (from ${BRANCH}) to Docker..."

# We run apply from the ROOT_DIR (the actual repo with the branch code)
# pointing to the local Docker instance
APPLY_RESULT_FILE="$WORK_DIR/apply-result.json"

cd "$ROOT_DIR"

SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$LOCAL_BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$LOCAL_TOKEN" \
SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1 \
  "$CLI" apply --adapter rest --env dev \
  2>&1 | tee "$APPLY_RESULT_FILE"
APPLY_EXIT=$?

# ─── 2e: Post-apply verification ──────────────────────────
step "Post-apply verification..."
POST_APPLY_DIR="$WORK_DIR/docker-state-post-apply"
mkdir -p "$POST_APPLY_DIR"
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$LOCAL_BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$LOCAL_TOKEN" \
  "$CLI" export --adapter rest --out "$POST_APPLY_DIR" 2>&1
ok "Post-apply state exported"

POST_TABLES=$(node -e "try{const d=require('$POST_APPLY_DIR/tenant-export.json');console.log(Object.keys(d.tables||{}).length)}catch(e){console.log('?')}")
POST_VIEWS=$(node -e "try{const d=require('$POST_APPLY_DIR/tenant-export.json');console.log(Object.keys(d.views||{}).length)}catch(e){console.log('?')}")
POST_PAGES=$(node -e "try{const d=require('$POST_APPLY_DIR/tenant-export.json');console.log(Object.keys(d.pages||{}).length)}catch(e){console.log('?')}")

info "Post-apply — Tables: ${POST_TABLES}  Views: ${POST_VIEWS}  Pages: ${POST_PAGES}"

# ─── 2f: Diff post-apply vs remote ────────────────────────
POST_TENANT_EXPORT="$POST_APPLY_DIR/tenant-export.json"
if [ -f "$POST_TENANT_EXPORT" ]; then
  step "Diff: post-apply Docker vs original remote state..."
  POST_DIFF=$("$CLI" diff --tenant-export "$POST_TENANT_EXPORT" 2>&1) || true
  echo "$POST_DIFF"
fi

# ════════════════════════════════════════════════════════════
#  SUMMARY
# ════════════════════════════════════════════════════════════

section "Summary"

echo ""
info "Branch:         ${BRANCH} (${COMMIT})"
info "Remote:         ${REMOTE_BASE_URL}"
info "Work dir:       ${WORK_DIR}"
info "Remote export:  ${REMOTE_STATE_DIR}"
info "Docker state:   ${DOCKER_STATE_DIR}"
info "Post-apply:     ${POST_APPLY_DIR}"
info "Report:         ${REPORT_FILE}"
echo ""

# Summary table
printf "  %-25s %-12s %-12s %-12s\n" "" "Remote" "Docker" "Post-apply"
printf "  %-25s %-12s %-12s %-12s\n" "Tables:" "$REMOTE_TABLES" "$DOCKER_TABLES" "$POST_TABLES"
printf "  %-25s %-12s %-12s %-12s\n" "Views:" "$REMOTE_VIEWS" "$DOCKER_VIEWS" "$POST_VIEWS"
echo ""

if [ $APPLY_EXIT -eq 0 ]; then
  ok "Dry test PASSED — branch changes apply cleanly"
  echo ""
  info "Docker test instance is running at:"
  info "  ${LOCAL_BASE_URL}"
  info ""
  info "  Browse:    ${LOCAL_BASE_URL}/project-sync"
  info "  Email:     admin@saltcorn.local"
  info "  Password:  admin123"
  info ""
  info "To stop Docker:"
  info "  SCPS_DOCKER_PROJECT=${DOCKER_PROJECT} ./scripts/integration-docker-down.sh"
  KEEP_DOCKER=true
else
  fail "Dry test FOUND ISSUES — review apply-result.json"
  echo ""
  info "Docker is still running for manual inspection:"
  info "  ${LOCAL_BASE_URL}"
  info ""
  info "To stop Docker:"
  info "  SCPS_DOCKER_PROJECT=${DOCKER_PROJECT} ./scripts/integration-docker-down.sh"
  KEEP_DOCKER=true
fi

echo ""
echo -e "${BOLD}Files in ${WORK_DIR}:${RESET}"
ls -la "$WORK_DIR/" 2>/dev/null

exit $APPLY_EXIT
