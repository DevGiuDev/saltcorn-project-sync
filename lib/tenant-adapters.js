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

function commandAdapter() {
  return {
    name: "command",
    async exportProject() {
      return runShellJson(requireCommand("SALTCORN_PROJECT_SYNC_EXPORT_CMD"));
    },
    async applyProject(state) {
      const cmd = requireCommand("SALTCORN_PROJECT_SYNC_APPLY_CMD");
      return runShellJson(cmd, state) || { ok: true };
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

function loadSaltcornModels() {
  return {
    Table: optionalRequire(["@saltcorn/data/models/table", "@saltcorn/data/dist/models/table"]),
    Field: optionalRequire(["@saltcorn/data/models/field", "@saltcorn/data/dist/models/field"]),
    View: optionalRequire(["@saltcorn/data/models/view", "@saltcorn/data/dist/models/view"]),
    Page: optionalRequire(["@saltcorn/data/models/page", "@saltcorn/data/dist/models/page"]),
    Trigger: optionalRequire(["@saltcorn/data/models/trigger", "@saltcorn/data/dist/models/trigger"]),
    Role: optionalRequire(["@saltcorn/data/models/role", "@saltcorn/data/dist/models/role"]),
    Plugin: optionalRequire(["@saltcorn/data/models/plugin", "@saltcorn/data/dist/models/plugin"]),
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

function nativeSaltcornAdapter() {
  const models = loadSaltcornModels();
  return {
    name: "saltcorn-native",
    async exportProject() {
      const { Table, View, Page, Trigger, Role, Plugin } = models;
      return {
        tables: await findAll(Table),
        views: await findAll(View),
        pages: await findAll(Page),
        triggers: await findAll(Trigger),
        roles: await findAll(Role),
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
      const { Table, Field, View, Page, Trigger, Role } = models;
      const applied = [];
      const skipped = [];

      for (const op of plan.operations) {
        if (op.action === "create_table") {
          const table = (desired.tables || []).find((t) => t.name === op.table);
          if (!table) throw new Error(`desired table not found: ${op.table}`);
          const existing = Table.findOne(op.table) || Table.findOne({ name: op.table });
          if (!existing) await Table.create(table.name, table);
          applied.push(op);
          continue;
        }

        if (op.action === "create_field" || op.action === "update_field" || op.action === "alter_field_type") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          if (!table) throw new Error(`table not found: ${op.table}`);
          const desiredTable = (desired.tables || []).find((t) => t.name === op.table);
          const field = desiredTable && findField(desiredTable, op.field);
          if (!field) throw new Error(`desired field not found: ${op.table}.${op.field}`);
          const existing = findField(table, op.field);
          if (existing && typeof existing.update === "function") await existing.update(field);
          else if (!existing) await Field.create({ ...field, table_id: table.id, table });
          applied.push(op);
          continue;
        }

        if (op.action === "rename_field") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          const field = table && findField(table, op.from);
          if (!field || typeof field.update !== "function") throw new Error(`field not updatable: ${op.table}.${op.from}`);
          await field.update({ name: op.to, label: op.to });
          applied.push(op);
          continue;
        }

        if (op.action === "mark_field_deprecated") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          const field = table && findField(table, op.field);
          if (field && typeof field.update === "function") await field.update({ attributes: { ...(field.attributes || {}), deprecated: true } });
          else skipped.push({ op, reason: "field update method unavailable" });
          continue;
        }

        if (op.action === "copy_field_data") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          if (table && typeof table.getRows === "function" && typeof table.updateRow === "function") {
            const rows = await table.getRows({});
            for (const row of rows || []) {
              if (row[op.from] !== undefined && row[op.to] !== row[op.from]) {
                await table.updateRow({ [op.to]: row[op.from] }, row.id);
              }
            }
            applied.push({ ...op, rows: (rows || []).length });
          } else {
            skipped.push({ op, reason: "copy_field_data requires getRows/updateRow support" });
          }
          continue;
        }

        if (op.action === "upsert_reference_row") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          if (table && typeof table.getRows === "function" && typeof table.insertRow === "function" && typeof table.updateRow === "function") {
            const rows = await table.getRows({ [op.key]: op.row[op.key] });
            if (rows && rows[0] && rows[0].id !== undefined) await table.updateRow(op.row, rows[0].id);
            else await table.insertRow(op.row);
            applied.push(op);
          } else {
            skipped.push({ op, reason: "reference data upsert requires getRows/insertRow/updateRow support" });
          }
          continue;
        }

        if (op.action === "drop_field") {
          const table = Table.findOne(op.table) || Table.findOne({ name: op.table });
          const field = table && findField(table, op.field);
          if (field && typeof field.delete === "function") await field.delete();
          else skipped.push({ op, reason: "field delete method unavailable" });
          continue;
        }

        const generic = [
          ["view", View, "views"],
          ["page", Page, "pages"],
          ["trigger", Trigger, "triggers"],
          ["role", Role, "roles"],
        ];
        const handled = await generic.reduce(async (prev, [singular, Model, kind]) => {
          if (await prev) return true;
          if (op.action !== `create_${singular}` && op.action !== `update_${singular}`) return false;
          const item = (desired[kind] || []).find((obj) => obj.name === op[singular]);
          if (!item) throw new Error(`desired ${singular} not found: ${op[singular]}`);
          const existing = Model.findOne && (Model.findOne({ name: item.name }) || Model.findOne(item.name));
          if (existing && typeof existing.update === "function") await existing.update(item);
          else if (!existing && typeof Model.create === "function") await Model.create(item);
          else skipped.push({ op, reason: `${singular} create/update method unavailable` });
          applied.push(op);
          return true;
        }, Promise.resolve(false));
        if (handled) continue;

        skipped.push({ op, reason: "operation not implemented by native adapter" });
      }

      return { ok: skipped.length === 0, applied, skipped };
    },
    async applyProject() {
      throw new Error("saltcorn-native adapter requires applyPlan; use CLI apply, not direct applyProject");
    },
  };
}

function getTenantAdapter(name = process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command") {
  if (name === "command") return commandAdapter();
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
  nativeSaltcornAdapter,
  optionalRequire,
  serializeModel,
  gitCommitOrNull,
};
