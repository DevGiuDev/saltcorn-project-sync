/**
 * CLI tests for plan-live, verify-live, and compact apply output.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve("bin/saltcorn-project-sync.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scps-live-"));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
}

function initProject(dir) {
  const init = run(["init", "--name", "LiveProject"], { cwd: dir });
  assert.equal(init.status, 0, `init failed: ${init.stderr}`);
}

function emptyTenantExport() {
  return JSON.stringify({ tables: [], views: [], pages: [], triggers: [], roles: [], menu: [], settings: [] });
}

function writeProjectFile(dir, kind, name, content) {
  const file = path.join(dir, "objects", kind, `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content));
}

test("plan-live exports live state and computes a plan through the command adapter", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const result = run(["plan-live", "--adapter", "command", "--env", "dev"], {
    cwd: dir,
    env: { ...process.env, SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'` },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.adapter, "command");
  assert.ok(plan.operations.some((op) => op.action === "create_table" && op.table === "users"));
});

test("verify-live reports zero drift when live state matches desired state", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const matching = JSON.stringify({
    tables: [{ name: "users", fields: [{ name: "id", type: "Integer" }] }],
    views: [], pages: [], triggers: [], roles: [], menu: [], settings: [],
  });
  const result = run(["verify-live", "--adapter", "command"], {
    cwd: dir,
    env: { ...process.env, SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${matching.replace(/'/g, "'\\''")}'` },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.drift.tables.created.length, 0);
});

test("verify-live reports drift for a table missing from the live tenant", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const result = run(["verify-live", "--adapter", "command"], {
    cwd: dir,
    env: { ...process.env, SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'` },
  });
  assert.equal(result.status, 5);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.drift.tables.created, ["users"]);
});

test("apply prints a compact receipt by default and full state with --full-output", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const env = {
    ...process.env,
    SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'`,
    SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
  };

  const compact = run(["apply", "--adapter", "command", "--env", "dev"], { cwd: dir, env });
  assert.equal(compact.status, 0, compact.stderr || compact.stdout);
  const compactBody = JSON.parse(compact.stdout);
  assert.equal(compactBody.ok, true);
  assert.equal(compactBody.env, "dev");
  assert.match(compactBody.deployment_id, /^deploy-\d{6}$/);
  assert.equal(compactBody.operations, 1);
  assert.equal(compactBody.state, undefined);
  assert.equal(compactBody.plan, undefined);

  const full = run(["apply", "--adapter", "command", "--env", "dev", "--full-output"], { cwd: dir, env });
  assert.equal(full.status, 0, full.stderr || full.stdout);
  const fullBody = JSON.parse(full.stdout);
  assert.equal(fullBody.applied, true);
  assert.ok(fullBody.state);
  assert.ok(fullBody.plan);
  assert.match(fullBody.deployment_id, /^deploy-\d{6}$/);
});
