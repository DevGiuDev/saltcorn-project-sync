const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendDeploymentRecord, findDeploymentRecord } = require("../lib/deployments");

test("deployment records get stable ids and can be found", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-deploy-"));
  const record = appendDeploymentRecord(dir, { env: "dev", status: "ok" });
  assert.equal(record.id, "deploy-000001");
  assert.equal(findDeploymentRecord(dir, "last").id, record.id);
  assert.equal(findDeploymentRecord(dir, record.id).status, "ok");
});
