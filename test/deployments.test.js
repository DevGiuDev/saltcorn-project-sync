const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendDeploymentRecord, appendRollbackRecord, findDeploymentRecord } = require("../lib/deployments");

test("deployment records get stable ids and can be found", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-deploy-"));
  const record = appendDeploymentRecord(dir, { env: "dev", status: "ok" });
  assert.equal(record.id, "deploy-000001");
  assert.equal(record.kind, "deployment");
  assert.equal(findDeploymentRecord(dir, "last").id, record.id);
  assert.equal(findDeploymentRecord(dir, record.id).status, "ok");
});

test("rollback records are distinct from deployment records", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-rollback-"));
  const deploy = appendDeploymentRecord(dir, { env: "prod", status: "applied-live" });
  const rollback = appendRollbackRecord(dir, { env: "prod", status: "restored-live", rollback_of: deploy.id });
  const deploy2 = appendDeploymentRecord(dir, { env: "prod", status: "applied-live" });
  assert.equal(rollback.id, "rollback-000001");
  assert.equal(rollback.kind, "rollback");
  assert.equal(rollback.rollback_of, deploy.id);
  assert.equal(deploy2.id, "deploy-000002");
});
