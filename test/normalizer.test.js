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
  const out = normalizePack({ plugins: [{ name: "x", api_key: "secret-value", bearer_auth: "bearer-value" }] });
  assert.equal(out.plugins[0].api_key, "__REDACTED__");
  assert.equal(out.plugins[0].bearer_auth, "__REDACTED__");
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
  assert.equal(out.views[0].configuration, undefined);
});

test("normalizePack resolves tenant-local ids to stable names before stripping", () => {
  const out = normalizePack({
    tables: [{ id: 10, name: "invoices", fields: [{ id: 20, name: "customer" }] }],
    views: [{ id: 30, name: "invoice_list", table_id: 10, configuration: { field_id: 20 } }],
    triggers: [{ name: "notify", table_id: 10, view_id: 30 }],
  });
  assert.equal(out.views[0].table_name, "invoices");
  assert.equal(out.views[0].configuration.field_name, "customer");
  assert.equal(out.triggers[0].table_name, "invoices");
  assert.equal(out.triggers[0].view_name, "invoice_list");
});

test("normalizePack removes derived primary-key uniqueness and null field descriptions", () => {
  const out = normalizePack({
    tables: [{ name: "countries", fields: [
      { name: "id", type: "Integer", primary_key: true, is_unique: true, description: null },
      { name: "code", type: "String", is_unique: true, description: null },
    ] }],
  });
  assert.deepEqual(out.tables[0].fields, [
    { is_unique: true, name: "code", type: "String" },
    { name: "id", primary_key: true, type: "Integer" },
  ]);
});

test("normalizePack removes noisy generated metadata and empty defaults", () => {
  const out = normalizePack({
    pages: [{ name: "home", created_by: "alice", updated_by_user_id: 42, attributes: {}, configuration: {}, updated_at: "now" }],
  });
  assert.deepEqual(out.pages[0], { name: "home" });
});

test("normalizePack accepts object-shaped menu and settings", () => {
  const out = normalizePack({
    menu: { items: [{ label: "Home", page_id: 1 }] },
    settings: { site_name: "Demo", theme: { value: "dark" } },
    pages: [{ id: 1, name: "home" }],
  });
  assert.equal(out.menu[0].name, "main");
  assert.equal(out.menu[0].items[0].page_name, "home");
  assert.deepEqual(out.settings, [
    { key: "site_name", name: "site_name", value: "Demo" },
    { key: "theme", name: "theme", value: "dark" },
  ]);
});

test("normalizePack names roles by role value instead of local id", () => {
  const out = normalizePack({ roles: [{ id: 1, role: "admin" }] });
  assert.equal(out.roles[0].name, "admin");
  assert.equal(out.roles[0].role, "admin");
});
