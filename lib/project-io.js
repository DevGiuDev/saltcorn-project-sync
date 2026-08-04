const fs = require("node:fs");
const path = require("node:path");
const { canonicalStringify, parseJson } = require("./canonical-json");
const { normalizeFieldDef } = require("./normalizer");

const OBJECT_DIRS = ["tables", "views", "pages", "triggers", "roles", "menu", "settings"];

function ensureProjectDirs(projectDir) {
  for (const dir of [
    "objects",
    ...OBJECT_DIRS.map((name) => path.join("objects", name)),
    path.join("objects", "data", "reference_tables"),
    "environments",
    "changes",
    "seeds",
    "migrations",
  ]) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
}

/**
 * Transliterate Unicode text to ASCII by stripping diacritics.
 * Uses NFD decomposition then removes combining marks (category M).
 * Handles: é→e, ñ→n, ü→u, ç→c, etc.
 */
function transliterate(str) {
  return String(str).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function safeFileName(name) {
  return transliterate(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Resolve potential filename collisions by appending `_2`, `_3`, etc.
 * @param {string[]} names - list of raw names to generate filenames for
 * @returns {string[]} list of unique safe filenames in the same order
 */
function deduplicateSafeFileNames(names) {
  const result = [];
  const seen = new Map(); // safeName → count of occurrences
  for (const name of names) {
    let safe = safeFileName(name);
    const count = (seen.get(safe) || 0) + 1;
    seen.set(safe, count);
    if (count > 1) {
      // First occurrence also gets renamed so it stays consistent
      if (count === 2) {
        const firstIdx = result.findIndex((r) => r === safe);
        if (firstIdx !== -1) result[firstIdx] = `${safe}_1`;
      }
      result.push(`${safe}_${count}`);
    } else {
      result.push(safe);
    }
  }
  return result;
}

function writeCanonicalJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canonicalStringify(value));
}

function readJsonIfExists(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return parseJson(fs.readFileSync(file, "utf8"), file);
}

const PROJECT_OBJECT_NOISE = ["viewtemplateObj", "singleton"];

const PER_KIND_NOISE = {
  views: [],
  tables: [],
};

const TABLE_NOISE_KEYS = new Set([
  "has_sync_info", "is_user_group", "external", "versioned",
  "composite_pk_names", "ownership_field_id", "ownership_formula",
]);

function stripObjectNoise(obj, kind) {
  for (const key of PROJECT_OBJECT_NOISE) delete obj[key];
  for (const key of PER_KIND_NOISE[kind] || []) delete obj[key];
  if (kind === "tables") {
    // Strip table-level noise
    for (const key of TABLE_NOISE_KEYS) delete obj[key];
    // Collapse expanded pk_type object to just the name string
    if (obj.pk_type && typeof obj.pk_type === "object") obj.pk_type = obj.pk_type.name || obj.pk_type.sql_name || String(obj.pk_type);
    // Clean fields
    if (Array.isArray(obj.fields)) {
      obj.fields = obj.fields.map(normalizeFieldDef);
    }
  }
  return obj;
}

function loadObjectCollection(projectDir, kind) {
  const dir = path.join(projectDir, "objects", kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      try {
        const obj = readJsonIfExists(path.join(dir, file));
        return obj ? stripObjectNoise(obj, kind) : obj;
      } catch (err) {
        console.warn(`[scps] Skipping malformed ${kind}/${file}: ${err.message}`);
        return null;
      }
    })
    .filter((obj) => obj !== null);
}

/**
 * Adopt (merge) a single object from live tenant into the project disk files.
 *
 * Modes:
 * - Full adopt: writes the liveObj as-is, replacing the disk file.
 * - Selective adopt: merges only the specified properties from liveObj
 *   into the existing disk object.
 *
 * @param {string} projectDir - Root project directory
 * @param {string} kind - Object type (tables, views, pages, triggers, roles)
 * @param {object} liveObj - Normalized live object (from export)
 * @param {string[]} [properties] - If provided, only merge these keys; otherwise adopt full object
 * @returns {{ file, mode, adopted_keys }}
 */
