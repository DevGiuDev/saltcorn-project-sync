const { diffNamedCollections, diffTables } = require("./diff");
const { hasIntent } = require("./change-intents");
const { VERSIONED_KINDS } = require("./normalizer");
const { diffReferenceData } = require("./reference-data");

const ENV_POLICIES = {
  local: { destructive: "confirm", backup: "recommended" },
  dev: { destructive: "confirm", backup: "recommended" },
  test: { destructive: "intent", backup: "required" },
  prod: { destructive: "intent", backup: "required" },
};

function requireBackup(env) {
  return (ENV_POLICIES[env] || ENV_POLICIES.dev).backup === "required";
}

function typeName(field = {}) {
  if (!field) return undefined;
  if (typeof field.type === "string") return field.type;
  if (field.type && typeof field.type === "object") return field.type.name || field.type.type || field.type.toString?.();
  return field.typename;
}

function planTables({ desiredTables = [], actualTables = [], intents = [] }) {
  const diff = diffTables(desiredTables, actualTables);
  const operations = [];
  const warnings = [];
  const blocked = [];

  for (const table of diff.tables.created) {
    operations.push({ action: "create_table", table: table.name, safe: true });
  }

  for (const orphan of diff.tables.orphaned) {
    const dropAllowed = hasIntent(
      intents,
      (intent) => intent.type === "drop_table" && intent.table === orphan.name
    );
    if (dropAllowed) operations.push({ action: "drop_table", table: orphan.name, safe: false });
    else warnings.push({ type: "orphaned_table", table: orphan.name, message: "Preserved by default" });
  }

  for (const tableFields of diff.fieldDiffs) {
    for (const field of tableFields.fields.created) {
      const createdByRename = intents.some(
        (intent) => intent.type === "rename_field" && intent.table === tableFields.table && intent.to === field.name
      );
      if (!createdByRename) operations.push({ action: "create_field", table: tableFields.table, field: field.name, safe: true });
    }
    for (const field of tableFields.fields.updated) {
      const desiredType = typeName(field.desired);
      const actualType = typeName(field.actual);
      if (desiredType && actualType && desiredType !== actualType) {
        const intentAllowed = hasIntent(
          intents,
          (intent) =>
            intent.type === "alter_field_type" &&
            intent.table === tableFields.table &&
            intent.field === field.key &&
            intent.from === actualType &&
            intent.to === desiredType
        );
        if (intentAllowed) {
          operations.push({
            action: "alter_field_type",
            table: tableFields.table,
            field: field.key,
            from: actualType,
            to: desiredType,
            safe: false,
          });
        } else {
          blocked.push({
            code: "field_type_change_requires_intent",
            table: tableFields.table,
            field: field.key,
            from: actualType,
            to: desiredType,
            reason: "Field type changes may lose data and require alter_field_type intent",
          });
        }
      } else {
        operations.push({ action: "update_field", table: tableFields.table, field: field.key, safe: true });
      }
    }
    for (const orphan of tableFields.fields.orphaned) {
      const dropAllowed = hasIntent(
        intents,
        (intent) =>
          intent.type === "drop_field" &&
          intent.table === tableFields.table &&
          intent.field === orphan.name
      );
      const renameIntent = intents.find(
        (intent) =>
          intent.type === "rename_field" &&
          intent.table === tableFields.table &&
          intent.from === orphan.name
      );
      if (dropAllowed) operations.push({ action: "drop_field", table: tableFields.table, field: orphan.name, safe: false });
      else if (renameIntent) operations.push({ action: "rename_field", table: tableFields.table, from: orphan.name, to: renameIntent.to, safe: false });
      else warnings.push({ type: "orphaned_field", table: tableFields.table, field: orphan.name, message: "Preserved by default; possible rename or drift" });
    }
  }

  return { operations, warnings, blocked };
}

function planNamedKind(kind, desired = [], actual = [], intents = []) {
  const diff = diffNamedCollections(desired, actual);
  const singular = kind.replace(/s$/, "");
  const operations = [];
  const warnings = [];

  for (const item of diff.created) operations.push({ action: `create_${singular}`, [singular]: item.name, safe: true });
  for (const item of diff.updated) operations.push({ action: `update_${singular}`, [singular]: item.key, safe: true });
  for (const orphan of diff.orphaned) {
    const dropAllowed = hasIntent(
      intents,
      (intent) => intent.type === `drop_${singular}` && intent[singular] === orphan.name
    );
    const renameIntent = intents.find(
      (intent) => intent.type === `rename_${singular}` && intent.from === orphan.name
    );
    if (dropAllowed) operations.push({ action: `drop_${singular}`, [singular]: orphan.name, safe: false });
    else if (renameIntent) operations.push({ action: `rename_${singular}`, from: orphan.name, to: renameIntent.to, safe: false });
    else warnings.push({ type: `orphaned_${singular}`, [singular]: orphan.name, message: "Preserved by default" });
  }

  return { operations, warnings };
}

function planIntentOperations(intents = []) {
  return intents.flatMap((intent) => {
    if (intent.type === "copy_field_data") {
      return [{ action: "copy_field_data", table: intent.table, from: intent.from, to: intent.to, safe: false }];
    }
    if (intent.type === "mark_deprecated") {
      return [{ action: "mark_field_deprecated", table: intent.table, field: intent.field, safe: true }];
    }
    return [];
  });
}

function planProject({ desired = {}, actual = {}, intents = [], env = "dev", backup = false }) {
  const policy = ENV_POLICIES[env] || ENV_POLICIES.dev;
  const operations = [];
  const warnings = [];
  const blocked = [];

  const tablePlan = planTables({ desiredTables: desired.tables || [], actualTables: actual.tables || [], intents });
  operations.push(...tablePlan.operations);
  warnings.push(...tablePlan.warnings);
  blocked.push(...(tablePlan.blocked || []));

  for (const kind of VERSIONED_KINDS.filter((kind) => kind !== "tables")) {
    const kindPlan = planNamedKind(kind, desired[kind] || [], actual[kind] || [], intents);
    operations.push(...kindPlan.operations);
    warnings.push(...kindPlan.warnings);
  }

  operations.push(...planIntentOperations(intents));

  const referenceDiffs = diffReferenceData(desired.reference_data || [], actual.reference_data || {});
  for (const refDiff of referenceDiffs) {
    for (const row of refDiff.upsert) {
      operations.push({ action: "upsert_reference_row", table: refDiff.table, key: refDiff.key, row, safe: true });
    }
    if (refDiff.orphaned.length) {
      warnings.push({
        type: "orphaned_reference_rows",
        table: refDiff.table,
        count: refDiff.orphaned.length,
        message: "Preserved by default",
      });
    }
  }

  if (requireBackup(env) && !backup) {
    blocked.push({ reason: `backup is required for ${env}`, code: "backup_required" });
  }

  if (policy.destructive === "intent") {
    for (const op of operations.filter((op) => !op.safe && !op.action)) {
      blocked.push({ operation: op, reason: "invalid destructive operation" });
    }
  }

  return { env, policy, backup_required: requireBackup(env), backup_present: Boolean(backup), operations, warnings, blocked };
}

module.exports = { ENV_POLICIES, requireBackup, typeName, planTables, planNamedKind, planIntentOperations, planProject };
