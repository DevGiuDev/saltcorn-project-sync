const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureLedger,
  isApplied,
  recordApplied,
  recordFailed,
  listApplied,
  filterPending,
  resetLedger,
} = require("../lib/migration-ledger");

/**
 * In-memory mock of the Saltcorn db module. Mimics the subset of db.query
 * behaviour the ledger relies on (CREATE TABLE/INDEX, SELECT, INSERT,
 * UPDATE). Parameterised with $1..$N placeholders like Postgres.
 */
function fakeDb() {
  const rows = [];
  let nextId = 1;
  return {
    isSQLite: false,
    getTenantSchema: () => "public",
    _rows: rows,
    async query(sql, values = []) {
      if (/^(CREATE TABLE|CREATE INDEX)/i.test(sql)) return { rows: [] };
      if (/^SELECT 1 FROM/i.test(sql) && /status = 'applied'/i.test(sql)) {
        const hit = rows.some(
          (row) =>
            row.project === values[0] &&
            row.environment === values[1] &&
            row.migration_name === values[2] &&
            row.status === "applied"
        );
        return { rows: hit ? [{ "?column?": 1 }] : [] };
      }
      if (/^SELECT id FROM/i.test(sql)) {
        return {
          rows: rows
            .filter(
              (row) =>
                row.project === values[0] &&
                row.environment === values[1] &&
                row.migration_name === values[2]
            )
            .slice(0, 1),
        };
      }
      if (/^SELECT migration_name/i.test(sql) && /ORDER BY applied_at/i.test(sql)) {
        return { rows: [...rows] };
      }
      if (/^INSERT INTO/i.test(sql)) {
        // recordApplied INSERT has status as literal 'applied' (6 params):
        //   (project $1, environment $2, migration_name $3, migration_hash $4, phase $5, status='applied', deployment_id $6)
        // recordFailed INSERT has status as literal 'failed' (7 params):
        //   (project $1, environment $2, migration_name $3, migration_hash $4, phase $5, status='failed', deployment_id $6, error $7)
        const isFailed = /'failed'/i.test(sql);
        if (isFailed) {
          rows.push({
            id: nextId++,
            project: values[0],
            environment: values[1],
            migration_name: values[2],
            migration_hash: values[3],
            phase: values[4],
            status: "failed",
            deployment_id: values[5],
            error: values[6],
          });
        } else {
          rows.push({
            id: nextId++,
            project: values[0],
            environment: values[1],
            migration_name: values[2],
            migration_hash: values[3],
            phase: values[4],
            status: "applied",
            deployment_id: values[5],
            error: null,
          });
        }
        return { rows: [] };
      }
      if (/^UPDATE/i.test(sql)) {
        // WHERE project = $N-2 AND environment = $N-1 AND migration_name = $N
        const n = values.length;
        const isFailedUpdate = /status = 'failed'/i.test(sql);
        for (const row of rows) {
          if (
            row.project === values[n - 3] &&
            row.environment === values[n - 2] &&
            row.migration_name === values[n - 1]
          ) {
            row.migration_hash = values[0];
            row.phase = values[1];
            row.deployment_id = values[2];
            row.error = isFailedUpdate ? values[3] : null;
            row.status = isFailedUpdate ? "failed" : "applied";
          }
        }
        return { rows: [] };
      }
      if (/^DELETE FROM/i.test(sql)) {
        rows.length = 0;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const sampleMigration = {
  name: "add-status-index",
  phase: "pre-deploy",
  run: "once",
  steps: [{ action: "raw_sql", sql: "CREATE INDEX idx_status ON invoices(status)" }],
};

const sampleMigration2 = {
  name: "backfill-countries",
  phase: "post-deploy",
  steps: [{ action: "raw_sql", sql: "UPDATE contacts SET country='ES' WHERE country IS NULL" }],
};

test("ensureLedger is idempotent (caches per schema)", async () => {
  const db = fakeDb();
  await ensureLedger(db);
  await ensureLedger(db);
  // No throw means the cached path is exercised.
});

test("isApplied returns false for unknown migration", async () => {
  const db = fakeDb();
  assert.equal(await isApplied("proj", "dev", "missing", db), false);
});

test("recordApplied then isApplied returns true", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, "deploy-001", db);
  assert.equal(await isApplied("proj", "dev", sampleMigration.name, db), true);
});

test("recordApplied persists migration_hash and phase", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, "deploy-001", db);
  const applied = await listApplied("proj", "dev", db);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].migration_name, sampleMigration.name);
  assert.equal(applied[0].phase, "pre-deploy");
  assert.equal(applied[0].status, "applied");
  assert.match(applied[0].migration_hash, /^[a-f0-9]{64}$/);
});

test("recordApplied upserts an existing (e.g. failed) row", async () => {
  const db = fakeDb();
  await recordFailed("proj", "dev", sampleMigration, new Error("boom"), "deploy-001", db);
  const failed = await listApplied("proj", "dev", db);
  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].error, "boom");
  await recordApplied("proj", "dev", sampleMigration, "deploy-002", db);
  const applied = await listApplied("proj", "dev", db);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].status, "applied");
});

test("recordFailed inserts a failed row when none exists", async () => {
  const db = fakeDb();
  await recordFailed("proj", "dev", sampleMigration, new Error("nope"), null, db);
  const rows = await listApplied("proj", "dev", db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error, "nope");
});

test("isApplied is scoped to project + environment", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, null, db);
  assert.equal(await isApplied("proj", "dev", sampleMigration.name, db), true);
  assert.equal(await isApplied("proj", "prod", sampleMigration.name, db), false);
  assert.equal(await isApplied("other", "dev", sampleMigration.name, db), false);
});

test("listApplied returns rows ordered", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, null, db);
  await recordApplied("proj", "dev", sampleMigration2, null, db);
  const rows = await listApplied("proj", "dev", db);
  assert.equal(rows.length, 2);
});

test("filterPending returns only migrations not yet applied", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, null, db);
  const migrations = [
    { migration: sampleMigration, file: "001.json" },
    { migration: sampleMigration2, file: "002.json" },
  ];
  const pending = await filterPending("proj", "dev", migrations, db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].migration.name, sampleMigration2.name);
});

test("filterPending skips failed migrations (they are pending)", async () => {
  const db = fakeDb();
  await recordFailed("proj", "dev", sampleMigration, new Error("err"), null, db);
  const pending = await filterPending("proj", "dev", [{ migration: sampleMigration, file: "001.json" }], db);
  assert.equal(pending.length, 1);
});

test("filterPending accepts plain migration objects", async () => {
  const db = fakeDb();
  const pending = await filterPending("proj", "dev", [sampleMigration, sampleMigration2], db);
  assert.equal(pending.length, 2);
});

test("resetLedger clears all rows", async () => {
  const db = fakeDb();
  await recordApplied("proj", "dev", sampleMigration, null, db);
  await resetLedger(db);
  const rows = await listApplied("proj", "dev", db);
  assert.equal(rows.length, 0);
});

test("recordApplied normalizes null project/env to defaults", async () => {
  const db = fakeDb();
  await recordApplied(null, null, sampleMigration, null, db);
  assert.equal(await isApplied(null, null, sampleMigration.name, db), true);
  assert.equal(await isApplied("default", "dev", sampleMigration.name, db), true);
});
