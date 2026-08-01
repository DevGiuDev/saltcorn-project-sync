#!/bin/sh
set -eu

PORT=${SCPS_SALTCORN_PORT:-3333}
TOKEN=${SALTCORN_PROJECT_SYNC_API_TOKEN:-scps-docker-token}
BASE_URL=${SALTCORN_PROJECT_SYNC_BASE_URL:-http://127.0.0.1:$PORT}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_HOST_DIR="${SCPS_PROJECT_HOST_DIR:-${SCRIPT_DIR}/../examples}"

cleanup() {
  status=$?
  if [ "${SCPS_DOCKER_KEEP_UP:-0}" != "1" ]; then
    ./scripts/integration-docker-down.sh || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

SCPS_PROJECT_HOST_DIR="$PROJECT_HOST_DIR" ./scripts/integration-docker-up.sh

echo ""
echo "=== Phase 1: bare plugin smoke test ==="
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$TOKEN" \
SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY="${SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY:-1}" \
SALTCORN_PROJECT_SYNC_INTEGRATION_TEST_APPLY="${SALTCORN_PROJECT_SYNC_INTEGRATION_TEST_APPLY:-1}" \
npm run test:integration

echo ""
echo "=== Phase 2: project $(basename "$PROJECT_HOST_DIR") against clean Saltcorn ==="
SALTCORN_PROJECT_SYNC_ADAPTER=rest \
SALTCORN_PROJECT_SYNC_BASE_URL="$BASE_URL" \
SALTCORN_PROJECT_SYNC_API_TOKEN="$TOKEN" \
node -e '
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const projectDir = process.env.SCPS_PROJECT_HOST_DIR || path.resolve(process.cwd(), "examples");
const env = {
  ...process.env,
  SALTCORN_PROJECT_SYNC_ADAPTER: "rest",
  SALTCORN_PROJECT_SYNC_BASE_URL: process.env.SALTCORN_PROJECT_SYNC_BASE_URL,
  SALTCORN_PROJECT_SYNC_API_TOKEN: process.env.SALTCORN_PROJECT_SYNC_API_TOKEN,
};
const CLI = path.resolve("bin/saltcorn-project-sync.js");

function run(args) {
  console.log("  > saltcorn-project-sync " + args.join(" "));
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: projectDir, env, encoding: "utf8", maxBuffer: 1024*1024*10 });
  return r;
}

async function main() {
const checks = [];
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scps-project-smoke-"));

// Validate project
checks.push({ step: "validate", ok: run(["validate"]).status === 0 });

// Check live
checks.push({ step: "check-live", ok: run(["check-live", "--adapter", "rest"]).status === 0 });

// Doctor-live
checks.push({ step: "doctor-live", ok: run(["doctor-live", "--adapter", "rest"]).status === 0 });

// Export live state (to a temp dir, not the project itself)
const exportTmpDir = path.join(smokeRoot, "live-before");
checks.push({ step: "export", ok: run(["export", "--adapter", "rest", "--out", exportTmpDir]).status === 0 });

// Capture the raw tenant export. The CLI export command writes project object
// files, not a monolithic tenant-export.json consumed by diff/plan.
const tenantExport = path.join(exportTmpDir, "tenant-export.json");
const { restAdapter } = require(path.resolve("lib/tenant-adapters.js"));
const { loadProjectState } = require(path.resolve("lib/project-state.js"));
const desiredState = loadProjectState(projectDir);
const liveState = await restAdapter().exportProject({ referenceTables: desiredState.reference_data || [] });
if (!liveState || liveState.ok === false || liveState.error) {
  throw new Error("REST export returned an error payload: " + JSON.stringify(liveState));
}
fs.writeFileSync(tenantExport, JSON.stringify(liveState));

const diffResult = run(["diff", "--tenant-export", tenantExport]);
checks.push({ step: "diff", ok: diffResult.status === 0 });
const planResult = run(["plan", "--env", "dev", "--tenant-export", tenantExport]);
checks.push({ step: "plan", ok: planResult.status === 0 });
if (planResult.status === 0) {
  const plan = JSON.parse(planResult.stdout);
  console.log("    plan: " + (plan.operations?.length||0) + " ops, " + (plan.warnings?.length||0) + " warnings, " + (plan.blocked?.length||0) + " blocked");
  if ((plan.blocked || []).length) checks.push({ step: "plan blockers", ok: false });
}

// A partial/unsupported apply is a failed integration test. Successful HTTP
// transport alone is not enough to validate a deployable project.
const applyResult = run(["apply", "--adapter", "rest", "--env", "dev"]);
const applyOk = applyResult.status === 0;
checks.push({ step: "apply (full project)", ok: applyOk });
if (!applyOk) {
  const output = (applyResult.stdout || "") + (applyResult.stderr || "");
  const errMatch = output.match(/returned \d+: (.*)/);
  console.log("    apply error: " + (errMatch ? errMatch[1].substring(0, 240) : output.substring(0, 240)));
}

// Post-apply export and convergence: applying the same desired state again must
// produce a no-op plan rather than silently repeating or skipping operations.
checks.push({ step: "post-apply-export", ok: run(["export", "--adapter", "rest", "--out", path.join(smokeRoot, "live-after")]).status === 0 });
const convergenceResult = run(["apply", "--adapter", "rest", "--env", "dev"]);
let convergenceOk = convergenceResult.status === 0;
if (convergenceOk) {
  try {
    const convergence = JSON.parse(convergenceResult.stdout);
    convergenceOk = (convergence.plan?.operations || []).length === 0;
    if (!convergenceOk) console.log("    convergence plan still has operations: " + JSON.stringify(convergence.plan.operations));
  } catch (_e) {
    convergenceOk = false;
  }
}
checks.push({ step: "post-apply convergence", ok: convergenceOk });

// Seeds and migrations
checks.push({ step: "list-seeds", ok: run(["list-seeds"]).status === 0 });
checks.push({ step: "list-migrations", ok: run(["list-migrations"]).status === 0 });

const failed = checks.filter(function(c) { return !c.ok; });
fs.rmSync(smokeRoot, { recursive: true, force: true });
console.log("");
console.log("Project smoke results:");
for (const c of checks) console.log("  " + (c.ok ? "✅" : "❌") + " " + c.step);
if (failed.length) {
  console.log("\n" + failed.length + " critical checks failed");
  process.exit(1);
} else {
  const passCount = checks.filter(function(c){return c.ok;}).length;
  console.log("\nAll critical checks passed (" + passCount + "/" + checks.length + " ok)");
}
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
'
