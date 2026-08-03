const { validateEnvironmentConfig } = require("../environment");
const { optionalRequire } = require("../tenant-adapters");

const TABLE = "_sc_ps_environment_configs";
const ALLOWED_FIELDS = new Set([
  "adapter", "base_url", "transport", "repository", "branch", "tenant",
  "token_env", "backup_hook_env", "restore_hook_env",
  "ssh_host", "ssh_user", "ssh_port", "ssh_local_port", "ssh_remote_host",
  "ssh_remote_port", "ssh_identity_file",
  "backup_policy",
  "ui_mode",
]);

function getDb() {
  return optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
}

async function ensureOperationalConfigTable(db = getDb()) {
  await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES _sc_ps_projects(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, environment)
  )`);
}

function normalizeEnvironmentName(value) {
  const env = String(value || "dev").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(env)) throw new Error("invalid environment name");
  return env;
}

function normalizeOperationalConfig(input = {}) {
  const result = {};
  for (const field of ALLOWED_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") continue;
    const value = String(input[field]).trim();
    if (value.length > 2048 || /[\0\r\n]/.test(value)) throw new Error(`${field} contains an invalid value`);
    result[field] = value;
  }
  const validation = validateEnvironmentConfig(result);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return result;
}

async function getOperationalConfig(projectId, environment = "dev", db = getDb()) {
  await ensureOperationalConfigTable(db);
  const env = normalizeEnvironmentName(environment);
  const result = await db.query(`SELECT project_id, environment, config_json, created_at, updated_at FROM ${TABLE} WHERE project_id = $1 AND environment = $2`, [projectId, env]);
  const row = (result.rows || result)[0];
  return row ? { ...row.config_json, environment: row.environment, project_id: row.project_id, updated_at: row.updated_at } : { environment: env, project_id: Number(projectId) };
}

async function saveOperationalConfig(projectId, environment, input, db = getDb()) {
  await ensureOperationalConfigTable(db);
  const env = normalizeEnvironmentName(environment);
  const config = normalizeOperationalConfig(input);
  const result = await db.query(
    `INSERT INTO ${TABLE} (project_id, environment, config_json)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (project_id, environment) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = now()
     RETURNING project_id, environment, config_json, updated_at`,
    [projectId, env, JSON.stringify(config)]
  );
  const row = (result.rows || result)[0];
  return { ...row.config_json, environment: row.environment, project_id: row.project_id, updated_at: row.updated_at };
}

async function listOperationalEnvironments(projectId, db = getDb()) {
  await ensureOperationalConfigTable(db);
  const result = await db.query(`SELECT environment FROM ${TABLE} WHERE project_id = $1 ORDER BY environment`, [projectId]);
  return (result.rows || result).map((row) => row.environment);
}

async function activateOperationalConfig(projectId, environment = "dev", db = getDb()) {
  const projectSetup = require("../project-setup");
  const project = await projectSetup.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const uiConfig = await getOperationalConfig(projectId, environment, db);
  const { resolveEnvironmentConfig, activateEnvironmentConfig } = require("../environment");
  const resolved = resolveEnvironmentConfig({ projectDir: project.root_path || process.cwd(), env: environment, uiConfig });
  if (!resolved.validation.valid) throw new Error(resolved.validation.errors.join("; "));
  activateEnvironmentConfig(resolved);
  return resolved;
}

module.exports = {
  TABLE,
  ALLOWED_FIELDS,
  ensureOperationalConfigTable,
  normalizeEnvironmentName,
  normalizeOperationalConfig,
  getOperationalConfig,
  saveOperationalConfig,
  listOperationalEnvironments,
  activateOperationalConfig,
};
