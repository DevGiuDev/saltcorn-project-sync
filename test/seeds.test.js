const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateSeedFile,
  validateMigrationFile,
  planSeeds,
  planMigrations,
  writeSeedFile,
  writeMigrationFile,
  loadSeedFiles,
  loadMigrationFiles,
  validateSeeds,
} = require("../lib/seeds");

const emptySeed = { name: "test", mode: "upsert", tables: [] };
const sampleSeed = {
  name: "countries",
  mode: "upsert",
  tables: [
    { table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] },
  ],
};
const emptyMigration = { name: "test-migration", steps: [] };
const sampleMigration = {
  name: "add-status",
  steps: [
    { action: "ensure_table", table: "invoices" },
    { action: "ensure_field", table: "invoices", field: "status", type: "String" },
  ],
};

test("validateSeedFile accepts valid seed", () => {
  assert.deepEqual(validateSeedFile(sampleSeed, "test.json"), []);
});

test("validateSeedFile rejects missing name", () => {
  assert.ok(validateSeedFile({ tables: [] }, "bad.json").length);
});

test("validateSeedFile rejects invalid mode", () => {
  assert.ok(validateSeedFile({ name: "x", mode: "drop_everything", tables: [] }, "bad.json").length);
});

test("validateSeedFile accepts truncate mode", () => {
  assert.deepEqual(validateSeedFile({ name: "x", mode: "truncate", tables: [] }, "ok.json"), []);
});

test("validateSeedFile accepts replace mode", () => {
  assert.deepEqual(validateSeedFile({ name: "x", mode: "replace", tables: [{ table: "t", rows: [], key: "id" }] }, "ok.json"), []);
});

test("validateSeedFile rejects missing table/rows/key", () => {
  const errors = validateSeedFile({ name: "x", tables: [{ rows: "not-array" }] }, "bad.json");
  assert.ok(errors.length >= 2);
});

test("validateMigrationFile accepts valid migration", () => {
  assert.deepEqual(validateMigrationFile(sampleMigration, "test.json"), []);
});

test("validateMigrationFile rejects missing name", () => {
  assert.ok(validateMigrationFile({ steps: [] }, "bad.json").length);
});

test("validateMigrationFile rejects unknown action", () => {
  const errors = validateMigrationFile({ name: "x", steps: [{ action: "drop_everything" }] }, "bad.json");
  assert.ok(errors.length);
});

test("planSeeds produces seed_row operations", () => {
  const plan = planSeeds([{ seed: sampleSeed, file: "001.json" }]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "seed_row");
  assert.equal(plan.operations[0].table, "countries");
  assert.equal(plan.operations[0].mode, "upsert");
  assert.equal(plan.operations[0].safe, true);
  assert.deepEqual(plan.operations[0].row, { code: "ES", name: "Spain" });
});

test("planSeeds marks replace mode as not safe", () => {
  const seed = { ...sampleSeed, mode: "replace" };
  const plan = planSeeds([{ seed, file: "001.json" }]);
  assert.equal(plan.operations[0].safe, false);
});

test("planMigrations produces ensure operations", () => {
  const plan = planMigrations([{ migration: sampleMigration, file: "001.json" }]);
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[0].action, "create_table");
  assert.equal(plan.operations[1].action, "ensure_field");
});

test("planMigrations warns about raw_sql", () => {
  const migration = { name: "raw-test", steps: [{ action: "raw_sql", sql: "SELECT 1" }] };
  const plan = planMigrations([{ migration, file: "001.json" }]);
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.warnings[0].type, "raw_sql");
});

test("writeSeedFile and loadSeedFiles round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-seeds-"));
  writeSeedFile(dir, { ...sampleSeed, _order: 1 });
  const loaded = loadSeedFiles(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].valid, true);
  assert.equal(loaded[0].seed.name, "countries");
  assert.equal(loaded[0].seed.tables.length, 1);
  fs.rmSync(dir, { recursive: true });
});

test("writeMigrationFile and loadMigrationFiles round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-migrations-"));
  writeMigrationFile(dir, { ...sampleMigration, _order: 1 });
  const loaded = loadMigrationFiles(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].valid, true);
  assert.equal(loaded[0].migration.name, "add-status");
  assert.equal(loaded[0].migration.steps.length, 2);
  fs.rmSync(dir, { recursive: true });
});

test("validateSeeds combines seed and migration validation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-validate-"));
  writeSeedFile(dir, { ...sampleSeed, _order: 1 });
  writeMigrationFile(dir, { ...sampleMigration, _order: 1 });
  const result = validateSeeds(dir);
  assert.equal(result.valid, true);
  assert.equal(result.seeds.length, 1);
  assert.equal(result.migrations.length, 1);
  fs.rmSync(dir, { recursive: true });
});

test("empty project has no seeds and warns", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-empty-"));
  const result = validateSeeds(dir);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
  fs.rmSync(dir, { recursive: true });
});

test("seed files are loaded in sorted order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-order-"));
  writeSeedFile(dir, { name: "second", tables: [], _order: 10 });
  writeSeedFile(dir, { name: "first", tables: [], _order: 1 });
  const loaded = loadSeedFiles(dir);
  assert.equal(loaded[0].seed.name, "first");
  assert.equal(loaded[1].seed.name, "second");
  fs.rmSync(dir, { recursive: true });
});

test("planSeeds generates truncate_table for replace mode", () => {
  const plan = planSeeds([{
    seed: { name: "replace-countries", mode: "replace", tables: [
      { table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] },
    ] },
  }]);
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[0].action, "truncate_table");
  assert.equal(plan.operations[0].table, "countries");
  assert.equal(plan.operations[0].destructive, true);
  assert.equal(plan.operations[1].action, "seed_row");
  assert.equal(plan.operations[1].table, "countries");
  assert.ok(plan.warnings.length >= 1);
  assert.equal(plan.warnings[0].type, "destructive_seed");
});

test("planSeeds generates truncate_table only for truncate mode", () => {
  const plan = planSeeds([{
    seed: { name: "clear-log", mode: "truncate", tables: [
      { table: "audit_log", key: "id", rows: [] },
    ] },
  }]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "truncate_table");
  assert.equal(plan.operations[0].destructive, true);
  assert.equal(plan.operations[0].table, "audit_log");
});

test("planSeeds upsert mode has no destructive ops", () => {
  const plan = planSeeds([{
    seed: { name: "upsert-countries", mode: "upsert", tables: [
      { table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] },
    ] },
  }]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "seed_row");
  assert.equal(plan.operations[0].safe, true);
  assert.equal(plan.operations[0].destructive, undefined);
});
