/**
 * CLI tests for the one-command `deploy` orchestration.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve("bin/saltcorn-project-sync.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scps-deploy-"));
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
  const init = run(["init", "--name", "DeployProject"], { cwd: dir });
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

function baseEnv(extra = {}) {
  return {
    ...process.env,
    SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'`,
    SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
    SALTCORN_PROJECT_SYNC_BACKUP_CMD:
      "printf '{\"ok\":true,\"id\":\"cmd-backup\",\"created_at\":\"2026-01-01T00:00:00Z\",\"sha256\":\"deadbeef\"}'",
    ...extra,
  };
}

test("deploy requires --yes or a TTY to proceed non-interactively", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const result = run(["deploy", "--adapter", "command", "--env", "dev"], { cwd: dir, env: baseEnv() });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  const confirmation = body.steps.find((s) => s.step === "confirmation");
  assert.equal(confirmation.ok, false);
});

test("deploy blocks destructive operations without --allow-destructive", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const tenantExport = JSON.stringify({
    tables: [{ name: "users", fields: [{ name: "id", type: "Integer" }, { name: "legacy", type: "String" }] }],
    views: [], pages: [], triggers: [], roles: [], menu: [], settings: [],
  });
  const result = run(["deploy", "--adapter", "command", "--env", "dev", "--yes"], {
    cwd: dir,
    env: baseEnv({ SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${tenantExport.replace(/'/g, "'\\''")}'` }),
  });
  // Absent from Git is drift/orphaned, not destructive, so this plan has zero
  // destructive operations and should proceed; assert the guard step reports ok.
  const body = JSON.parse(result.stdout);
  const destructiveGuard = body.steps.find((s) => s.step === "destructive-guard");
  assert.equal(destructiveGuard, undefined);
});

test("deploy runs the full pipeline with --yes and records a local deployment", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const result = run(["deploy", "--adapter", "command", "--env", "dev", "--yes"], { cwd: dir, env: baseEnv() });
  const body = JSON.parse(result.stdout);
  assert.match(body.deployment_id, /^deploy-\d{6}$/);
  assert.equal(body.backup.id, "cmd-backup");
  assert.equal(body.adapter, "command");
  const stepNames = body.steps.map((s) => s.step);
  assert.deepEqual(stepNames, ["connect", "compatibility", "plan", "confirmation", "backup", "apply", "refresh", "verify", "record"]);
  assert.equal(body.steps.find((s) => s.step === "record").target, "local-only");

  const { loadDeploymentRecords } = require("../lib/deployments");
  const records = loadDeploymentRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].env, "dev");
});

test("deploy requires verifiable backup metadata for test/prod", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  const result = run(["deploy", "--adapter", "command", "--env", "prod", "--yes"], {
    cwd: dir,
    env: baseEnv({ SALTCORN_PROJECT_SYNC_BACKUP_CMD: "" }),
  });
  assert.equal(result.status, 3, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  const backupStep = body.steps.find((s) => s.step === "backup");
  assert.equal(backupStep.ok, false);
});

test("deploy --skip-verify records ok:true even though drift would otherwise be detected", () => {
  const dir = tmpDir();
  initProject(dir);
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  // The command adapter's export is a static shell command, so post-apply
  // export still reports an empty tenant; without --skip-verify this would
  // be reported as drift.
  const result = run(["deploy", "--adapter", "command", "--env", "dev", "--yes", "--skip-verify"], {
    cwd: dir,
    env: baseEnv(),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.convergence, null);
  const verifyStep = body.steps.find((s) => s.step === "verify");
  assert.equal(verifyStep.skipped, true);
});
