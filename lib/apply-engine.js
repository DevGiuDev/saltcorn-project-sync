const { sortValue } = require("./canonical-json");
const { VERSIONED_KINDS } = require("./normalizer");
const { findByName, upsertByName, removeByName } = require("./project-state");
const { planProject } = require("./planner");
const { applyReferenceData } = require("./reference-data");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function desiredTable(desired, tableName) {
  return findByName(desired.tables || [], tableName);
}

function desiredField(desired, tableName, fieldName) {
  const table = desiredTable(desired, tableName);
  return table && findByName(table.fields || [], fieldName);
}

function ensureTable(state, tableName) {
  let table = findByName(state.tables || [], tableName);
  if (!table) {
    table = { name: tableName, fields: [] };
    state.tables = upsertByName(state.tables || [], table);
  }
  return table;
}

function replaceTable(state, table) {
  state.tables = upsertByName(state.tables || [], table);
}

function createOrUpdateField(state, desired, tableName, fieldName) {
  const table = clone(ensureTable(state, tableName));
  const field = desiredField(desired, tableName, fieldName);
  if (!field) throw new Error(`desired field not found: ${tableName}.${fieldName}`);
  table.fields = upsertByName(table.fields || [], field);
  replaceTable(state, table);
}

function renameField(state, desired, tableName, from, to) {
  const table = clone(ensureTable(state, tableName));
  const field = findByName(table.fields || [], from);
  if (!field) return;
  const target = desiredField(desired, tableName, to);
  table.fields = removeByName(table.fields || [], from);
  table.fields = upsertByName(table.fields, target ? { ...field, ...target, name: to } : { ...field, name: to });
  replaceTable(state, table);
}

function dropField(state, tableName, fieldName) {
  const table = clone(ensureTable(state, tableName));
  table.fields = removeByName(table.fields || [], fieldName);
  replaceTable(state, table);
}

function applyOperation(state, desired, op) {
  if (op.action === "create_table" || op.action === "update_table") {
    const table = desiredTable(desired, op.table);
    if (!table) throw new Error(`desired table not found: ${op.table}`);
    state.tables = upsertByName(state.tables || [], table);
    return;
  }
  if (op.action === "drop_table") {
    state.tables = removeByName(state.tables || [], op.table);
    return;
  }
  if (op.action === "create_field" || op.action === "update_field" || op.action === "alter_field_type") {
    createOrUpdateField(state, desired, op.table, op.field);
    return;
  }
  if (op.action === "mark_field_deprecated") {
    const table = clone(ensureTable(state, op.table));
    const field = findByName(table.fields || [], op.field);
    if (field) {
      table.fields = upsertByName(table.fields || [], { ...field, deprecated: true });
      replaceTable(state, table);
    }
    return;
  }
  if (op.action === "copy_field_data") {
    state.change_intent_notes = [
      ...(state.change_intent_notes || []),
      { action: "copy_field_data", table: op.table, from: op.from, to: op.to, note: "Data copy must be executed by tenant adapter against real rows" },
    ];
    return;
  }
  if (op.action === "rename_field") {
    renameField(state, desired, op.table, op.from, op.to);
    return;
  }
  if (op.action === "drop_field") {
    dropField(state, op.table, op.field);
    return;
  }

  for (const kind of VERSIONED_KINDS.filter((kind) => kind !== "tables")) {
    const singular = kind.replace(/s$/, "");
    if (op.action === `create_${singular}` || op.action === `update_${singular}`) {
      const item = findByName(desired[kind] || [], op[singular]);
      if (!item) throw new Error(`desired ${singular} not found: ${op[singular]}`);
      state[kind] = upsertByName(state[kind] || [], item);
      return;
    }
    if (op.action === `rename_${singular}`) {
      const item = findByName(state[kind] || [], op.from);
      if (!item) return;
      state[kind] = removeByName(state[kind] || [], op.from);
      state[kind] = upsertByName(state[kind] || [], { ...item, name: op.to });
      return;
    }
    if (op.action === `drop_${singular}`) {
      state[kind] = removeByName(state[kind] || [], op[singular]);
      return;
    }
  }

  throw new Error(`unsupported operation: ${op.action}`);
}

function applyProject({ desired = {}, actual = {}, intents = [], env = "dev", backup = false, force = false }) {
  const plan = planProject({ desired, actual, intents, env, backup });
  if (plan.blocked.length && !force) {
    return { applied: false, plan, state: sortValue(clone(actual)), errors: ["plan has blocked operations"] };
  }

  const state = clone(actual);
  const refResult = applyReferenceData({ desiredRefs: desired.reference_data || [], actualReferenceData: state.reference_data || {} });
  state.reference_data = refResult.referenceData;
  const errors = [];
  for (const op of plan.operations) {
    if (op.action === "upsert_reference_row") continue;
    try {
      applyOperation(state, desired, op);
    } catch (err) {
      errors.push(`${op.action}: ${err.message}`);
    }
  }

  return {
    applied: errors.length === 0,
    plan,
    state: sortValue(state),
    errors,
  };
}

module.exports = { applyOperation, applyProject };
