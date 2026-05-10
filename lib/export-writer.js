const path = require("node:path");
const { VERSIONED_KINDS } = require("./normalizer");
const { safeFileName, writeCanonicalJson } = require("./project-io");

function writeProjectExport(projectDir, projectExport) {
  const written = [];
  for (const kind of VERSIONED_KINDS) {
    for (const item of projectExport[kind] || []) {
      const file = path.join(projectDir, "objects", kind, `${safeFileName(item.name)}.json`);
      writeCanonicalJson(file, item);
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
