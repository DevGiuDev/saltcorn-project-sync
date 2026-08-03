const path = require("node:path");
const { readJsonIfExists } = require("./project-io");

const FORBIDDEN_ENV_KEYS = /(secret|password|token|api[_-]?key|private[_-]?key|credential|bearer|authorization|auth[_-]?key|access[_-]?key|refresh[_-]?key|session[_-]?key)/i;
const REFERENCE_KEY = /(?:_env|_ref)$/i;
const ADAPTERS = new Set(["native", "rest", "command"]);
const TRANSPORTS = new Set(["direct", "ssh"]);

const PROCESS_FIELDS = {
  adapter: "SALTCORN_PROJECT_SYNC_ADAPTER",
  base_url: "SALTCORN_PROJECT_SYNC_BASE_URL",
  transport: "SALTCORN_PROJECT_SYNC_TRANSPORT",
  repository: "SALTCORN_PROJECT_SYNC_REPOSITORY",
  branch: "SALTCORN_PROJECT_SYNC_BRANCH",
  tenant: "SALTCORN_PROJECT_SYNC_TENANT",
  token_env: "SALTCORN_PROJECT_SYNC_TOKEN_ENV",
  backup_hook_env: "SALTCORN_PROJECT_SYNC_BACKUP_HOOK_ENV",
  restore_hook_env: "SALTCORN_PROJECT_SYNC_RESTORE_HOOK_ENV",
  ssh_host: "SALTCORN_PROJECT_SYNC_SSH_HOST",
  ssh_user: "SALTCORN_PROJECT_SYNC_SSH_USER",
  ssh_port: "SALTCORN_PROJECT_SYNC_SSH_PORT",
  ssh_local_port: "SALTCORN_PROJECT_SYNC_SSH_LOCAL_PORT",
  ssh_remote_host: "SALTCORN_PROJECT_SYNC_SSH_REMOTE_HOST",
  ssh_remote_port: "SALTCORN_PROJECT_SYNC_SSH_REMOTE_PORT",
  ssh_identity_file: "SALTCORN_PROJECT_SYNC_SSH_IDENTITY_FILE",
  backup_policy: "SALTCORN_PROJECT_SYNC_BACKUP_POLICY",
};

function loadEnvironment(projectDir = process.cwd(), env = "dev") {
  return readJsonIfExists(path.join(projectDir, "environments", `${env}.json`), { environment: env });
}

function validateEnvironmentConfig(config = {}) {
  const errors = [];
  function walk(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_ENV_KEYS.test(key) && !REFERENCE_KEY.test(key)) {
        errors.push(`${full} looks like a secret and must not be committed`);
      }
      if (value && typeof value === "object") walk(value, full);
    }
  }
  walk(config);
  if (config.adapter && !ADAPTERS.has(config.adapter)) errors.push(`adapter must be one of: ${Array.from(ADAPTERS).join(", ")}`);
  if (config.transport && !TRANSPORTS.has(config.transport)) errors.push(`transport must be one of: ${Array.from(TRANSPORTS).join(", ")}`);
  if (config.backup_policy && !["optional", "required"].includes(config.backup_policy)) errors.push("backup_policy must be optional or required");
  if (config.base_url) {
    try {
      const url = new URL(config.base_url);
      const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      if (url.username || url.password) errors.push("base_url must not contain credentials");
      if (url.protocol !== "https:" && !local) errors.push("base_url must use HTTPS outside localhost");
    } catch (_err) {
      errors.push("base_url must be a valid absolute URL");
    }
  }
  if (config.transport === "ssh" && !(config.ssh_host || config.transport_options?.host)) {
    errors.push("ssh_host is required for SSH transport");
  }
  return { valid: errors.length === 0, errors };
}

