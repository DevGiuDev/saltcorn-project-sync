const { execFileSync, spawnSync } = require("node:child_process");
const { parseJson } = require("./canonical-json");

function requireCommand(name) {
  const cmd = process.env[name];
  if (!cmd) throw new Error(`${name} is required for command tenant adapter`);
  return cmd;
}

function runShellJson(command, input = null) {
  const result = spawnSync(command, {
    shell: true,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with ${result.status}`);
  }
  return result.stdout ? parseJson(result.stdout, command) : null;
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== "function") throw new Error("global fetch is required for rest adapter (Node >=18)");
  const res = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(process.env.SALTCORN_PROJECT_SYNC_API_TOKEN
        ? { authorization: `Bearer ${process.env.SALTCORN_PROJECT_SYNC_API_TOKEN}` }
        : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} returned ${res.status}: ${text}`);
  return text ? parseJson(text, url) : null;
}

function endpoint(name, fallbackPath) {
  const explicit = process.env[`SALTCORN_PROJECT_SYNC_${name}_URL`];
  if (explicit) return explicit;
  const base = process.env.SALTCORN_PROJECT_SYNC_BASE_URL || process.env.SALTCORN_BASE_URL;
  if (!base) throw new Error(`SALTCORN_PROJECT_SYNC_${name}_URL or SALTCORN_PROJECT_SYNC_BASE_URL is required for rest adapter`);
  return `${base.replace(/\/$/, "")}${fallbackPath}`;
}

function capabilityReport({ adapter, methods = {}, resources = {}, notes = [] } = {}) {
  const resourceNames = ["tables", "fields", "views", "pages", "triggers", "roles", "plugins", "settings", "menu", "reference_data"];
  return {
    adapter: adapter || "unknown",
    resources: resourceNames.reduce((acc, name) => {
      acc[name] = {
        export: Boolean(resources[name]?.export),
        apply: Boolean(resources[name]?.apply),
        destructive: Boolean(resources[name]?.destructive),
      };
      return acc;
    }, {}),
    methods: {
      info: Boolean(methods.info),
      exportProject: Boolean(methods.exportProject),
      applyPlan: Boolean(methods.applyPlan),
      applyProject: Boolean(methods.applyProject),
      backup: Boolean(methods.backup),
      restore: Boolean(methods.restore),
    },
    notes,
  };
}

function mergeInfoCapabilities(info, capabilities) {
  return { ...(info || {}), capabilities: (info && info.capabilities) || capabilities };
}

function restAdapter() {
  const capabilities = capabilityReport({
    adapter: "rest",
    methods: { info: true, exportProject: true, applyPlan: true, applyProject: true, backup: true, restore: true },
    resources: {
      tables: { export: true, apply: true, destructive: true },
      fields: { export: true, apply: true, destructive: true },
      views: { export: true, apply: true },
      pages: { export: true, apply: true },
      triggers: { export: true, apply: true },
      roles: { export: true, apply: true },
      plugins: { export: true, apply: true },
      settings: { export: true, apply: true },
      menu: { export: true, apply: true },
      reference_data: { export: true, apply: true },
    },
    notes: ["REST capabilities depend on the remote project-sync plugin version."],
  });
  return {
    name: "rest",
    capabilities,
    async info() {
      return mergeInfoCapabilities(await fetchJson(endpoint("INFO", "/project-sync/api/info")), capabilities);
    },
    async exportProject() {
      return fetchJson(endpoint("EXPORT", "/project-sync/api/export"));
    },
    async applyPlan(payload) {
      return fetchJson(endpoint("APPLY", "/project-sync/api/apply"), { method: "POST", body: JSON.stringify(payload) }) || { ok: true };
    },
    async applyProject(state) {
      return fetchJson(endpoint("APPLY", "/project-sync/api/apply"), { method: "POST", body: JSON.stringify({ state }) }) || { ok: true };
    },
    async backup() {
      return fetchJson(endpoint("BACKUP", "/project-sync/api/backup"), { method: "POST", body: "{}" }) || { ok: true };
    },
    async restore(backup) {
      return fetchJson(endpoint("RESTORE", "/project-sync/api/restore"), { method: "POST", body: JSON.stringify(backup) }) || { ok: true };
    },
    async resetSchema() {
      return fetchJson(endpoint("RESET", "/project-sync/api/reset-schema"), { method: "POST", body: "{}" }) || { ok: true };
    },
    async installPlugin(plugin) {
      return fetchJson(endpoint("INSTALL_PLUGIN", "/project-sync/api/install-plugin"), { method: "POST", body: JSON.stringify(plugin) }) || { ok: true };
    },
  };
}

function commandAdapter() {
  const hasApplyCmd = Boolean(process.env.SALTCORN_PROJECT_SYNC_APPLY_CMD);
  const hasBackupCmd = Boolean(process.env.SALTCORN_PROJECT_SYNC_BACKUP_CMD);
  const hasRestoreCmd = Boolean(process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD);
  const capabilities = capabilityReport({
    adapter: "command",
    methods: { info: true, exportProject: true, applyProject: hasApplyCmd, backup: true, restore: hasRestoreCmd },
    resources: {
      tables: { export: true, apply: hasApplyCmd },
      fields: { export: true, apply: hasApplyCmd },
      views: { export: true, apply: hasApplyCmd },
      pages: { export: true, apply: hasApplyCmd },
      triggers: { export: true, apply: hasApplyCmd },
      roles: { export: true, apply: hasApplyCmd },
      plugins: { export: true, apply: hasApplyCmd },
      settings: { export: true, apply: hasApplyCmd },
      menu: { export: true, apply: hasApplyCmd },
      reference_data: { export: true, apply: hasApplyCmd },
    },
    notes: hasBackupCmd ? [] : ["No backup command configured; test/prod apply requires a real backup hook."],
  });
  return {
    name: "command",
    capabilities,
    async info() {
      return {
        adapter: "command",
        saltcorn_version: process.env.SALTCORN_VERSION || process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION || null,
        capabilities,
      };
    },
    async exportProject() {
      return runShellJson(requireCommand("SALTCORN_PROJECT_SYNC_EXPORT_CMD"));
    },
    async applyProject(state) {
      const cmd = requireCommand("SALTCORN_PROJECT_SYNC_APPLY_CMD");
      return runShellJson(cmd, state) || { ok: true };
    },
    async applyPlan({ desired, plan }) {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_APPLY_CMD;
      if (!cmd) return { ok: false, error: "adapter does not support applyPlan" };
      return runShellJson(cmd, { desired, plan }) || { ok: true };
    },
    async backup() {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_BACKUP_CMD;
      if (!cmd) return { ok: true, skipped: true };
      return runShellJson(cmd) || { ok: true };
    },
    async restore(backup) {
      const cmd = requireCommand("SALTCORN_PROJECT_SYNC_RESTORE_CMD");
      return runShellJson(cmd, backup) || { ok: true };
    },
    async resetSchema() {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD;
      if (!cmd) return { ok: true, skipped: true, reason: "No SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD configured" };
      return runShellJson(cmd) || { ok: true };
    },
    async installPlugin(plugin) {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_INSTALL_PLUGIN_CMD;
      if (!cmd) return { ok: true, skipped: true, reason: "No SALTCORN_PROJECT_SYNC_INSTALL_PLUGIN_CMD configured" };
      return runShellJson(cmd, plugin) || { ok: true };
    },
  };
}

function optionalRequire(candidates) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      return mod.default || mod;
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  const err = new Error(`Unable to load Saltcorn module. Tried:\n${errors.join("\n")}`);
  err.code = "SALTCORN_MODULE_NOT_FOUND";
  throw err;
}

