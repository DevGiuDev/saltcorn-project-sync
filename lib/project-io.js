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
  ]) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
}

function safeFileName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function writeCanonicalJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canonicalStringify(value));
}

function readJsonIfExists(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return parseJson(fs.readFileSync(file, "utf8"), file);
}

function loadObjectCollection(projectDir, kind) {
  const dir = path.join(projectDir, "objects", kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJsonIfExists(path.join(dir, file)));
}

module.exports = {
  OBJECT_DIRS,
  ensureProjectDirs,
  safeFileName,
  writeCanonicalJson,
  readJsonIfExists,
  loadObjectCollection,
};
