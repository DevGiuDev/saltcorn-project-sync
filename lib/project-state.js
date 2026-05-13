const { VERSIONED_KINDS, normalizeProjectExport } = require("./normalizer");
const path = require("node:path");
const { loadObjectCollection, readJsonIfExists } = require("./project-io");
const { loadReferenceData } = require("./reference-data");

function loadProjectState(projectDir = process.cwd()) {
  const state = VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = loadObjectCollection(projectDir, kind);
    return acc;
  }, {});
  state.reference_data = loadReferenceData(projectDir);
  state.plugins = (readJsonIfExists(path.join(projectDir, "plugins.lock.json"), { plugins: [] }).plugins || []);
  return state;
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
