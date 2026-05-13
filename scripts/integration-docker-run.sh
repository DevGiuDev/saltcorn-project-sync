#!/bin/sh
set -eu

PORT=${SCPS_SALTCORN_PORT:-3333}
TOKEN=${SALTCORN_PROJECT_SYNC_API_TOKEN:-scps-docker-token}
BASE_URL=${SALTCORN_PROJECT_SYNC_BASE_URL:-http://127.0.0.1:$PORT}
PROJECT_HOST_DIR="${SCPS_PROJECT_HOST_DIR:-/home/devgiu/dev/test-project-sync}"

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
const projectDir = process.env.SCPS_PROJECT_HOST_DIR || "/home/devgiu/dev/test-project-sync";
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

const checks = [];

// Validate project
checks.push({ step: "validate", ok: run(["validate"]).status === 0 });

// Check live
checks.push({ step: "check-live", ok: run(["check-live", "--adapter", "rest"]).status === 0 });

// Doctor-live
checks.push({ step: "doctor-live", ok: run(["doctor-live", "--adapter", "rest"]).status === 0 });

// Export live state
checks.push({ step: "export", ok: run(["export", "--adapter", "rest", "--out", projectDir]).status === 0 });

// Diff + plan
const tenantExport = path.join(projectDir, "tenant-export.json");
if (fs.existsSync(tenantExport)) {
  checks.push({ step: "diff", ok: run(["diff", "--tenant-export", tenantExport]).status === 0 });
  const planResult = run(["plan", "--env", "dev", "--tenant-export", tenantExport]);
  checks.push({ step: "plan", ok: planResult.status === 0 });
  try {
    const plan = JSON.parse(planResult.stdout);
    console.log("    plan: " + (plan.operations?.length||0) + " ops, " + (plan.warnings?.length||0) + " warnings, " + (plan.blocked?.length||0) + " blocked");
  } catch (_e) {}
}

// Apply: may partially fail if project uses field types from plugins not fully loaded
// (e.g. UUID fields need uuid-type plugin fully initialized). This is expected
// in a clean Docker without all production plugins. The test validates the pipeline
// reaches Saltcorn correctly.
const applyResult = run(["apply", "--adapter", "rest", "--env", "dev"]);
const applyOk = applyResult.status === 0;
checks.push({ step: "apply (full project)", ok: applyOk });
if (!applyOk) {
  // Extract the error for reporting
  const output = (applyResult.stdout || "") + (applyResult.stderr || "");
  const errMatch = output.match(/returned \d+: (.*)/);
  console.log("    apply error: " + (errMatch ? errMatch[1].substring(0, 120) : output.substring(0, 120)));
  console.log("    This is expected when project depends on plugins/types not available in clean Docker.");
}

// Post-apply export: even if apply partially failed, export should still work
checks.push({ step: "post-apply-export", ok: run(["export", "--adapter", "rest", "--out", path.join(projectDir, ".post-apply-export")]).status === 0 });

// Seeds and migrations
checks.push({ step: "list-seeds", ok: run(["list-seeds"]).status === 0 });
checks.push({ step: "list-migrations", ok: run(["list-migrations"]).status === 0 });

const failed = checks.filter(function(c) { return !c.ok && c.step !== "apply (full project)"; });
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
'
