const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeModel, commandAdapter } = require("../lib/tenant-adapters");

test("serializeModel supports to_json getter", () => {
  assert.deepEqual(serializeModel({ get to_json() { return { name: "x" }; } }), { name: "x" });
});

test("commandAdapter exposes async methods", async () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_EXPORT_CMD;
  process.env.SALTCORN_PROJECT_SYNC_EXPORT_CMD = "printf '{\"tables\":[]}'";
  const exported = await commandAdapter().exportProject();
  assert.deepEqual(exported, { tables: [] });
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_EXPORT_CMD;
  else process.env.SALTCORN_PROJECT_SYNC_EXPORT_CMD = old;
});

test("commandAdapter restore delegates to restore command", async () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD;
  process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD = "cat >/dev/null; printf '{\"restored\":true}'";
  const result = await commandAdapter().restore({ id: "backup" });
  assert.deepEqual(result, { restored: true });
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD;
  else process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD = old;
});
