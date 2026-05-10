const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePack } = require("../lib/normalizer");

test("normalizePack extracts tables and strips tenant-local numeric ids", () => {
  const out = normalizePack({ tables: [{ id: 42, name: "invoices", fields: [{ id: 1, name: "total" }] }] });
  assert.equal(out.tables[0].name, "invoices");
  assert.equal(out.tables[0].id, undefined);
  assert.equal(out.tables[0].fields[0].id, undefined);
});

test("normalizePack redacts likely secrets", () => {
  const out = normalizePack({ plugins: [{ name: "x", api_key: "secret-value" }] });
  assert.equal(out.plugins[0].api_key, "__REDACTED__");
});

test("normalizePack includes menu and settings", () => {
  const out = normalizePack({ menu: [{ name: "main" }], settings: [{ name: "site" }] });
  assert.equal(out.menu[0].name, "main");
  assert.equal(out.settings[0].name, "site");
});

test("normalizePack strips nested numeric tenant-local ids and volatile timestamps", () => {
  const out = normalizePack({ views: [{ id: 2, name: "v", table_id: 3, updated_at: "now", configuration: { field_id: 9 } }] });
  assert.equal(out.views[0].id, undefined);
  assert.equal(out.views[0].table_id, undefined);
  assert.equal(out.views[0].updated_at, undefined);
  assert.equal(out.views[0].configuration.field_id, undefined);
});
