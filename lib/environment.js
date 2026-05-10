const path = require("node:path");
const { readJsonIfExists } = require("./project-io");

const FORBIDDEN_ENV_KEYS = /(secret|password|token|api[_-]?key|private[_-]?key|credential)/i;

function loadEnvironment(projectDir = process.cwd(), env = "dev") {
  return readJsonIfExists(path.join(projectDir, "environments", `${env}.json`), { environment: env });
}

function validateEnvironmentConfig(config = {}) {
  const errors = [];
  function walk(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_ENV_KEYS.test(key)) errors.push(`${full} looks like a secret and must not be committed`);
      if (value && typeof value === "object") walk(value, full);
    }
  }
  walk(config);
  return { valid: errors.length === 0, errors };
}

function applyEnvironmentOverlay(state, overlay = {}) {
  const next = JSON.parse(JSON.stringify(state));
  if (overlay.settings) next.settings = { ...(next.settings || {}), ...overlay.settings };
  if (overlay.plugins) next.plugins_overlay = overlay.plugins;
  return next;
}

module.exports = { FORBIDDEN_ENV_KEYS, loadEnvironment, validateEnvironmentConfig, applyEnvironmentOverlay };
