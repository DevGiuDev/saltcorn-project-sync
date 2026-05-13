const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { appendDeploymentRecord, loadDeploymentRecords } = require("../lib/deployments");

const CLI = path.resolve("bin/saltcorn-project-sync.js");

test("CLI help includes preflight and doctor-live", () => {
  const result = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /preflight/);
  assert.match(result.stdout, /doctor-live/);
});

test("restore records rollback deployment distinctly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-restore-"));
  appendDeploymentRecord(dir, { env: "prod", status: "applied-live", backup: { id: "backup-1" } });
  const result = spawnSync(process.execPath, [CLI, "restore", "--adapter", "command", "--deployment", "last"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_RESTORE_CMD: "cat >/dev/null; printf '{\"ok\":true,\"restored\":true}'",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const records = loadDeploymentRecords(dir);
  assert.equal(records[1].id, "rollback-000001");
  assert.equal(records[1].kind, "rollback");
  assert.equal(records[1].rollback_of, "deploy-000001");
});

test("prod live apply rejects skipped backup metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-cli-"));
  const init = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  const result = spawnSync(process.execPath, [CLI, "apply", "--adapter", "command", "--env", "prod"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_EXPORT_CMD: "printf '{\"tables\":[],\"views\":[],\"pages\":[],\"triggers\":[],\"roles\":[],\"menu\":[],\"settings\":[]}'",
      SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
      SALTCORN_PROJECT_SYNC_BACKUP_CMD: "",
    },
  });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /verifiable backup metadata is required/);
});

test("reset requires --yes-reset-everything", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-reset-"));
  const init = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  const result = spawnSync(process.execPath, [CLI, "reset", "--adapter", "command"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD: "printf '{\"ok\":true}'",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr || result.stdout, /--yes-reset-everything/);

  fs.rmSync(dir, { recursive: true });
});

test("reset chains reset-schema, apply, seeds, migrations", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-reset-"));
  const init = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  // Add a seed and migration
  spawnSync(process.execPath, [CLI, "add-seed", "--name", "test-seed", "--order", "1"], { cwd: dir, encoding: "utf8" });
  spawnSync(process.execPath, [CLI, "add-migration", "--name", "test-migration", "--order", "1"], { cwd: dir, encoding: "utf8" });

  const result = spawnSync(process.execPath, [CLI, "reset", "--adapter", "command", "--yes-reset-everything"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD: "printf '{\"ok\":true}'",
      SALTCORN_PROJECT_SYNC_EXPORT_CMD: "printf '{\"tables\":[],\"views\":[],\"pages\":[],\"triggers\":[],\"roles\":[],\"menu\":[],\"settings\":[]}'",
      SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  const phaseNames = output.phases.map((p) => p.phase);
  assert.ok(phaseNames.includes("reset-schema"));
  assert.ok(phaseNames.includes("apply-project"));
  assert.ok(phaseNames.includes("seeds"));
  assert.ok(phaseNames.includes("migrations"));

  fs.rmSync(dir, { recursive: true });
});