function optionalRequireOrNull(candidates) {
  try {
    return optionalRequire(candidates);
  } catch (_err) {
    return null;
  }
}

function loadSaltcornModels() {
  return {
    Table: optionalRequire(["@saltcorn/data/models/table", "@saltcorn/data/dist/models/table"]),
    Field: optionalRequire(["@saltcorn/data/models/field", "@saltcorn/data/dist/models/field"]),
    View: optionalRequire(["@saltcorn/data/models/view", "@saltcorn/data/dist/models/view"]),
    Page: optionalRequire(["@saltcorn/data/models/page", "@saltcorn/data/dist/models/page"]),
    Trigger: optionalRequire(["@saltcorn/data/models/trigger", "@saltcorn/data/dist/models/trigger"]),
    Role: optionalRequire(["@saltcorn/data/models/role", "@saltcorn/data/dist/models/role"]),
    Plugin: optionalRequire(["@saltcorn/data/models/plugin", "@saltcorn/data/dist/models/plugin"]),
    Menu: optionalRequireOrNull(["@saltcorn/data/models/menu", "@saltcorn/data/dist/models/menu"]),
    Setting: optionalRequireOrNull(["@saltcorn/data/models/setting", "@saltcorn/data/dist/models/setting", "@saltcorn/data/models/config", "@saltcorn/data/dist/models/config"]),
  };
}

function serializeModel(model) {
  if (!model) return model;
  if (model.to_json) return typeof model.to_json === "function" ? model.to_json() : model.to_json;
  if (model.toJson) return typeof model.toJson === "function" ? model.toJson() : model.toJson;
  if (model.toJSON) return model.toJSON();
  return { ...model };
}

async function findAll(Model) {
  if (!Model || typeof Model.find !== "function") return [];
  const rows = await Model.find({});
  return (rows || []).map(serializeModel);
}

function findField(table, name) {
  return (table.fields || []).find((field) => field.name === name);
}

function modelHas(Model, method) {
  return Boolean(Model && typeof Model[method] === "function");
}