function flattenConfig(config = {}) {
  const transport = config.transport_options || {};
  return {
    ...config,
    ssh_host: config.ssh_host || transport.host,
    ssh_user: config.ssh_user || transport.user,
    ssh_port: config.ssh_port || transport.port,
    ssh_local_port: config.ssh_local_port || transport.local_port,
    ssh_remote_host: config.ssh_remote_host || transport.remote_host,
    ssh_remote_port: config.ssh_remote_port || transport.remote_port,
    ssh_identity_file: config.ssh_identity_file || transport.identity_file,
  };
}

function resolveEnvironmentConfig({ projectDir = process.cwd(), env = "dev", uiConfig = {}, defaults = {}, processEnv = process.env } = {}) {
  const profile = flattenConfig(loadEnvironment(projectDir, env));
  const ui = flattenConfig(uiConfig);
  const config = { environment: env };
  const sources = { environment: "command" };

  for (const field of Object.keys(PROCESS_FIELDS)) {
    if (defaults[field] !== undefined && defaults[field] !== "") {
      config[field] = defaults[field];
      sources[field] = "built_in_default";
    }
    if (ui[field] !== undefined && ui[field] !== "") {
      config[field] = ui[field];
      sources[field] = "project_ui";
    }
    if (profile[field] !== undefined && profile[field] !== "") {
      config[field] = profile[field];
      sources[field] = "environment_profile";
    }
    const processKey = PROCESS_FIELDS[field];
    if (processEnv[processKey] !== undefined && processEnv[processKey] !== "") {
      config[field] = processEnv[processKey];
      sources[field] = "process_environment";
    }
  }

  // Existing standard variables are also authoritative process settings.
  if (processEnv.SALTCORN_BASE_URL && !processEnv.SALTCORN_PROJECT_SYNC_BASE_URL) {
    config.base_url = processEnv.SALTCORN_BASE_URL;
    sources.base_url = "process_environment";
  }
  if (processEnv.SALTCORN_PROJECT_SYNC_API_TOKEN) sources.api_token = "process_environment";

  return { config, sources, profile, validation: validateEnvironmentConfig(config) };
}

function activateEnvironmentConfig(resolved, processEnv = process.env) {
  const config = resolved?.config || {};
  for (const [field, processKey] of Object.entries(PROCESS_FIELDS)) {
    if (!processEnv[processKey] && config[field] !== undefined && config[field] !== "") {
      processEnv[processKey] = String(config[field]);
    }
  }
  processEnv.SALTCORN_PROJECT_SYNC_ENV = String(config.environment || "dev");

  // Secret and command references are resolved at runtime; their values never
  // enter the profile or the resolved public configuration.
  const tokenRef = config.token_env;
  const backupRef = config.backup_hook_env;
  const restoreRef = config.restore_hook_env;
  if (!processEnv.SALTCORN_PROJECT_SYNC_API_TOKEN && tokenRef && processEnv[tokenRef]) {
    processEnv.SALTCORN_PROJECT_SYNC_API_TOKEN = processEnv[tokenRef];
  }
  if (!processEnv.SALTCORN_PROJECT_SYNC_BACKUP_CMD && backupRef && processEnv[backupRef]) {
    processEnv.SALTCORN_PROJECT_SYNC_BACKUP_CMD = processEnv[backupRef];
  }
  if (!processEnv.SALTCORN_PROJECT_SYNC_RESTORE_CMD && restoreRef && processEnv[restoreRef]) {
    processEnv.SALTCORN_PROJECT_SYNC_RESTORE_CMD = processEnv[restoreRef];
  }
  return resolved;
}

function applyEnvironmentOverlay(state, overlay = {}) {
  const next = JSON.parse(JSON.stringify(state));
  if (overlay.settings) next.settings = { ...(next.settings || {}), ...overlay.settings };
  if (overlay.plugins) next.plugins_overlay = overlay.plugins;
  return next;
}

module.exports = {
  FORBIDDEN_ENV_KEYS,
  PROCESS_FIELDS,
  ADAPTERS,
  TRANSPORTS,
  loadEnvironment,
  validateEnvironmentConfig,
  resolveEnvironmentConfig,
  activateEnvironmentConfig,
  applyEnvironmentOverlay,
};
