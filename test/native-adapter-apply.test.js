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

function fakeModels({ table, views = [], pages = [], triggers = [], roles = [], menu = [], settings = [], plugins = [], pluginSupportsInstaller = true } = {}) {
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
    Plugin: mockPluginModel(plugins, pluginSupportsInstaller),
    Menu: namedModel(menu),
    Setting: namedModel(settings),
  };
}

/**
 * Build a mock Plugin model that mirrors the real Saltcorn Plugin class shape:
 * static findOne/find + static loadAndSaveNewPlugin, instance upsert/delete.
 * When pluginSupportsInstaller is false, loadAndSaveNewPlugin is omitted so
 * the adapter must fall back to instance.upsert().
 */
function mockPluginModel(existing = [], supportsInstaller = true) {
  // Coerce seed rows into MockPlugin instances so they carry instance methods
  // (upsert/delete). Declared after the class below; seeded in a second pass.
  let store;
  class MockPlugin {
    constructor(o = {}) {
      this.id = o.id;
      this.name = o.name;
      this.source = o.source;
      this.location = o.location;
      this.version = o.version;
      this.configuration = o.configuration;
    }
    async upsert() {
      if (this.id === undefined) {
        this.id = store.length + 1;
        store.push(this);
      } else {
        const idx = store.findIndex((p) => p.id === this.id);
        if (idx >= 0) store[idx] = this;
      }
    }
    async delete() {
      const idx = store.findIndex((p) => p.id === this.id);
      if (idx >= 0) store.splice(idx, 1);
    }
    static async findOne(query) {
      const name = typeof query === "string" ? query : query && query.name;
      return store.find((p) => p.name === name) || null;
    }
    static async find() { return store.slice(); }
  }
  if (supportsInstaller) {
    MockPlugin.loadAndSaveNewPlugin = async function (plugin, force) {
      // Simulate the real installer: persist + "register" (no-op in test).
      const existingIdx = store.findIndex((p) => p.name === plugin.name);
      if (existingIdx >= 0) { plugin.id = store[existingIdx].id; store[existingIdx] = plugin; }
      else { plugin.id = store.length + 1; store.push(plugin); }
      MockPlugin._lastForce = force;
      return [];
    };
  }
  // Seed store now that MockPlugin exists, so seed rows carry instance methods.
  store = existing.map((row) => new MockPlugin(row));
  return MockPlugin;
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

// ─── raw_sql transaccional ───────────────────────────────────

function dbMock({ queries = [] } = {}) {
  const calls = [];
  return {
    calls,
    isSQLite: false,
    getTenantSchema: () => "public",
    select: async () => [],
    async query(sql) {
      calls.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      // Simulate a failure for a specific SQL marker
      if (queries.includes(sql)) throw new Error(`mock failure for: ${sql.slice(0, 30)}`);
      return { rows: [] };
    },
  };
}

test("native adapter executes raw_sql in a transaction", async () => {
  const db = dbMock();
  const models = fakeModels();
  models.Db = db;
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [{ action: "raw_sql", sql: "CREATE INDEX idx_status ON invoices(status)" }] },
  });
  assert.equal(result.applied.length, 1);
  assert.deepEqual(db.calls, ["BEGIN", "CREATE INDEX idx_status ON invoices(status)", "COMMIT"]);
  assert.equal(result.skipped.length, 0);
});

test("native adapter rolls back raw_sql on failure", async () => {
  const failingSql = "UPDATE broken SET x = 1";
  const db = dbMock({ queries: [failingSql] });
  const models = fakeModels();
  models.Db = db;
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [{ action: "raw_sql", sql: failingSql }] },
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /rolled back/);
  // Ensure ROLLBACK was issued
  assert.ok(db.calls.includes("ROLLBACK"));
});

test("native adapter skips raw_sql when db.query is unavailable", async () => {
  const models = fakeModels();
  // No Db on models, and optionalRequireOrNull will not find @saltcorn/data in test env
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [{ action: "raw_sql", sql: "SELECT 1" }] },
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /requires db\.query/);
});

test("native adapter executes multiple raw_sql statements sequentially", async () => {
  const db = dbMock();
  const models = fakeModels();
  models.Db = db;
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [
      { action: "raw_sql", sql: "CREATE INDEX a ON t(x)" },
      { action: "raw_sql", sql: "CREATE INDEX b ON t(y)" },
    ] },
  });
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.ok(db.calls.includes("CREATE INDEX a ON t(x)"));
  assert.ok(db.calls.includes("CREATE INDEX b ON t(y)"));
});

// ─── plugin install / update ──────────────────────────────────

test("native adapter installs a fresh plugin via loadAndSaveNewPlugin", async () => {
  const models = fakeModels();
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: { plugins: [{ name: "json", source: "npm", version: "0.4.6" }] },
    plan: { operations: [{ action: "install_plugin", plugin: "json", version: "0.4.6", safe: true }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  // Plugin was registered via the installer
  const installed = await models.Plugin.findOne({ name: "json" });
  assert.ok(installed, "plugin row should exist after install");
});

test("native adapter updates an existing plugin forcing reinstall", async () => {
  const models = fakeModels({ plugins: [{ name: "saltcorn-project-sync", source: "npm", version: "0.6.0" }] });
  const Plugin = models.Plugin;
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: { plugins: [{ name: "saltcorn-project-sync", source: "npm", version: "0.6.1" }] },
    plan: { operations: [{ action: "update_plugin", plugin: "saltcorn-project-sync", version: "0.6.1", safe: true }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  // update_plugin must force the reinstall (loadAndSaveNewPlugin called with force=true)
  assert.equal(Plugin._lastForce, true);
  const after = await Plugin.findOne({ name: "saltcorn-project-sync" });
  assert.equal(after.version, "0.6.1");
});

test("native adapter falls back to upsert when loadAndSaveNewPlugin is unavailable", async () => {
  // Old Saltcorn build: no loadAndSaveNewPlugin on the model.
  const models = fakeModels({ pluginSupportsInstaller: false });
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: { plugins: [{ name: "json", source: "npm", version: "0.4.6" }] },
    plan: { operations: [{ action: "install_plugin", plugin: "json", version: "0.4.6", safe: true }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  const installed = await models.Plugin.findOne({ name: "json" });
  assert.ok(installed, "plugin row persisted via upsert fallback");
  assert.equal(installed.version, "0.4.6");
});

test("native adapter skips plugin install when no install API is available", async () => {
  // Plugin model reduced to a plain object with only find — simulates a model
  // that exposes neither the installer nor instance persistence.
  const models = fakeModels();
  models.Plugin = { find: async () => [] };
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: { plugins: [{ name: "json", source: "npm", version: "0.4.6" }] },
    plan: { operations: [{ action: "install_plugin", plugin: "json", version: "0.4.6", safe: true }] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /loadAndSaveNewPlugin|upsert/);
});

test("native adapter drops a plugin via instance.delete()", async () => {
  const models = fakeModels({ plugins: [{ name: "legacy", source: "local", version: "1.0.0", id: 5 }] });
  const adapter = nativeSaltcornAdapter(models);
  const result = await adapter.applyPlan({
    desired: {},
    plan: { operations: [{ action: "drop_plugin", plugin: "legacy", safe: false }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  const gone = await models.Plugin.findOne({ name: "legacy" });
  assert.equal(gone, null);
});
