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
    const plugins = projectExport.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version || plugin.package_version || null,
      source: plugin.source || "unknown",
    }));
    const file = path.join(projectDir, "plugins.lock.json");
    writeCanonicalJson(file, { plugins });
    written.push(file);
  }

  return written;
}

module.exports = { writeProjectExport };
