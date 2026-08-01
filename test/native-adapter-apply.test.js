const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeSaltcornAdapter, methodUnavailableReason } = require("../lib/tenant-adapters");

function namedModel(items = []) {
  return {
    items,
    find: async () => items,
    findOne: (query) => {
      const name = typeof query === "string" ? query : query && query.name;
      return items.find((item) => item.name === name) || null;
    },
    create: async (item) => items.push(item),
  };
}

function fakeModels({ table, views = [], pages = [], triggers = [], roles = [], menu = [], settings = [] } = {}) {
  return {
    Table: {
      find: async () => (table ? [table] : []),
      findOne: (query) => {
        const name = typeof query === "string" ? query : query && query.name;
        return table && table.name === name ? table : null;
      },
      create: async () => {},
      update: async () => {},
    },
    Field: { create: async () => {} },
    View: namedModel(views),
    Page: namedModel(pages),
    Trigger: namedModel(triggers),
    Role: namedModel(roles),
    Plugin: { find: async () => [] },
    Menu: namedModel(menu),
    Setting: namedModel(settings),
  };
}

test("native adapter applies rename_field with model update", async () => {
  const updates = [];
  const table = { name: "invoices", fields: [{ name: "old_status", update: async (patch) => updates.push(patch) }] };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  const result = await adapter.applyPlan({ desired: {}, plan: { operations: [{ action: "rename_field", table: "invoices", from: "old_status", to: "status" }] } });
  assert.equal(result.ok, true);
  assert.deepEqual(updates, [{ name: "status", label: "status" }]);
});

test("native adapter applies alter_field_type as field update", async () => {
  const updates = [];
  const table = { name: "invoices", id: 7, fields: [{ name: "total", type: "Float", update: async (patch) => updates.push(patch) }] };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  const desired = { tables: [{ name: "invoices", fields: [{ name: "total", type: "Integer" }] }] };
  const result = await adapter.applyPlan({ desired, plan: { operations: [{ action: "alter_field_type", table: "invoices", field: "total" }] } });
  assert.equal(result.ok, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, "total");
  assert.equal(updates[0].type, "Integer");
  assert.equal(updates[0].table_id, 7);
});

test("native adapter copies field data through table row APIs", async () => {
  const rowUpdates = [];
  const table = {
    name: "invoices",
    fields: [],
    getRows: async () => [{ id: 1, old_status: "paid" }, { id: 2, old_status: "draft", status: "draft" }],
    updateRow: async (patch, id) => rowUpdates.push({ id, patch }),
  };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  const result = await adapter.applyPlan({ desired: {}, plan: { operations: [{ action: "copy_field_data", table: "invoices", from: "old_status", to: "status" }] } });
  assert.equal(result.ok, true);
  assert.deepEqual(rowUpdates, [{ id: 1, patch: { status: "paid" } }]);
  assert.equal(result.applied[0].rows, 2);
});

test("native adapter upserts reference rows through table row APIs", async () => {
  const updates = [];
  const inserts = [];
  const rows = [{ id: 1, code: "US", name: "Old" }];
  const table = {
    name: "countries",
    fields: [],
    getRows: async (filter) => rows.filter((row) => row.code === filter.code),
    updateRow: async (row, id) => updates.push({ id, row }),
    insertRow: async (row) => inserts.push(row),
  };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [
      { action: "upsert_reference_row", table: "countries", key: "code", row: { code: "US", name: "United States" } },
      { action: "upsert_reference_row", table: "countries", key: "code", row: { code: "CA", name: "Canada" } },
    ] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(updates, [{ id: 1, row: { code: "US", name: "United States" } }]);
  assert.deepEqual(inserts, [{ code: "CA", name: "Canada" }]);
});

