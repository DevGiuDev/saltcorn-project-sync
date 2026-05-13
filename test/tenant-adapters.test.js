const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeModel, commandAdapter, capabilityReport } = require("../lib/tenant-adapters");

test("serializeModel supports to_json getter", () => {
  assert.deepEqual(serializeModel({ get to_json() { return { name: "x" }; } }), { name: "x" });
});

test("capabilityReport includes all tracked Saltcorn resource classes", () => {
  const report = capabilityReport({ adapter: "x", resources: { tables: { export: true } } });
  assert.equal(report.adapter, "x");
  for (const name of ["tables", "fields", "views", "pages", "triggers", "roles", "plugins", "settings", "menu", "reference_data"]) {
    assert.ok(report.resources[name]);
  }
  assert.equal(report.resources.tables.export, true);
  assert.equal(report.resources.views.export, false);
});

test("commandAdapter info includes configured Saltcorn version and capabilities", async () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION;
  process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION = "1.5.7";
  const info = await commandAdapter().info();
  assert.equal(info.saltcorn_version, "1.5.7");
  assert.equal(info.capabilities.resources.tables.export, true);
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION;
  else process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION = old;
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
