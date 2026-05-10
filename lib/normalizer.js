const { sortValue } = require("./canonical-json");

const VERSIONED_KINDS = ["tables", "views", "pages", "triggers", "roles", "menu", "settings"];
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key|credential|bearer|authorization|auth[_-]?key|access[_-]?key|refresh[_-]?key|session[_-]?key)/i;
const VOLATILE_KEY_PATTERN = /^(created_at|updated_at|created|updated|last_modified|lastmod|nonce)$/i;
const TENANT_LOCAL_ID_PATTERN = /(^id$|_id$)/;

function stripUnsafeValues(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeValues);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((acc, key) => {
      const v = value[key];
      if (SECRET_KEY_PATTERN.test(key)) {
        acc[key] = "__REDACTED__";
      } else if (VOLATILE_KEY_PATTERN.test(key)) {
        return acc;
      } else if (TENANT_LOCAL_ID_PATTERN.test(key) && typeof v === "number") {
        return acc;
      } else {
        acc[key] = stripUnsafeValues(v);
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
  const source = item || {};
  const name = portableName(source, kind.replace(/s$/, ""), index);
  const cleaned = stripUnsafeValues(source);
  const normalized = { ...cleaned, name };

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
  if (input.reference_data && typeof input.reference_data === "object") {
    out.reference_data = stripUnsafeValues(input.reference_data);
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
    menu: root.menu || root.Menu || [],
    settings: root.settings || root.Setting || [],
    plugins: root.plugins || root.Plugin || [],
    reference_data: root.reference_data || root.referenceData || {},
  });
}

module.exports = {
  VERSIONED_KINDS,
  SECRET_KEY_PATTERN,
  VOLATILE_KEY_PATTERN,
  TENANT_LOCAL_ID_PATTERN,
  stripUnsafeValues,
  normalizeNamedItem,
  normalizeCollection,
  normalizeProjectExport,
  normalizePack,
};