function pullObjectToDisk(projectDir, kind, liveObj, properties) {
  const name = liveObj.name || liveObj.role;
  if (!name) throw new Error("pullObjectToDisk: object has no name");

  const objDir = path.join(projectDir, "objects", kind);
  ensureProjectDirs(projectDir);

  const safeName = safeFileName(name) + ".json";
  const filePath = path.join(objDir, safeName);

  if (properties && properties.length > 0) {
    // Selective merge — read existing, overlay specified properties
    const existing = readJsonIfExists(filePath);
    if (!existing) throw new Error(`Cannot selectively pull: disk file not found for ${kind}/${name}`);
    const merged = { ...existing };
    for (const key of properties) {
      if (liveObj[key] !== undefined) {
        merged[key] = liveObj[key];
      } else {
        delete merged[key];
      }
    }
    writeCanonicalJson(filePath, merged);
    return { file: filePath, mode: "selective", adopted_keys: properties };
  } else {
    // Full adopt — write liveObj directly
    // Strip noise before writing (same as stripObjectNoise for consistency)
    const cleaned = stripObjectNoise({ ...liveObj }, kind);
    writeCanonicalJson(filePath, cleaned);
    return { file: filePath, mode: "full", adopted_keys: Object.keys(cleaned).filter((k) => k !== "name" && k !== "role") };
  }
}

/**
 * Adopt (upsert) a single plugin into plugins.lock.json.
 *
 * Plugins live in plugins.lock.json (read by loadProjectState), not under
 * objects/plugins/. This mirrors the writePluginLock shape used by the bulk
 * routes and the CLI export. The canonical plugin lock keys are name, version,
 * source, and location — the last is the npm package name / install target,
 * needed by Plugin.loadAndSaveNewPlugin to install on a remote tenant.
 *
 * Modes:
 * - Full adopt: replaces the plugin entry with {name, version, source, location}.
 * - Selective adopt: merges only the specified properties (e.g. ["version"])
 *   into the existing entry.
 *
 * @param {string} projectDir - Root project directory
 * @param {object} liveObj - Normalized live plugin (from export)
 * @param {string[]} [properties] - If provided, only merge these keys
 * @returns {{ file, mode, adopted_keys }}
 */
function pullPluginToLock(projectDir, liveObj, properties) {
  const name = liveObj.name;
  if (!name) throw new Error("pullPluginToLock: plugin has no name");

  const lockPath = path.join(projectDir, "plugins.lock.json");
  const lock = readJsonIfExists(lockPath, { plugins: [] });
  const plugins = Array.isArray(lock.plugins) ? lock.plugins : [];
  const idx = plugins.findIndex((p) => p.name === name);

  const liveEntry = {
    name,
    version: liveObj.version || liveObj.package_version || null,
    source: liveObj.source || "unknown",
    location: liveObj.location || liveObj.name,
  };

  if (properties && properties.length > 0) {
    // Selective merge — overlay only the requested keys onto the existing entry
    const existing = idx >= 0 ? plugins[idx] : { name };
    const merged = { ...existing };
    for (const key of properties) {
      if (liveEntry[key] !== undefined) {
        merged[key] = liveEntry[key];
      } else {
        delete merged[key];
      }
    }
    // Keep only the canonical plugin lock keys
    const cleaned = { name: merged.name };
    if (merged.version !== undefined) cleaned.version = merged.version;
    if (merged.source !== undefined) cleaned.source = merged.source;
    if (merged.location !== undefined) cleaned.location = merged.location;
    if (idx >= 0) plugins[idx] = cleaned;
    else plugins.push(cleaned);
    writeCanonicalJson(lockPath, { plugins });
    return { file: lockPath, mode: "selective", adopted_keys: properties };
  }

  if (idx >= 0) plugins[idx] = liveEntry;
  else plugins.push(liveEntry);
  writeCanonicalJson(lockPath, { plugins });
  return { file: lockPath, mode: "full", adopted_keys: ["version", "source", "location"] };
}

/**
 * Remove a single object's JSON file from disk.
 *
 * Inverse of pullObjectToDisk: used to confirm a deletion that already
 * happened in the live tenant, so the object stops appearing as drift.
 * Idempotent — returns removed:false if the file was already gone.
 *
 * @param {string} projectDir - Root project directory
 * @param {string} kind - Object type (tables, views, pages, triggers, roles)
 * @param {string} name - Object name
 * @returns {{ file, removed }}
 */
function deleteObjectFromDisk(projectDir, kind, name) {
  if (!name) throw new Error("deleteObjectFromDisk: object has no name");
  const filePath = path.join(projectDir, "objects", kind, safeFileName(name) + ".json");
  if (!fs.existsSync(filePath)) return { file: filePath, removed: false };
  fs.unlinkSync(filePath);
  return { file: filePath, removed: true };
}

module.exports = {
  OBJECT_DIRS,
  ensureProjectDirs,
  transliterate,
  safeFileName,
  deduplicateSafeFileNames,
  writeCanonicalJson,
  readJsonIfExists,
  loadObjectCollection,
  pullObjectToDisk,
  pullPluginToLock,
  deleteObjectFromDisk,
  stripObjectNoise,
};
