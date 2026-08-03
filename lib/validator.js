const fs = require("node:fs");
const path = require("node:path");
const { VERSIONED_KINDS } = require("./normalizer");
const { validateManifest, readVersionedScope } = require("./manifest");
const { validateChangeIntent } = require("./change-intents");
const { analyzeDependencies } = require("./dependencies");
const { validateEnvironmentConfig, loadEnvironment } = require("./environment");
const { loadProjectState } = require("./project-state");
const { readJsonIfExists } = require("./project-io");

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}

function validateProjectFiles(projectDir = process.cwd(), manifest, intents = []) {
  const errors = [];
  const warnings = [];
  const state = loadProjectState(projectDir);

  for (const kind of VERSIONED_KINDS) {
    const names = (state[kind] || []).map((item) => item.name);
    for (const name of duplicates(names)) errors.push(`${kind}: duplicate object name ${name}`);
    for (const item of state[kind] || []) {
      if (!item.name) errors.push(`${kind}: object without name`);
      if (kind === "tables") {
        const fieldNames = (item.fields || []).map((field) => field.name);
        for (const name of duplicates(fieldNames)) errors.push(`tables/${item.name}: duplicate field ${name}`);
        for (const field of item.fields || []) {
          if (!field.name) errors.push(`tables/${item.name}: field without name`);
          if (!field.type && !field.typename) warnings.push(`tables/${item.name}.${field.name}: field type missing`);
        }
      }
    }
  }

  const manifestObjects = manifest.objects || {};
  for (const kind of Object.keys(manifestObjects)) {
    if (!Array.isArray(manifestObjects[kind])) continue;
    const available = new Set((state[kind] || []).map((item) => item.name));
    for (const name of manifestObjects[kind]) {
      if (!available.has(name)) warnings.push(`manifest references ${kind}/${name}, but no object file exists yet`);
    }
  }

  try {
    const scope = readVersionedScope(manifest);
    if (scope) {
      for (const [kind, names] of Object.entries(scope.objects)) {
        const available = new Set((state[kind] || []).map((item) => item.name || item.role));
        for (const name of names) {
          if (!available.has(name)) errors.push(`manifest scope references ${kind}/${name}, but no project object exists`);
        }
      }
    }
  } catch (_error) {
    // validateManifest reports malformed scope once without duplicating it.
  }

  for (const ref of state.reference_data || []) {
    if (!ref.table) errors.push("reference data object without table");
    if (!Array.isArray(ref.rows)) errors.push(`reference data ${ref.table || "<unknown>"}: rows must be an array`);
    if (ref.table && !(state.tables || []).some((table) => table.name === ref.table)) {
      warnings.push(`reference data ${ref.table}: table is not present in project objects`);
    }
  }

  const depResult = analyzeDependencies(state);
  for (const dep of depResult.missing) {
    errors.push(`${dep.from.kind}/${dep.from.name} missing dependency ${dep.missing.kind}/${dep.missing.name}`);
  }

  for (const intent of intents) {
    const result = validateChangeIntent(intent);
    for (const error of result.errors) errors.push(`${intent.id || "<unknown>"}: ${error}`);
  }

  for (const env of ["local", "dev", "test", "prod"]) {
    const file = path.join(projectDir, "environments", `${env}.json`);
    if (fs.existsSync(file)) {
      const result = validateEnvironmentConfig(loadEnvironment(projectDir, env));
      for (const error of result.errors) errors.push(`${env}: ${error}`);
    }
  }

  const pluginLock = readJsonIfExists(path.join(projectDir, "plugins.lock.json"), { plugins: [] });
  if (!Array.isArray(pluginLock.plugins)) errors.push("plugins.lock.json: plugins must be an array");
  for (const plugin of pluginLock.plugins || []) {
    if (!plugin.name) errors.push("plugins.lock.json: plugin without name");
  }

  return { valid: errors.length === 0, errors, warnings, state };
}

function validateProject(projectDir, manifest, intents = []) {
  const manifestResult = validateManifest(manifest);
  const fileResult = validateProjectFiles(projectDir, manifest, intents);
  return {
    valid: manifestResult.valid && fileResult.valid,
    errors: [...manifestResult.errors, ...fileResult.errors],
    warnings: fileResult.warnings,
  };
}

module.exports = { duplicates, validateProjectFiles, validateProject };
