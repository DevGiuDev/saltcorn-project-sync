const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeDeploymentRecord,
  writeDeploymentRecord,
  listDeploymentRecords,
  getDeploymentRecord,
} = require("../lib/plugin/deployment-ledger");
const { deploymentsTable } = require("../lib/plugin/renderers/deployments");

function fakeDb() {
  const rows = [];
  return {
    isSQLite: false,
    getTenantSchema: () => "public",
    rows,
    async query(sql, values = []) {
      if (/^(CREATE TABLE|CREATE INDEX)/.test(sql)) return { rows: [] };
      if (/^SELECT \*/.test(sql) && /WHERE "request_id"/.test(sql)) {
        return { rows: rows.filter((row) => row.request_id === values[0]).slice(0, 1) };
      }
      if (/^SELECT \*/.test(sql) && /WHERE "deployment_id"/.test(sql)) {
        return { rows: rows.filter((row) => row.deployment_id === values[0]).slice(0, 1) };
      }
      if (/^SELECT \*/.test(sql) && /ORDER BY recorded_at/.test(sql)) {
        return { rows: [...rows].reverse() };
      }
      if (/^INSERT INTO/.test(sql)) {
        if (rows.some((row) => row.request_id === values[1] || row.deployment_id === values[0])) {
          throw new Error("unique constraint");
        }
        const json = (value) => value === null ? null : JSON.parse(value);
        rows.push({
          id: rows.length + 1,
          deployment_id: values[0],
          request_id: values[1],
          kind: values[2],
          project: values[3],
          version: values[4],
          commit_sha: values[5],
          environment: values[6],
          status: values[7],
          operation_count: values[8],
          warning_count: values[9],
          operation_summary: json(values[10]),
          warning_summary: json(values[11]),
          backup: json(values[12]),
          convergence: json(values[13]),
          error: values[14],
          rollback_of: values[15],
          recorded_at: values[16] || "2026-08-02T18:04:12.000Z",
          record_hash: values[17],
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function validRecord(overrides = {}) {
  return {
    request_id: "buyapp-test-deploy-000001",
    deployment_id: "deploy-000001",
    project: "buyapp",
    version: "0.1.1",
    commit: "a7f0096123456789",
    env: "test",
    status: "verified",
    operations: { count: 1, by_action: { create_field: 1 } },
    warnings: 1,
    backup: {
      ok: true,
      id: "buyapp-test-20260802T180412Z",
      sha256: "412f0ee341016207bbe9a94a111f11ce69c6a28a1f4e96b87eddd8a0d84a6cd3",
      ignored_secret: "do-not-store",
    },
    convergence: { ok: true, operations: 0, warnings: 1 },
    ...overrides,
  };
}

test("deployment ledger sanitizes receipts and errors", () => {
  const record = sanitizeDeploymentRecord(validRecord({
    error: "https://user:secret@example.test Authorization: Bearer-value token=abc123",
  }));
  assert.equal(record.operation_count, 1);
  assert.equal(record.warning_count, 1);
  assert.equal(record.backup.ignored_secret, undefined);
  assert.doesNotMatch(record.error, /user:secret|abc123/);
  assert.match(record.error, /\[redacted\]/);
});

test("deployment ledger writes are idempotent by request id", async () => {
  const db = fakeDb();
  const first = await writeDeploymentRecord(validRecord(), db);
  const retry = await writeDeploymentRecord(validRecord(), db);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(db.rows.length, 1);
  assert.equal(retry.record.deployment_id, "deploy-000001");

  const listed = await listDeploymentRecords({ environment: "test" }, db);
  assert.equal(listed.length, 1);
  const found = await getDeploymentRecord("deploy-000001", db);
  assert.equal(found.backup.id, "buyapp-test-20260802T180412Z");
});

test("deployment ledger rejects a reused request id with different data", async () => {
  const db = fakeDb();
  await writeDeploymentRecord(validRecord(), db);
  await assert.rejects(
    () => writeDeploymentRecord(validRecord({ status: "failed" }), db),
    (error) => error.code === "DEPLOYMENT_REQUEST_CONFLICT" && error.statusCode === 409
  );
});

test("deployment table renders target backup and convergence details", () => {
  const record = sanitizeDeploymentRecord(validRecord());
  const html = deploymentsTable([{ ...record, recorded_at: "2026-08-02T18:04:12Z" }], { source: "target" });
  assert.match(html, /Authoritative target-side/);
  assert.match(html, /deploy-000001/);
  assert.match(html, /buyapp-test-20260802T180412Z/);
  assert.match(html, /Converged/);
});
