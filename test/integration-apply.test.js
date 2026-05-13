/**
 * Integration-level tests for apply pipeline:
 * - Non-destructive apply
 * - Orphan preservation (missing-from-Git ≠ delete)
 * - Explicit destructive intent gates
 * - Reset command
 *
 * These tests exercise the CLI end-to-end without a real Saltcorn instance,
 * using the command adapter with shell echo commands.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve("bin/saltcorn-project-sync.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scps-int-"));
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
  const init = run(["init", "--name", "TestProject"], { cwd: dir });
  assert.equal(init.status, 0, `init failed: ${init.stderr}`);
}

function emptyTenantExport() {
  return JSON.stringify({
    tables: [], views: [], pages: [], triggers: [], roles: [], menu: [], settings: [],
  });
}

function writeProjectFile(dir, kind, name, content) {
  const file = path.join(dir, "objects", kind, `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content));
}

// ─── Non-destructive apply ──────────────────────────────────

test("non-destructive apply creates new tables/views without error", () => {
  const dir = tmpDir();
  initProject(dir);

  // Write desired objects
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });
  writeProjectFile(dir, "views", "user_list", { name: "user_list", configuration: {} });

  const tenantExport = path.join(dir, "tenant-export.json");
  fs.writeFileSync(tenantExport, emptyTenantExport());

  const result = run(["apply-file", "--env", "dev", "--tenant-export", tenantExport, "--out", path.join(dir, "applied.json")], { cwd: dir });
  assert.equal(result.status, 0, `apply-file failed: ${result.stderr || result.stdout}`);

  const applied = JSON.parse(result.stdout);
  assert.equal(applied.applied, true);
  assert.ok(applied.plan.operations.length >= 2);

  fs.rmSync(dir, { recursive: true });
});

// ─── Orphan preservation ────────────────────────────────────

test("tenant objects not in Git are preserved (orphaned, not deleted)", () => {
  const dir = tmpDir();
  initProject(dir);

  // Git has "users" table only
  writeProjectFile(dir, "tables", "users", { name: "users", fields: [{ name: "id", type: "Integer" }] });

  // Tenant has both "users" and "orders" (orders is orphaned)
  const tenantExport = {
    tables: [
      { name: "users", fields: [{ name: "id", type: "Integer" }] },
      { name: "orders", fields: [{ name: "id", type: "Integer" }] },
    ],
    views: [], pages: [], triggers: [], roles: [], menu: [], settings: [],
  };
  const exportFile = path.join(dir, "tenant-export.json");
  fs.writeFileSync(exportFile, JSON.stringify(tenantExport));

  const result = run(["plan", "--env", "dev", "--tenant-export", exportFile], { cwd: dir });
  assert.equal(result.status, 0, `plan failed: ${result.stderr || result.stdout}`);

  const plan = JSON.parse(result.stdout);
  // No drop_table for "orders"
  const dropOps = plan.operations.filter((op) => op.action === "drop_table");
  assert.equal(dropOps.length, 0, "orphaned tables must NOT be dropped");

  // Warnings about orphan
  const orphanWarnings = plan.warnings.filter((w) => w.type === "orphaned_table");
  assert.ok(orphanWarnings.length >= 1, "should warn about orphaned table");
  assert.ok(orphanWarnings.some((w) => w.table === "orders"));

  fs.rmSync(dir, { recursive: true });
});

test("orphaned views are warned but not dropped", () => {
  const dir = tmpDir();
  initProject(dir);

  // Git has no views
  // Tenant has a view
  const tenantExport = {
    tables: [],
    views: [{ name: "dashboard", configuration: {} }],
    pages: [], triggers: [], roles: [], menu: [], settings: [],
  };
  const exportFile = path.join(dir, "tenant-export.json");
  fs.writeFileSync(exportFile, JSON.stringify(tenantExport));

  const result = run(["plan", "--env", "dev", "--tenant-export", exportFile], { cwd: dir });
  assert.equal(result.status, 0);

  const plan = JSON.parse(result.stdout);
  const dropOps = plan.operations.filter((op) => op.action === "drop_view");
  assert.equal(dropOps.length, 0, "orphaned views must NOT be dropped");

  const orphanWarnings = plan.warnings.filter((w) => w.type === "orphaned_view");
  assert.ok(orphanWarnings.length >= 1);

  fs.rmSync(dir, { recursive: true });
});

// ─── Destructive intent gates ───────────────────────────────

test("drop_field requires explicit destructive intent", () => {
  const dir = tmpDir();
  initProject(dir);

  // Git: table with field "status"
  writeProjectFile(dir, "tables", "invoices", {
    name: "invoices",
    fields: [
      { name: "id", type: "Integer" },
    ],
  });

  // Tenant: table with fields "id" and "status"
  const tenantExport = {
    tables: [{
      name: "invoices",
      fields: [
        { name: "id", type: "Integer" },
        { name: "status", type: "String" },
      ],
    }],
    views: [], pages: [], triggers: [], roles: [], menu: [], settings: [],
  };
  const exportFile = path.join(dir, "tenant-export.json");
  fs.writeFileSync(exportFile, JSON.stringify(tenantExport));

  const result = run(["plan", "--env", "dev", "--tenant-export", exportFile], { cwd: dir });
  assert.equal(result.status, 0);

  const plan = JSON.parse(result.stdout);
  // "status" field is orphaned — should be warned, not dropped
  const dropOps = plan.operations.filter((op) => op.action === "drop_field");
  assert.equal(dropOps.length, 0, "orphaned field must NOT be auto-dropped");
  const orphanWarnings = plan.warnings.filter((w) => w.type === "orphaned_field");
  assert.ok(orphanWarnings.some((w) => w.table === "invoices" && w.field === "status"));

  fs.rmSync(dir, { recursive: true });
});

test("apply-seeds blocks destructive seed without --allow-destructive", () => {
  const dir = tmpDir();
  initProject(dir);

  // Add a destructive seed (replace mode)
  run(["add-seed", "--name", "replace-data", "--order", "1"], { cwd: dir });
  const seedFile = path.join(dir, "seeds", "001-replace-data.json");
  const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  seed.mode = "replace";
  seed.tables = [{ table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] }];
  fs.writeFileSync(seedFile, JSON.stringify(seed));

  const result = run(["apply-seeds", "--adapter", "command"], {
    cwd: dir,
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'`,
      SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
    },
  });

  assert.equal(result.status, 3, "should exit with code 3 for blocked destructive");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error, /destructive/);
  assert.ok(output.destructive_tables.includes("countries"));

  fs.rmSync(dir, { recursive: true });
});

test("apply-seeds succeeds with --allow-destructive for destructive seed", () => {
  const dir = tmpDir();
  initProject(dir);

  run(["add-seed", "--name", "replace-data", "--order", "1"], { cwd: dir });
  const seedFile = path.join(dir, "seeds", "001-replace-data.json");
  const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  seed.mode = "replace";
  seed.tables = [{ table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] }];
  fs.writeFileSync(seedFile, JSON.stringify(seed));

  const result = run(["apply-seeds", "--adapter", "command", "--allow-destructive"], {
    cwd: dir,
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'`,
      SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
    },
  });

  assert.equal(result.status, 0, `apply-seeds failed: ${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);

  fs.rmSync(dir, { recursive: true });
});

// ─── Reset end-to-end ───────────────────────────────────────

test("reset chains all phases and records deployment", () => {
  const dir = tmpDir();
  initProject(dir);

  // Add seed + migration
  run(["add-seed", "--name", "test-seed", "--order", "1"], { cwd: dir });
  run(["add-migration", "--name", "test-migration", "--order", "1"], { cwd: dir });

  const result = run(["reset", "--adapter", "command", "--yes-reset-everything"], {
    cwd: dir,
    env: {
      ...process.env,
      SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD: "printf '{\"ok\":true}'",
      SALTCORN_PROJECT_SYNC_EXPORT_CMD: `printf '${emptyTenantExport()}'`,
      SALTCORN_PROJECT_SYNC_APPLY_CMD: "cat >/dev/null; printf '{\"ok\":true}'",
    },
  });

  assert.equal(result.status, 0, `reset failed: ${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  const phaseNames = output.phases.map((p) => p.phase);
  assert.ok(phaseNames.includes("reset-schema"));
  assert.ok(phaseNames.includes("apply-project"));
  assert.ok(phaseNames.includes("seeds"));
  assert.ok(phaseNames.includes("migrations"));

  fs.rmSync(dir, { recursive: true });
});
