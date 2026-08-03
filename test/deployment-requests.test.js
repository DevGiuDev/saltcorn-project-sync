const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDeploymentRequest,
  updateDeploymentRequest,
  acquireDeploymentLock,
  releaseDeploymentLock,
  deploymentLockKey,
} = require("../lib/plugin/deployment-requests");

function fakeSqlite() {
  const requests = [];
  const locks = [];
  return {
    isSQLite: true,
    async query(sql, values = []) {
      if (/^CREATE (TABLE|INDEX)/.test(sql)) return { rows: [] };
      if (/^INSERT INTO _sc_ps_deployment_requests/.test(sql)) {
        requests.push({
          request_id: values[0], project_id: values[1], environment: values[2], actor_id: values[3],
          source_ref: values[4], resolved_ref: values[5], commit_sha: values[6], desired_digest: values[7],
          actual_digest: values[8], plan_digest: values[9], operation_summary: values[10], warning_summary: values[11],
          blocker_summary: values[12], backup_policy: values[13], backup_requested: values[14] ? 1 : 0,
          allow_destructive: values[15] ? 1 : 0, status: values[16], created_at: values[17], expires_at: values[18], steps: values[19],
        });
        return { rows: [] };
      }
      if (/^SELECT \* FROM _sc_ps_deployment_requests/.test(sql)) {
        return { rows: requests.filter((row) => row.request_id === values[0]).slice(0, 1) };
      }
      if (/^UPDATE _sc_ps_deployment_requests/.test(sql)) {
        const row = requests.find((entry) => entry.request_id === values.at(-1));
        const names = [...sql.matchAll(/(?:SET|,) ([a-z_]+) = \?/g)].map((match) => match[1]);
        names.forEach((name, index) => { row[name] = values[index]; });
        return { rows: [] };
      }
      if (/^DELETE FROM _sc_ps_deployment_locks/.test(sql) && /expires_at/.test(sql)) {
        for (let i = locks.length - 1; i >= 0; i -= 1) if (locks[i].lock_key === values[0] && locks[i].expires_at < values[1]) locks.splice(i, 1);
        return { rows: [] };
      }
      if (/^INSERT INTO _sc_ps_deployment_locks/.test(sql)) {
        if (locks.some((lock) => lock.lock_key === values[0])) throw new Error("unique constraint");
        locks.push({ lock_key: values[0], request_id: values[1], acquired_at: values[2], expires_at: values[3] });
        return { rows: [] };
      }
      if (/^DELETE FROM _sc_ps_deployment_locks/.test(sql)) {
        const index = locks.findIndex((lock) => lock.lock_key === values[0] && lock.request_id === values[1]);
        if (index >= 0) locks.splice(index, 1);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("deployment requests preserve immutable preview identity and explicit destructive confirmation", async () => {
  const db = fakeSqlite();
  const digest = "a".repeat(64);
  const request = await createDeploymentRequest({
    request_id: "ui-12345678", project_id: 3, environment: "dev", source_ref: "develop", commit_sha: "b".repeat(40),
    desired_digest: digest, actual_digest: digest, plan_digest: digest,
    operation_summary: { count: 1, destructive: 1 }, backup_policy: "optional",
  }, db);
  assert.equal(request.status, "previewed");
  assert.equal(request.allow_destructive, false);
  assert.deepEqual(request.operation_summary, { count: 1, destructive: 1 });

  const confirmed = await updateDeploymentRequest(request.request_id, { status: "confirmed", allow_destructive: true }, db);
  assert.equal(confirmed.allow_destructive, true);
  assert.equal(confirmed.desired_digest, digest);
});

test("target deployment lock excludes concurrent request IDs and can be released", async () => {
  const db = fakeSqlite();
  const key = deploymentLockKey("buyapp", "dev");
  assert.equal(key, "deploy:buyapp:dev");
  assert.equal(await acquireDeploymentLock(key, "ui-first-request", 60_000, db), true);
  assert.equal(await acquireDeploymentLock(key, "cli-second-request", 60_000, db), false);
  await releaseDeploymentLock(key, "ui-first-request", db);
  assert.equal(await acquireDeploymentLock(key, "cli-second-request", 60_000, db), true);
});

test("deployment request errors redact credentials", async () => {
  const db = fakeSqlite();
  const digest = "c".repeat(64);
  const request = await createDeploymentRequest({
    request_id: "ui-87654321", project_id: 3, environment: "dev", source_ref: "main", commit_sha: "d".repeat(40),
    desired_digest: digest, actual_digest: digest, plan_digest: digest,
  }, db);
  const failed = await updateDeploymentRequest(request.request_id, {
    status: "apply_failed",
    error: "https://user:pass@example.test authorization: Bearer-value token=abc123",
  }, db);
  assert.doesNotMatch(failed.error, /user:pass|abc123|Bearer-value/);
  assert.match(failed.error, /\[redacted\]/);
});