async function findOneByName(Model, name) {
  if (!Model || typeof Model.findOne !== "function") return null;
  for (const query of [{ name }, name]) {
    try {
      const found = await Promise.resolve(Model.findOne(query));
      if (found) return found;
    } catch (_err) {
      // Saltcorn versions differ: some accept a string, others an object.
    }
  }
  return null;
}

function methodUnavailableReason(resource, action, methods = []) {
  return `${resource} ${action} method unavailable in installed Saltcorn model; expected one of: ${methods.join(", ")}`;
}

function nativeSaltcornAdapter(models = loadSaltcornModels()) {
  const capabilities = capabilityReport({
    adapter: "saltcorn-native",
    methods: { info: true, exportProject: true, applyPlan: true, backup: true, restore: Boolean(process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD) },
    resources: {
      tables: { export: modelHas(models.Table, "find"), apply: modelHas(models.Table, "create"), destructive: false },
      fields: { export: modelHas(models.Table, "find"), apply: modelHas(models.Field, "create"), destructive: true },
      views: { export: modelHas(models.View, "find"), apply: modelHas(models.View, "create") || modelHas(models.View, "update") },
      pages: { export: modelHas(models.Page, "find"), apply: modelHas(models.Page, "create") || modelHas(models.Page, "update") },
      triggers: { export: modelHas(models.Trigger, "find"), apply: modelHas(models.Trigger, "create") || modelHas(models.Trigger, "update") },
      roles: { export: modelHas(models.Role, "find"), apply: modelHas(models.Role, "create") || modelHas(models.Role, "update") },
      plugins: { export: modelHas(models.Plugin, "find"), apply: modelHas(models.Plugin, "create") || modelHas(models.Plugin, "update"), destructive: modelHas(models.Plugin, "delete") },
      settings: { export: modelHas(models.Setting, "find"), apply: modelHas(models.Setting, "create") || modelHas(models.Setting, "update"), destructive: modelHas(models.Setting, "delete") },
      menu: { export: modelHas(models.Menu, "find"), apply: modelHas(models.Menu, "create") || modelHas(models.Menu, "update"), destructive: modelHas(models.Menu, "delete") },
      reference_data: { export: false, apply: true },
    },
    notes: ["Native Saltcorn model APIs vary by version; unsupported operations are reported during apply."],
  });
  return {
    name: "saltcorn-native",
    capabilities,
    async info() {
      let saltcornVersion = process.env.SALTCORN_VERSION || process.env.SALTCORN_PROJECT_SYNC_SALTCORN_VERSION || null;
      for (const pkg of ["@saltcorn/data/package.json", "@saltcorn/data/dist/package.json", "@saltcorn/server/package.json", "saltcorn/package.json"]) {
        if (saltcornVersion) break;
        try {
          saltcornVersion = require(pkg).version;
        } catch (_err) {
          // Try the next known package location.
        }
      }
      return { adapter: "saltcorn-native", saltcorn_version: saltcornVersion, capabilities };
    },
    async exportProject() {
      const { Table, View, Page, Trigger, Role, Plugin, Setting } = models;
      // Refresh Saltcorn's in-memory cache before reading to ensure fresh state.
      if (Table && typeof Table.state_refresh === "function") await Table.state_refresh();
      // Menu items are stored as a _sc_config setting, not a model.
      // Read directly from DB.
      let menuItems = [];
      try {
        const db = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        if (db && typeof db.select === "function") {
          const rows = await db.select("_sc_config", { key: "menu_items" });
          if (rows.length) {
            const raw = rows[0].value;
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && Array.isArray(parsed.v)) menuItems = parsed.v;
          }
        }
      } catch (_e) { /* menu export best-effort */ }

      // Export tables. Saltcorn's Table model does not include field types
      // in its serialized output (field.type is undefined). We enrich each
      // field with its type by reading _sc_fields directly from the DB.
      const tables = await findAll(Table);
      try {
        const db = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        if (db && typeof db.select === "function") {
          const allFieldRows = await db.select("_sc_fields");
          const fieldsByTableId = new Map();
          for (const fr of allFieldRows) {
            if (!fieldsByTableId.has(fr.table_id)) fieldsByTableId.set(fr.table_id, []);
            fieldsByTableId.get(fr.table_id).push(fr);
          }
          for (const table of tables) {
            const dbFields = fieldsByTableId.get(table.id) || [];
            const dbFieldMap = new Map(dbFields.map(f => [f.name, f]));
            if (Array.isArray(table.fields)) {
              for (const field of table.fields) {
                const dbField = dbFieldMap.get(field.name);
                if (dbField) {
                  // Set type from DB if missing
                  if (field.type === undefined && dbField.type !== undefined) {
                    field.type = dbField.type;
                  }
                  // Set reftable_name from DB if missing (needed for Key fields)
                  if (field.reftable_name === undefined && dbField.reftable_name) {
                    field.reftable_name = dbField.reftable_name;
                  }
                }
              }
            }
          }
        }
      } catch (_e) { /* field enrichment best-effort */ }

      return {
        tables,
        views: await findAll(View),
        pages: await findAll(Page),
        triggers: await findAll(Trigger),
        roles: await findAll(Role),
        menu: menuItems.length ? [{ name: "menu_items", items: menuItems }] : [],
        settings: await findAll(Setting),
        plugins: await findAll(Plugin),
      };
    },
    async backup() {
      // Saltcorn snapshot APIs vary by version. Prefer an explicit command when available.
      const cmd = process.env.SALTCORN_PROJECT_SYNC_BACKUP_CMD;
      if (cmd) return runShellJson(cmd) || { ok: true };
      return {
        ok: true,
        skipped: true,
        reason: "No native snapshot hook configured; set SALTCORN_PROJECT_SYNC_BACKUP_CMD for real backups.",
      };
    },
    async restore(backup) {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_RESTORE_CMD;
      if (cmd) return runShellJson(cmd, backup) || { ok: true };
      throw new Error("No native restore hook configured; set SALTCORN_PROJECT_SYNC_RESTORE_CMD");
    },
    async applyPlan({ desired, plan }) {
      const { Table, Field, View, Page, Trigger, Role, Plugin, Menu, Setting } = models;
      // Saltcorn caches table/field metadata in getState().tables.
      // Table.create / Field.create update the DB but the in-memory cache
      // may be stale. Refresh it before iterating operations.
      if (Table && typeof Table.state_refresh === "function") await Table.state_refresh();
      const applied = [];
      const skipped = [];

      // ─── Phase 0: install/update plugins FIRST ──────────────────
      // Plugins register types (UUID, etc.) and table providers that
      // subsequent table creation depends on.
      const pluginOps = plan.operations.filter((op) => op.action === "install_plugin" || op.action === "update_plugin");
      const nonPluginOps = plan.operations.filter((op) => op.action !== "install_plugin" && op.action !== "update_plugin");

      for (const op of pluginOps) {
        const plugin = (desired.plugins || []).find((item) => item.name === op.plugin);
        if (!plugin) { skipped.push({ op, reason: `desired plugin not found: ${op.plugin}` }); continue; }
        try {
          const existing = Plugin ? await findOneByName(Plugin, plugin.name) : null;
          if (!existing && Plugin && typeof Plugin.create === "function") {
            await Plugin.create(plugin);
            if (typeof Table.state_refresh === "function") await Table.state_refresh();
            applied.push(op);
          } else if (existing && typeof existing.update === "function") {
            await existing.update(plugin);
            applied.push(op);
          } else if (existing && typeof Plugin.update === "function" && existing.id !== undefined) {
            await Plugin.update(existing.id, plugin);
            applied.push(op);
          } else {
            skipped.push({ op, reason: methodUnavailableReason("plugin", "install", ["Plugin.create", "Plugin.update"]) });
          }
        } catch (pluginErr) {
          skipped.push({ op, reason: `Plugin install failed for ${op.plugin}: ${pluginErr.message}` });
        }
      }

      // ─── Phase 1: create all tables (structure only) ────────────
      // Table.create only creates the DB table with its PK column.
      // Fields (including FK references) are created in Phase 2,
      // after all target tables exist.
      const tableOps = nonPluginOps.filter((op) => op.action === "create_table");
      const nonTableOps = nonPluginOps.filter((op) => op.action !== "create_table");

      for (const op of tableOps) {
        const table = (desired.tables || []).find((t) => t.name === op.table);
        if (!table) throw new Error(`desired table not found: ${op.table}`);
        const existing = await findOneByName(Table, op.table);
        if (!existing) {
          if (typeof Table.create !== "function") throw new Error(methodUnavailableReason("table", "create", ["Table.create"]));
          // Collapse expanded pk_type object to string — Saltcorn's pkSqlType expects a type name
          const tableArg = { ...table };
          if (tableArg.pk_type && typeof tableArg.pk_type === "object") tableArg.pk_type = tableArg.pk_type.name || tableArg.pk_type.sql_name || String(tableArg.pk_type);
          // For provider tables, omit fields to avoid pkSqlType crash when getState().types
          // hasn't loaded the base types yet. Providers don't need physical table creation.
          if (tableArg.provider_name) tableArg.fields = undefined;
          // Check that the PK type is available in Saltcorn's runtime.
          // Types like 'Key' are field-level constructs not in getState().types.
          const pkField = (table.fields||[]).find(f => f.primary_key);
          const pkTypeName = pkField?.type;
          if (pkTypeName && pkTypeName !== "Integer") {
            try {
              const stateModule = optionalRequire(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
              if (stateModule) {
                const st = stateModule.getState();
                if (!st.types[pkTypeName]) {
                  skipped.push({ op, reason: `Table ${table.name} PK type "${pkTypeName}" not available in Saltcorn runtime; likely a plugin-managed table` });
                  continue;
                }
              }
            } catch (_e) { /* proceed */ }
          }
          try {
            await Table.create(table.name, tableArg);
          } catch (createErr) {
            throw new Error(`Table.create failed for ${table.name} (pk_type=${pkTypeName || 'unknown'}, provider=${!!table.provider_name}): ${createErr.message}`);
          }
          if (typeof Table.state_refresh === "function") await Table.state_refresh();
        }
        applied.push(op);
      }

      // ─── Phase 2: create all fields for tables created in Phase 1 ─
      for (const op of tableOps) {
        const table = (desired.tables || []).find((t) => t.name === op.table);
        if (!table || !Array.isArray(table.fields)) continue;
        const created = await findOneByName(Table, op.table);
        if (!created) continue;
        for (const field of table.fields) {
          if (field.primary_key) continue; // PK already created by Table.create
          try {
            if (Field && typeof Field.create === "function") {
              const fieldDef = { ...field, table_id: created.id };
              delete fieldDef.table;
              if (field.type === "Key" && field.reftable_name && !field.reftable_id) {
                const reftable = await findOneByName(Table, field.reftable_name);
                if (reftable) fieldDef.reftable_id = reftable.id;
                else {
                  skipped.push({ op: { action: "create_field", table: op.table, field: field.name }, reason: `reftable "${field.reftable_name}" not found for Key field` });
                  continue;
                }
              }
              await Field.create(fieldDef);
            } else {
              skipped.push({ op: { action: "create_field", table: op.table, field: field.name }, reason: methodUnavailableReason("field", "create", ["Field.create"]) });
            }
          } catch (fieldErr) {
            skipped.push({ op: { action: "create_field", table: op.table, field: field.name }, reason: `Field.create failed for ${op.table}.${field.name}: ${fieldErr.message}` });
          }
        }
      }

      // ─── Phase 3: remaining operations (views, triggers, etc.) ───
      for (const op of nonTableOps) {
        if (op.action === "rename_table") {
          const table = await findOneByName(Table, op.from);
          if (!table) throw new Error(`table not found: ${op.from}`);
          if (typeof table.update === "function") await table.update({ name: op.to });
          else if (typeof Table.update === "function" && table.id !== undefined) await Table.update(table.id, { name: op.to });
          else throw new Error(`${methodUnavailableReason("table", "rename", ["table.update", "Table.update"])}: ${op.from}`);
          applied.push(op);
          continue;
        }

        if (op.action === "create_field" || op.action === "update_field" || op.action === "alter_field_type") {
          const table = await findOneByName(Table, op.table);
          if (!table) throw new Error(`table not found: ${op.table}`);
          const desiredTable = (desired.tables || []).find((t) => t.name === op.table);
          const field = desiredTable && findField(desiredTable, op.field);
          if (!field) throw new Error(`desired field not found: ${op.table}.${op.field}`);
          const fieldDef = { ...field, table_id: table.id };
          // Remove runtime-only properties that are not DB columns in _sc_fields
          delete fieldDef.table;
          // Resolve Key field references: reftable_name → reftable_id
          if (field.type === "Key" && field.reftable_name && !field.reftable_id) {
            const reftable = await findOneByName(Table, field.reftable_name);
            if (reftable) {
              fieldDef.reftable_id = reftable.id;
            } else {
              // Referenced table not in tenant (e.g. plugin-managed table like sec_user, sys_file)
              // Skip this field rather than fail — the FK cannot be created without the target table
              skipped.push({ op, reason: `reftable "${field.reftable_name}" not found in tenant; skipping Key field ${op.table}.${field.name}` });
              continue;
            }
          }
          const existing = findField(table, op.field);
          if (existing && typeof existing.update === "function") await existing.update(fieldDef);
          else if (!existing && Field && typeof Field.create === "function") await Field.create(fieldDef);
          else if (!existing) throw new Error(methodUnavailableReason("field", "create", ["Field.create"]));
          applied.push(op);
          continue;
        }

        if (op.action === "rename_field") {
          const table = await findOneByName(Table, op.table);
          const field = table && findField(table, op.from);
          if (!field) throw new Error(`field not found for rename: ${op.table}.${op.from}`);
          if (typeof field.update !== "function") throw new Error(`${methodUnavailableReason("field", "rename", ["field.update"])}: ${op.table}.${op.from}`);
          await field.update({ name: op.to, label: op.to });
          applied.push(op);
          continue;
        }

        if (op.action === "mark_field_deprecated") {
          const table = await findOneByName(Table, op.table);
          const field = table && findField(table, op.field);
          if (field && typeof field.update === "function") await field.update({ attributes: { ...(field.attributes || {}), deprecated: true } });
          else skipped.push({ op, reason: methodUnavailableReason("field", "mark deprecated", ["field.update"]) });
          continue;
        }

        if (op.action === "copy_field_data") {
          const table = await findOneByName(Table, op.table);
          if (table && typeof table.getRows === "function" && typeof table.updateRow === "function") {
            const rows = await table.getRows({});
            for (const row of rows || []) {
              if (row[op.from] !== undefined && row[op.to] !== row[op.from]) {
                await table.updateRow({ [op.to]: row[op.from] }, row.id);
              }
            }
            applied.push({ ...op, rows: (rows || []).length });
          } else {
            skipped.push({ op, reason: methodUnavailableReason("table", "copy field data", ["table.getRows", "table.updateRow"]) });
          }
          continue;
        }

        if (op.action === "upsert_reference_row") {
          const table = await findOneByName(Table, op.table);
          if (table && typeof table.getRows === "function" && typeof table.insertRow === "function" && typeof table.updateRow === "function") {
            const rows = await table.getRows({ [op.key]: op.row[op.key] });
            if (rows && rows[0] && rows[0].id !== undefined) await table.updateRow(op.row, rows[0].id);
            else await table.insertRow(op.row);
            applied.push(op);
          } else {
            skipped.push({ op, reason: methodUnavailableReason("table", "upsert reference data", ["table.getRows", "table.insertRow", "table.updateRow"]) });
          }
          continue;
        }

        if (op.action === "drop_field") {
          const table = await findOneByName(Table, op.table);
          const field = table && findField(table, op.field);
          if (field && typeof field.delete === "function") {
            await field.delete();
            applied.push(op);
          } else skipped.push({ op, reason: methodUnavailableReason("field", "delete", ["field.delete"]) });
          continue;
        }

        if (op.action === "install_plugin" || op.action === "update_plugin") {
          const plugin = (desired.plugins || []).find((item) => item.name === op.plugin);
          if (!plugin) throw new Error(`desired plugin not found: ${op.plugin}`);
          const existing = await findOneByName(Plugin, plugin.name);
          if (existing && typeof existing.update === "function") {
            await existing.update(plugin);
            applied.push(op);
          } else if (existing && typeof Plugin.update === "function" && existing.id !== undefined) {
            await Plugin.update(existing.id, plugin);
            applied.push(op);
          } else if (!existing && Plugin && typeof Plugin.create === "function") {
            await Plugin.create(plugin);
            // Refresh state after plugin install — new types (UUID, etc.)
            // and table providers must be registered before creating tables.
            if (typeof Table.state_refresh === "function") await Table.state_refresh();
            applied.push(op);
          } else {
            skipped.push({ op, reason: methodUnavailableReason("plugin", "install/update", ["plugin.update", "Plugin.update", "Plugin.create"]) });
          }
          continue;
        }

        if (op.action === "drop_plugin") {
          const existing = await findOneByName(Plugin, op.plugin);
          if (existing && typeof existing.delete === "function") {
            await existing.delete();
            applied.push(op);
          } else if (existing && typeof Plugin.delete === "function" && existing.id !== undefined) {
            await Plugin.delete(existing.id);
            applied.push(op);
          } else {
          skipped.push({ op, reason: methodUnavailableReason("plugin", "delete", ["plugin.delete", "Plugin.delete"]) });
          }
          continue;
        }

        // Seed destructive: truncate all rows from a table
        if (op.action === "truncate_table") {
          const table = await findOneByName(Table, op.table);
          if (!table) {
            skipped.push({ op, reason: `table "${op.table}" not found for truncate` });
            continue;
          }
          if (typeof table.getRows !== "function" || typeof table.deleteRows === "function") {
            // Prefer deleteRows when available
            if (typeof table.deleteRows === "function") {
              await table.deleteRows({});
              applied.push(op);
            } else if (typeof table.getRows === "function") {
              // Fallback: delete row by row
              const rows = await table.getRows({});
              for (const row of rows || []) {
                if (row.id !== undefined && typeof table.deleteRow === "function") await table.deleteRow(row.id);
              }
              applied.push(op);
            }
          } else {
            skipped.push({ op, reason: methodUnavailableReason("table", "truncate", ["table.deleteRows", "table.deleteRow"]) });
          }
          continue;
        }

        // Seed row operations: upsert rows into tables
        if (op.action === "seed_row") {
          const table = await findOneByName(Table, op.table);
          if (!table) {
            skipped.push({ op, reason: `table "${op.table}" not found; create the table before seeding` });
            continue;
          }
          if (typeof table.getRows !== "function" || typeof table.insertRow !== "function") {
            skipped.push({ op, reason: methodUnavailableReason("table", "seed row", ["table.getRows", "table.insertRow", "table.updateRow"]) });
            continue;
          }
          const rows = await table.getRows();
          const keyValue = (row, key) => Array.isArray(key) ? key.map((k) => row[k]).join("\0") : row[key];
          const key = op.key || "id";
          const byKey = new Map(rows.map((r) => [keyValue(r, key), r]));
          const existing = byKey.get(keyValue(op.row, key));
          if (existing) {
            if (typeof table.updateRow === "function") {
              await table.updateRow({ ...op.row, id: existing.id }, existing.id);
              applied.push(op);
            } else {
              skipped.push({ op, reason: methodUnavailableReason("table", "update existing seed row", ["table.updateRow"]) });
            }
          } else {
            await table.insertRow(op.row);
            applied.push(op);
          }
          continue;
        }

        // Migration ensure_field: create a field if it does not exist
        if (op.action === "ensure_field") {
          const table = await findOneByName(Table, op.table);
          if (!table) {
            skipped.push({ op, reason: `table "${op.table}" not found` });
            continue;
          }
          const existing = findField(table, op.field);
          if (existing) {
            applied.push({ ...op, note: "field already exists" });
            continue;
          }
          if (Field && typeof Field.create === "function") {
            await Field.create({
              name: op.field,
              type: op.type || "String",
              label: op.field,
              required: op.required || false,
              table_id: table.id,
              table,
            });
            applied.push(op);
          } else {
            skipped.push({ op, reason: methodUnavailableReason("field", "create", ["Field.create"]) });
          }
          continue;
        }

        if (op.action === "raw_sql") {
          skipped.push({ op, reason: "raw_sql is not supported by the native adapter; use command adapter or a migration hook" });
          continue;
        }

        if (op.action === "raw_command") {
          skipped.push({ op, reason: "raw_command is not supported by the native adapter; use command adapter or a migration hook" });
          continue;
        }

        // Menu items: stored as _sc_config setting, not a model
        if (op.action === "create_menu" || op.action === "update_menu") {
          const item = (desired.menu || []).find((obj) => obj.name === op.menu);
          if (item && Array.isArray(item.items)) {
            try {
              const db = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
              if (db && typeof db.update === "function" && typeof db.insert === "function") {
                const existing = await db.select("_sc_config", { key: "menu_items" });
                const value = JSON.stringify({ v: item.items });
                if (existing.length) {
                  await db.update("_sc_config", { value }, { key: "menu_items" });
                } else {
                  await db.insert("_sc_config", { key: "menu_items", value });
                }
                applied.push(op);
              } else {
                skipped.push({ op, reason: "db module not available for menu apply" });
              }
            } catch (menuErr) {
              skipped.push({ op, reason: `menu apply failed: ${menuErr.message}` });
            }
          } else {
            skipped.push({ op, reason: `menu item not found or has no items: ${op.menu}` });
          }
          continue;
        }

        const generic = [
          ["view", View, "views", "row-id", true],
          ["page", Page, "pages", "id-row"],
          ["trigger", Trigger, "triggers", "id-row"],
          ["role", Role, "roles", "instance"],
          ["menu", Menu, "menu", "row-id"],
          ["setting", Setting, "settings", "row-id"],
        ];
        const handled = await generic.reduce(async (prev, [singular, Model, kind, updateStyle]) => {
          if (await prev) return true;
          if (!Model) return false;
          if (op.action === `create_${singular}` || op.action === `update_${singular}`) {
            const item = (desired[kind] || []).find((obj) => obj.name === op[singular]);
            if (!item) throw new Error(`desired ${singular} not found: ${op[singular]}`);
            // Skip views that lack configuration (plugin views whose template may not exist)
            if (singular === "view" && item.configuration === undefined) {
              skipped.push({ op, reason: `view ${item.name} has no configuration; likely requires a plugin viewtemplate not installed` });
              return true;
            }
            // Resolve table_name → table_id for views; strip table_name (not a DB column)
            if (singular === "view") {
              if (item.table_name && !item.table_id && Table) {
                const tbl = await findOneByName(Table, item.table_name);
                if (tbl) item.table_id = tbl.id;
                else item.table_id = null;
              }
              delete item.table_name;
              // Ensure min_role points to a valid role (FK constraint)
              if (item.min_role === undefined || item.min_role === null) {
                try {
                  const Role = optionalRequire(["@saltcorn/data/models/role", "@saltcorn/data/dist/models/role"]);
                  if (Role && typeof Role.find === "function") {
                    const roles = await Role.find();
                    // Prefer user role (id=8), then first non-admin role, then admin (id=1)
                    const userRole = roles.find(r => r.id === 8) || roles.find(r => r.role === "user");
                    const fallback = userRole || roles.find(r => r.id > 1) || roles[0];
                    if (fallback) item.min_role = fallback.id;
                  }
                } catch (_e) { /* proceed without */ }
              }
            }
            // Resolve table_name → table_id for triggers; strip table_name (not a DB column)
            if (singular === "trigger") {
              if (item.table_name && !item.table_id && Table) {
                const tbl = await findOneByName(Table, item.table_name);
                if (tbl) item.table_id = tbl.id;
                else item.table_id = null;
              }
              delete item.table_name;
            }
            const existing = await findOneByName(Model, item.name);
            if (existing && typeof existing.update === "function") {
              await existing.update(item);
              applied.push(op);
            } else if (existing && typeof Model.update === "function" && existing.id !== undefined) {
              if (updateStyle === "row-id") await Model.update(item, existing.id);
              else await Model.update(existing.id, item);
              applied.push(op);
            } else if (!existing && typeof Model.create === "function") {
              await Model.create(item);
              applied.push(op);
            } else {
              skipped.push({ op, reason: methodUnavailableReason(singular, "create/update", [`${singular}.update`, `${singular}Model.update`, `${singular}Model.create`]) });
            }
            return true;
          }
          if (op.action === `rename_${singular}`) {
            const existing = await findOneByName(Model, op.from);
            if (existing && typeof existing.update === "function") {
              await existing.update({ name: op.to });
              applied.push(op);
            } else if (existing && typeof Model.update === "function" && existing.id !== undefined) {
              if (updateStyle === "row-id") await Model.update({ name: op.to }, existing.id);
              else await Model.update(existing.id, { name: op.to });
              applied.push(op);
            } else {
              skipped.push({ op, reason: methodUnavailableReason(singular, "rename", [`${singular}.update`, `${singular}Model.update`]) });
            }
            return true;
          }
          if (op.action === `drop_${singular}`) {
            const existing = await findOneByName(Model, op[singular]);
            if (existing && typeof existing.delete === "function") {
              await existing.delete();
              applied.push(op);
            } else if (existing && typeof Model.delete === "function" && existing.id !== undefined) {
              await Model.delete(existing.id);
              applied.push(op);
            } else {
              skipped.push({ op, reason: methodUnavailableReason(singular, "delete", [`${singular}.delete`, `${singular}Model.delete`]) });
            }
            return true;
          }
          return false;
        }, Promise.resolve(false));
        if (handled) continue;

        skipped.push({ op, reason: "operation not implemented by native adapter" });
      }

      // Refresh all Saltcorn state caches across all workers.
      // Saltcorn clusters use IPC: sendMessageToWorkers({ refresh: "tables" })
      // triggers getState().refresh_tables() on every worker process.
      // We call refresh with noSignal=false so processSend propagates to master
      // and then to all workers via workerDispatchMsg.
      const stateModule = optionalRequire(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
      if (stateModule && typeof stateModule.getState === "function") {
        const state = stateModule.getState();
        for (const kind of ["tables", "views", "pages", "triggers"]) {
          const refreshFn = state[`refresh_${kind}`];
          if (typeof refreshFn === "function") {
            try { await refreshFn.call(state, false); } catch (_e) { /* best effort */ }
          }
        }
      }

      return { ok: true, applied, skipped };
    },
    async applyProject() {
      throw new Error("saltcorn-native adapter requires applyPlan; use CLI apply, not direct applyProject");
    },
    async resetSchema() {
      // Saltcorn exposes reset_schema via @saltcorn/data/db/connect
      try {
        const db = optionalRequire(["@saltcorn/data/db/connect", "@saltcorn/data/dist/db/connect"]);
      if (typeof db.reset_schema === "function") {
          await db.reset_schema();
          return { ok: true };
        }
      } catch (_err) {
        // fall through
      }
      // Fallback: look for the global saltcorn CLI
      const cmd = process.env.SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD;
      if (cmd) return runShellJson(cmd) || { ok: true };
      throw new Error("Native reset_schema unavailable; set SALTCORN_PROJECT_SYNC_RESET_SCHEMA_CMD to a shell command that runs 'saltcorn reset-schema'");
    },
    async installPlugin(plugin) {
      if (!models.Plugin || typeof models.Plugin.create !== "function") {
        return { ok: true, skipped: true, reason: "Plugin.create not available" };
      }
      await models.Plugin.create(plugin);
      return { ok: true };
    },
  };
}

function getTenantAdapter(name = process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command") {
  if (name === "command") return commandAdapter();
  if (name === "rest" || name === "http") return restAdapter();
  if (name === "saltcorn-native" || name === "native") return nativeSaltcornAdapter();
  throw new Error(`unsupported tenant adapter: ${name}`);
}

function gitCommitOrNull(projectDir = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim();
  } catch (_err) {
    return null;
  }
}

module.exports = {
  getTenantAdapter,
  commandAdapter,
  restAdapter,
  nativeSaltcornAdapter,
  capabilityReport,
  findOneByName,
  methodUnavailableReason,
  optionalRequire,
  optionalRequireOrNull,
  serializeModel,
  gitCommitOrNull,
};