test("native adapter applies generic views/triggers/roles/menu/settings", async () => {
  const updates = [];
  const models = fakeModels({
    views: [{ name: "v1", update: async (patch) => updates.push(["view", patch]) }],
    triggers: [{ name: "tr1", update: async (patch) => updates.push(["trigger", patch]) }],
    roles: [{ name: "admin", update: async (patch) => updates.push(["role", patch]) }],
    menu: [{ name: "main", update: async (patch) => updates.push(["menu", patch]) }],
    settings: [{ name: "site_name", update: async (patch) => updates.push(["setting", patch]) }],
  });
  const adapter = nativeSaltcornAdapter(models);
  const desired = {
    views: [{ name: "v1", configuration: { mode: "list" } }],
    triggers: [{ name: "tr1", when: "Never" }],
    roles: [{ name: "admin", description: "Admin" }],
    menu: [{ name: "main", items: [] }],
    settings: [{ name: "site_name", value: "Demo" }],
  };
  const result = await adapter.applyPlan({
    desired,
    plan: { operations: [
      { action: "update_view", view: "v1" },
      { action: "update_trigger", trigger: "tr1" },
      { action: "update_role", role: "admin" },
      { action: "update_menu", menu: "main" },
      { action: "update_setting", setting: "site_name" },
    ] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(updates.map(([kind]) => kind), ["view", "trigger", "role", "menu", "setting"]);
});

test("native adapter marks partial applies as failed", async () => {
  const table = { name: "invoices", fields: [{ name: "legacy" }] };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [{ action: "drop_field", table: "invoices", field: "legacy" }] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /delete method unavailable/);
});

test("native adapter reads and writes stable _sc_config settings", async () => {
  const inserts = [];
  const updates = [];
  const configRows = [{ key: "site_name", value: { v: "Old" } }];
  const models = fakeModels();
  models.Db = {
    select: async (table, where = {}) => {
      if (table === "_sc_fields") return [];
      if (table !== "_sc_config") return [];
      if (where.key) return configRows.filter((row) => row.key === where.key);
      return configRows;
    },
    update: async (...args) => updates.push(args),
    insert: async (...args) => inserts.push(args),
  };
  const adapter = nativeSaltcornAdapter(models);
  const exported = await adapter.exportProject();
  assert.deepEqual(exported.settings, [{ name: "site_name", key: "site_name", value: "Old" }]);

  const updated = await adapter.applyPlan({
    desired: { settings: [{ name: "site_name", key: "site_name", value: "New" }] },
    plan: { operations: [{ action: "update_setting", setting: "site_name" }] },
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(updates, [["_sc_config", { value: JSON.stringify({ v: "New" }) }, { key: "site_name" }]]);

  const created = await adapter.applyPlan({
    desired: { settings: [{ name: "new_setting", key: "new_setting", value: true }] },
    plan: { operations: [{ action: "create_setting", setting: "new_setting" }] },
  });
  assert.equal(created.ok, true);
  assert.deepEqual(inserts, [["_sc_config", { key: "new_setting", value: JSON.stringify({ v: true }) }, { pk_name: "key" }]]);
});

test("native adapter exports requested reference-table rows", async () => {
  const table = { name: "countries", fields: [], getRows: async () => [{ id: 1, code: "ES", name: "Spain" }] };
  const exported = await nativeSaltcornAdapter(fakeModels({ table })).exportProject({ referenceTables: [{ table: "countries" }] });
  assert.deepEqual(exported.reference_data, { countries: [{ id: 1, code: "ES", name: "Spain" }] });
});

test("native adapter exports menu as empty when no db available", async () => {
  const exported = await nativeSaltcornAdapter(fakeModels({ menu: [{ name: "main" }], settings: [{ name: "site_name" }] })).exportProject();
  // Menu is read from _sc_config, not from Menu model. Without a real DB, menu is empty.
  assert.deepEqual(exported.menu, []);
  assert.deepEqual(exported.settings, [{ name: "site_name" }]);
});

test("native adapter reports clearer unavailable method errors", async () => {
  assert.match(methodUnavailableReason("field", "rename", ["field.update"]), /expected one of: field\.update/);
  const table = { name: "invoices", fields: [{ name: "old_status" }] };
  const adapter = nativeSaltcornAdapter(fakeModels({ table }));
  await assert.rejects(
    adapter.applyPlan({ desired: {}, plan: { operations: [{ action: "rename_field", table: "invoices", from: "old_status", to: "status" }] } }),
    /field rename method unavailable.*field\.update/
  );
});
