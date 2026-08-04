const path = require("node:path");
const { VERSIONED_KINDS } = require("./normalizer");
const { deduplicateSafeFileNames, writeCanonicalJson } = require("./project-io");

function writeProjectExport(projectDir, projectExport) {
  const written = [];
  for (const kind of VERSIONED_KINDS) {
    const items = projectExport[kind] || [];
    const safeNames = deduplicateSafeFileNames(items.map((item) => item.name));
    for (let i = 0; i < items.length; i++) {
      const file = path.join(projectDir, "objects", kind, `${safeNames[i]}.json`);
      writeCanonicalJson(file, items[i]);
      written.push(file);
    }
  }

  if (Array.isArray(projectExport.plugins)) {
    const raw = projectExport.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version || plugin.package_version || null,
      source: plugin.source || "unknown",
      // location is the npm package name / install target (e.g. "@saltcorn/json").
      // It differs from name (the local identifier "json") and is REQUIRED by
      // Plugin.loadAndSaveNewPlugin to install the package on a remote tenant.
      location: plugin.location || undefined,
    }));
    // Deduplicate by name — Saltcorn may report the same plugin twice
    // (e.g. "latest" + specific version). Prefer the specific version.
    const seen = new Map();
    for (const p of raw) {
      const existing = seen.get(p.name);
      if (!existing) {
        seen.set(p.name, p);
      } else if (existing.version === "latest" && p.version && p.version !== "latest") {
        seen.set(p.name, p);
      }
    }
    const plugins = [...seen.values()];
    const file = path.join(projectDir, "plugins.lock.json");
    writeCanonicalJson(file, { plugins });
    written.push(file);
  }

  return written;
}

module.exports = { writeProjectExport };
