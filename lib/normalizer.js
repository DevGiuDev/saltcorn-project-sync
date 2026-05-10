const { sortValue } = require("./canonical-json");

const VERSIONED_KINDS = ["tables", "views", "pages", "triggers", "roles"];
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key|credential)/i;

function stripUnsafeValues(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeValues);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((acc, key) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        acc[key] = "__REDACTED__";
      } else {
        acc[key] = stripUnsafeValues(value[key]);
      }
      return acc;
    }, {});
  }
  return value;
}

function portableName(item, fallbackPrefix, index) {
  return item.name || item.key || item.label || item.id || `${fallbackPrefix}_${index + 1}`;
}

function normalizeNamedItem(item, kind, index) {
  const cleaned = stripUnsafeValues(item || {});
  const name = portableName(cleaned, kind.replace(/s$/, ""), index);
  const normalized = { ...cleaned, name };

  // Tenant-local integer IDs are not portable. Keep explicit stable refs only.
  if (typeof normalized.id === "number") delete normalized.id;
  if (typeof normalized.table_id === "number") delete normalized.table_id;
  if (typeof normalized.viewtemplate === "object") normalized.viewtemplate = stripUnsafeValues(normalized.viewtemplate);

  if (kind === "tables" && Array.isArray(normalized.fields)) {
    normalized.fields = normalized.fields
      .map((field, fieldIndex) => normalizeNamedItem(field, "fields", fieldIndex))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return sortValue(normalized);
}

function normalizeCollection(items = [], kind) {
  return items
    .map((item, index) => normalizeNamedItem(item, kind, index))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function normalizeProjectExport(input = {}) {
  const out = {};
  for (const kind of VERSIONED_KINDS) {
    out[kind] = normalizeCollection(input[kind] || [], kind);
  }
  if (Array.isArray(input.plugins)) {
    out.plugins = normalizeCollection(input.plugins, "plugins");
  }
  return out;
}

/**
 * Convert common Saltcorn pack/snapshot-like shapes into the internal project export shape.
 * This is intentionally permissive for MVP compatibility; semantic importers can tighten it later.
 */
function normalizePack(pack = {}) {
  const root = pack.pack || pack.snapshot || pack;
  return normalizeProjectExport({
    tables: root.tables || root.Table || [],
    views: root.views || root.View || [],
    pages: root.pages || root.Page || [],
    triggers: root.triggers || root.Trigger || [],
    roles: root.roles || root.Role || [],
    plugins: root.plugins || root.Plugin || [],
  });
}

module.exports = {
  VERSIONED_KINDS,
  SECRET_KEY_PATTERN,
  stripUnsafeValues,
  normalizeNamedItem,
  normalizeCollection,
  normalizeProjectExport,
  normalizePack,
};
