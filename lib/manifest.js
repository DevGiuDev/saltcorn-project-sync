const fs = require("node:fs");
const path = require("node:path");
const { parseJson } = require("./canonical-json");

const MANIFEST_FILE = "saltcorn.project.json";
const CURRENT_FORMAT_VERSION = 1;

function defaultManifest({ name = "saltcorn-project", slug = "saltcorn-project" } = {}) {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    slug,
    saltcorn: {
      min_version: null,
      tested_versions: [],
    },
    objects: {
      tables: [],
      views: [],
      pages: [],
      triggers: [],
      roles: [],
    },
    excluded: {
      users: true,
      sessions: true,
      logs: true,
      transactional_data: true,
      secrets: true,
    },
  };
}

function loadManifest(projectDir = process.cwd()) {
  const file = path.join(projectDir, MANIFEST_FILE);
  return parseJson(fs.readFileSync(file, "utf8"), file);
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") errors.push("manifest must be an object");
  if (!manifest.name) errors.push("name is required");
  if (!manifest.slug) errors.push("slug is required");
  if (manifest.format_version !== CURRENT_FORMAT_VERSION) {
    errors.push(`format_version must be ${CURRENT_FORMAT_VERSION}`);
  }
  if (!manifest.objects || typeof manifest.objects !== "object") {
    errors.push("objects section is required");
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  MANIFEST_FILE,
  CURRENT_FORMAT_VERSION,
  defaultManifest,
  loadManifest,
  validateManifest,
};
