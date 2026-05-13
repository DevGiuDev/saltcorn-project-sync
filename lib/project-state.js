const { VERSIONED_KINDS, normalizeProjectExport, normalizePack } = require("./normalizer");
const path = require("node:path");
const { loadObjectCollection, readJsonIfExists } = require("./project-io");
const { loadReferenceData } = require("./reference-data");

function loadProjectState(projectDir = process.cwd()) {
  const raw = VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = loadObjectCollection(projectDir, kind);
    return acc;
  }, {});
  raw.reference_data = loadReferenceData(projectDir);
  raw.plugins = (readJsonIfExists(path.join(projectDir, "plugins.lock.json"), { plugins: [] }).plugins || []);
  // Normalize so that disk state uses the same canonical form as live exports
  return normalizePack(raw);
}

function normalizeTenantState(raw = {}) {
  return normalizeProjectExport(raw);
}

function findByName(items = [], name) {
  return items.find((item) => item.name === name);
}

function upsertByName(items = [], item) {
  const idx = items.findIndex((existing) => existing.name === item.name);
  if (idx === -1) return [...items, item].sort((a, b) => a.name.localeCompare(b.name));
  const next = items.slice();
  next[idx] = item;
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

function removeByName(items = [], name) {
  return items.filter((item) => item.name !== name);
}

module.exports = {
  loadProjectState,
  normalizeTenantState,
  findByName,
  upsertByName,
  removeByName,
};
