const fs = require("node:fs");
const path = require("node:path");
const { parseJson } = require("./canonical-json");
const { compareVersions } = require("./compatibility");

const SUPPORTED_INTENTS = new Set([
  "drop_field",
  "rename_field",
  "drop_table",
  "rename_table",
  "drop_view",
  "rename_view",
  "drop_page",
  "rename_page",
  "drop_trigger",
  "rename_trigger",
  "drop_role",
  "rename_role",
  "drop_plugin",
  "copy_field_data",
  "mark_deprecated",
  "alter_field_type",
]);

/**
 * Load change intents from the changes/ directory.
 *
 * If sinceVersion is provided, only intents with a version field
 * greater than sinceVersion are included. Intents without a version
 * field are always included (backward compatibility).
 *
 * @param {string} projectDir
 * @param {object} [options]
 * @param {string} [options.sinceVersion] - Only include intents newer than this version
 */
function loadChangeIntents(projectDir = process.cwd(), { sinceVersion = null } = {}) {
  const dir = path.join(projectDir, "changes");
  if (!fs.existsSync(dir)) return [];
  const all = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      const parsed = parseJson(fs.readFileSync(file, "utf8"), file);
      return Array.isArray(parsed) ? parsed : [parsed];
    });

  if (!sinceVersion) return all;

  return all.filter((intent) => {
    // Intents without version are always active (backward compat)
    if (!intent.version) return true;
    const cmp = compareVersions(intent.version, sinceVersion);
    // Include if intent version > sinceVersion
    return cmp !== null && cmp > 0;
  });
}

function requireKeys(intent, errors, keys) {
  for (const key of keys) if (!intent[key]) errors.push(`${key} is required for ${intent.type}`);
}

function validateChangeIntent(intent) {
  const errors = [];
  if (!intent || typeof intent !== "object") return { valid: false, errors: ["intent must be an object"] };
  if (!intent.id) errors.push("id is required");
  if (!SUPPORTED_INTENTS.has(intent.type)) errors.push(`unsupported intent type: ${intent.type}`);
  if (!intent.reason) errors.push("reason is required");

  if (intent.type === "drop_field") requireKeys(intent, errors, ["table", "field"]);
  if (intent.type === "rename_field") requireKeys(intent, errors, ["table", "from", "to"]);
  if (intent.type === "drop_table") requireKeys(intent, errors, ["table"]);
  if (intent.type === "rename_table") requireKeys(intent, errors, ["from", "to"]);
  if (intent.type && intent.type.startsWith("drop_") && !["drop_field", "drop_table"].includes(intent.type)) {
    const key = intent.type.replace("drop_", "");
    requireKeys(intent, errors, [key]);
  }
  if (intent.type && intent.type.startsWith("rename_") && !["rename_field", "rename_table"].includes(intent.type)) {
    requireKeys(intent, errors, ["from", "to"]);
  }
  if (intent.type === "copy_field_data") requireKeys(intent, errors, ["table", "from", "to"]);
  if (intent.type === "mark_deprecated") requireKeys(intent, errors, ["table", "field"]);
  if (intent.type === "alter_field_type") requireKeys(intent, errors, ["table", "field", "from", "to"]);

  return { valid: errors.length === 0, errors };
}

function hasIntent(intents, predicate) {
  return intents.some((intent) => validateChangeIntent(intent).valid && predicate(intent));
}

module.exports = {
  SUPPORTED_INTENTS,
  loadChangeIntents,
  validateChangeIntent,
  hasIntent,
};
