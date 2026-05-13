const { sortValue } = require("./canonical-json");

const VERSIONED_KINDS = ["tables", "views", "pages", "triggers", "roles", "menu", "settings"];
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key|credential|bearer|authorization|auth[_-]?key|access[_-]?key|refresh[_-]?key|session[_-]?key)/i;
const VOLATILE_KEY_PATTERN = /^(created_at|updated_at|created|updated|last_modified|lastmod|nonce)$/i;
const NOISY_METADATA_KEY_PATTERN = /^(created_by|updated_by|created_by_user_id|updated_by_user_id|last_updated_by|pack_id|snapshot_id)$/i;
const TENANT_LOCAL_ID_PATTERN = /(^id$|_id$)/;
const EMPTY_DEFAULT_KEYS = new Set(["attributes", "configuration", "options", "meta", "metadata"]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isEmptyDefaultValue(key, value) {
  if (!EMPTY_DEFAULT_KEYS.has(key)) return false;
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function stripUnsafeValues(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeValues);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((acc, key) => {
      const v = value[key];
      if (SECRET_KEY_PATTERN.test(key)) {
        acc[key] = "__REDACTED__";
      } else if (VOLATILE_KEY_PATTERN.test(key) || NOISY_METADATA_KEY_PATTERN.test(key)) {
        return acc;
      } else if (TENANT_LOCAL_ID_PATTERN.test(key) && typeof v === "number") {
        return acc;
      } else {
        const cleaned = stripUnsafeValues(v);
        if (!isEmptyDefaultValue(key, cleaned)) acc[key] = cleaned;
      }
      return acc;
    }, {});
  }
  return value;
}

function portableName(item, fallbackPrefix, index) {
  return item.name || item.key || item.label || item.slug || item.id || `${fallbackPrefix}_${index + 1}`;
}

function coerceCollection(items, kind) {
  if (Array.isArray(items)) return items;
  if (!items) return [];
  if (!isPlainObject(items)) return [];

  if (kind === "settings") {
    if (items.name || items.key || Object.prototype.hasOwnProperty.call(items, "value")) return [items];
    return Object.keys(items).map((key) => {
      const value = items[key];
      return isPlainObject(value) ? { name: key, key, ...value } : { name: key, key, value };
    });
  }

  if (kind === "menu") {
    if (items.name || items.key || items.label || Array.isArray(items.items)) return [{ name: items.name || items.key || "main", ...items }];
    return Object.keys(items).map((key) => {
      const value = items[key];
      return isPlainObject(value) ? { name: key, ...value } : { name: key, value };
    });
  }

  if (items.name || items.key || items.label) return [items];
  return Object.keys(items).map((key) => (isPlainObject(items[key]) ? { name: key, ...items[key] } : { name: key, value: items[key] }));
}

function indexByNumericId(items, fallbackPrefix) {
  const out = new Map();
  for (const [index, item] of coerceCollection(items, fallbackPrefix).entries()) {
    if (item && typeof item.id === "number") out.set(item.id, portableName(item, fallbackPrefix, index));
  }
  return out;
}

function buildReferenceMaps(input = {}) {
  const tables = coerceCollection(input.tables || [], "tables");
  const maps = {
    table_id: indexByNumericId(tables, "tables"),
    view_id: indexByNumericId(input.views || [], "views"),
    page_id: indexByNumericId(input.pages || [], "pages"),
    trigger_id: indexByNumericId(input.triggers || [], "triggers"),
    role_id: indexByNumericId(input.roles || [], "roles"),
    plugin_id: indexByNumericId(input.plugins || [], "plugins"),
    field_id: new Map(),
  };

  for (const table of tables) {
    for (const [index, field] of coerceCollection(table.fields || [], "fields").entries()) {
      if (field && typeof field.id === "number") maps.field_id.set(field.id, portableName(field, "field", index));
    }
  }

  return maps;
}

function stableReferenceKey(key) {
  if (key.endsWith("_id")) return `${key.slice(0, -3)}_name`;
  return `${key}_name`;
}

function resolveStableReferences(value, maps = {}) {
  if (Array.isArray(value)) return value.map((item) => resolveStableReferences(item, maps));
  if (!isPlainObject(value)) return value;

  return Object.keys(value).reduce((acc, key) => {
    const raw = value[key];
    const map = maps[key];
    if (map && typeof raw === "number" && map.has(raw)) {
      acc[stableReferenceKey(key)] = map.get(raw);
      return acc;
    }
    acc[key] = resolveStableReferences(raw, maps);
    return acc;
  }, {});
}

