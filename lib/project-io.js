const fs = require("node:fs");
const path = require("node:path");
const { canonicalStringify, parseJson } = require("./canonical-json");

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

function stripObjectNoise(obj, kind) {
  for (const key of PROJECT_OBJECT_NOISE) delete obj[key];
  for (const key of PER_KIND_NOISE[kind] || []) delete obj[key];
  // Strip table_name from nested fields
  if (kind === "tables" && Array.isArray(obj.fields)) {
    for (const field of obj.fields) delete field.table_name;
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
      const obj = readJsonIfExists(path.join(dir, file));
      return obj ? stripObjectNoise(obj, kind) : obj;
    });
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
};
