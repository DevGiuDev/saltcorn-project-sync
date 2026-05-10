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