function normalizeSetting(item, index, maps) {
  const resolved = resolveStableReferences(item || {}, maps);
  const cleaned = stripUnsafeValues(resolved);
  const name = cleaned.name || cleaned.key || `setting_${index + 1}`;
  return sortValue({ ...cleaned, name });
}

// Default/empty values that Saltcorn adds to every menu item
const MENU_ITEM_DEFAULTS = {
  href: "", icon: "", style: "", title: "", tooltip: "",
  target: "_self", in_modal: false, location: "Standard",
  target_blank: false, disable_on_mobile: false, user_menu_header: false,
};

function normalizeMenuItem(item) {
  if (!item || typeof item !== "object") return item;
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    // Skip defaults
    if (MENU_ITEM_DEFAULTS[key] !== undefined && JSON.stringify(value) === JSON.stringify(MENU_ITEM_DEFAULTS[key])) continue;
    // Recurse into subitems
    if (key === "subitems" && Array.isArray(value)) {
      out.subitems = value.map(normalizeMenuItem).filter(Boolean);
      if (out.subitems.length === 0) delete out.subitems;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function normalizeMenu(item, index, maps) {
  const resolved = resolveStableReferences(item || {}, maps);
  const cleaned = stripUnsafeValues(resolved);
  const name = cleaned.name || cleaned.key || cleaned.label || (index === 0 ? "main" : `menu_${index + 1}`);
  // Normalize nested menu items
  if (Array.isArray(cleaned.items)) {
    cleaned.items = cleaned.items.map(normalizeMenuItem).filter(Boolean);
  }
  return sortValue({ ...cleaned, name });
}

function normalizeNamedItem(item, kind, index, maps = {}) {
  if (kind === "settings") return normalizeSetting(item, index, maps);
  if (kind === "menu") return normalizeMenu(item, index, maps);

  const source = resolveStableReferences(item || {}, maps);
  const name = kind === "roles" && source.role ? source.role : portableName(source, kind.replace(/s$/, ""), index);
  const cleaned = stripUnsafeValues(source);
  const normalized = { ...cleaned, name };

  if (typeof normalized.viewtemplate === "object") normalized.viewtemplate = stripUnsafeValues(normalized.viewtemplate);

  // viewtemplateObj is an enriched runtime object added by Saltcorn on export,
  // not a stored column. Strip it to avoid DB errors on apply.
  // singleton is a virtual property some view templates inject.
  delete normalized.viewtemplateObj;
  delete normalized.singleton;

  if (kind === "tables" && Array.isArray(normalized.fields)) {
    normalized.fields = normalized.fields
      .map((field, fieldIndex) => {
        const nf = normalizeNamedItem(field, "fields", fieldIndex, maps);
        delete nf.table_name;
        // Collapse expanded type object to name string
        if (nf.type && typeof nf.type === "object") nf.type = nf.type.name || nf.type.sql_name || String(nf.type);
        return nf;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return sortValue(normalized);
}

function normalizeCollection(items = [], kind, maps = {}) {
  return coerceCollection(items, kind)
    .map((item, index) => normalizeNamedItem(item, kind, index, maps))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function normalizeProjectExport(input = {}) {
  const maps = buildReferenceMaps(input);
  const out = {};
  for (const kind of VERSIONED_KINDS) {
    out[kind] = normalizeCollection(input[kind] || [], kind, maps);
  }
  if (input.plugins) {
    out.plugins = normalizeCollection(input.plugins, "plugins", maps);
  }
  if (input.reference_data && typeof input.reference_data === "object") {
    out.reference_data = stripUnsafeValues(resolveStableReferences(input.reference_data, maps));
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
    settings: root.settings || root.Setting || root.config || root.Config || [],
    plugins: root.plugins || root.Plugin || [],
    reference_data: root.reference_data || root.referenceData || {},
  });
}

module.exports = {
  VERSIONED_KINDS,
  SECRET_KEY_PATTERN,
  VOLATILE_KEY_PATTERN,
  NOISY_METADATA_KEY_PATTERN,
  TENANT_LOCAL_ID_PATTERN,
  stripUnsafeValues,
  resolveStableReferences,
  buildReferenceMaps,
  normalizeNamedItem,
  normalizeCollection,
  normalizeProjectExport,
  normalizePack,
};
