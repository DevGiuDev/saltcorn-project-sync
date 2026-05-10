const { diffNamedCollections, diffTables } = require("./diff");
const { hasIntent } = require("./change-intents");
const { VERSIONED_KINDS } = require("./normalizer");

const ENV_POLICIES = {
  local: { destructive: "confirm", backup: "recommended" },
  dev: { destructive: "confirm", backup: "recommended" },
  test: { destructive: "intent", backup: "required" },
  prod: { destructive: "intent", backup: "required" },
};

function requireBackup(env) {
  return (ENV_POLICIES[env] || ENV_POLICIES.dev).backup === "required";
}

function planTables({ desiredTables = [], actualTables = [], intents = [] }) {
  const diff = diffTables(desiredTables, actualTables);
  const operations = [];
  const warnings = [];

  for (const table of diff.tables.created) {
    operations.push({ action: "create_table", table: table.name, safe: true });
  }

  // Table field differences are planned field-by-field below. Table metadata updates
  // will be added later once Saltcorn semantic table options are normalized.
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
      operations.push({ action: "update_field", table: tableFields.table, field: field.key, safe: true });
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

  return { operations, warnings };
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

function planProject({ desired = {}, actual = {}, intents = [], env = "dev", backup = false }) {
  const policy = ENV_POLICIES[env] || ENV_POLICIES.dev;
  const operations = [];
  const warnings = [];
  const blocked = [];

  const tablePlan = planTables({ desiredTables: desired.tables || [], actualTables: actual.tables || [], intents });
  operations.push(...tablePlan.operations);
  warnings.push(...tablePlan.warnings);

  for (const kind of VERSIONED_KINDS.filter((kind) => kind !== "tables")) {
    const kindPlan = planNamedKind(kind, desired[kind] || [], actual[kind] || [], intents);
    operations.push(...kindPlan.operations);
    warnings.push(...kindPlan.warnings);
  }

  if (requireBackup(env) && !backup) {
    blocked.push({ reason: `backup is required for ${env}`, code: "backup_required" });
  }

  if (policy.destructive === "intent") {
    // Destructive operations are only generated when an intent exists; keep this explicit for plan consumers.
    for (const op of operations.filter((op) => !op.safe && !op.action)) {
      blocked.push({ operation: op, reason: "invalid destructive operation" });
    }
  }

  return { env, policy, backup_required: requireBackup(env), backup_present: Boolean(backup), operations, warnings, blocked };
}

module.exports = { ENV_POLICIES, requireBackup, planTables, planNamedKind, planProject };
