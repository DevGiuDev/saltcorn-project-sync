/**
 * Migration ledger — tracks which migrations have been applied per project
 * and environment, so a migration with run: "once" never re-executes.
 *
 * Table: _sc_ps_migrations_applied
 *
 * Follows the same pattern as lib/plugin/deployment-ledger.js: a WeakMap
 * caches per-schema initialization, both SQLite and Postgres are supported,
 * and the Saltcorn db module is loaded lazily via optionalRequireOrNull so
 * the module remains importable from the CLI (where no Saltcorn runtime is
 * present).
 */

const { optionalRequireOrNull } = require("./tenant-adapters");

const TABLE = "_sc_ps_migrations_applied";
const initialized = new WeakMap();

function ledgerDb() {
  const db = optionalRequireOrNull(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
  if (!db || typeof db.query !== "function") {
    const error = new Error("Saltcorn database module is unavailable; migration ledger cannot be used");
    error.code = "MIGRATION_LEDGER_UNAVAILABLE";
    throw error;
  }
  return db;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tenantSchema(db) {
  if (db.isSQLite) return "";
  if (typeof db.getTenantSchema === "function") return db.getTenantSchema() || "public";
  return db.connectObj?.default_schema || "public";
}

function tableRef(db) {
  const schema = tenantSchema(db);
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(TABLE)}` : quoteIdentifier(TABLE);
}

function initializedSchemas(db) {
  let schemas = initialized.get(db);
  if (!schemas) {
    schemas = new Set();
    initialized.set(db, schemas);
  }
  return schemas;
}

async function ensureLedger(db = ledgerDb()) {
  const schema = tenantSchema(db) || "sqlite";
  const seen = initializedSchemas(db);
  if (seen.has(schema)) return { db, table: tableRef(db), schema };

  const table = tableRef(db);
  if (db.isSQLite) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      environment TEXT NOT NULL,
      migration_name TEXT NOT NULL,
      migration_hash TEXT NOT NULL,
      phase TEXT,
      status TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deployment_id TEXT,
      error TEXT,
      UNIQUE(project, environment, migration_name)
    )`);
  } else {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project TEXT NOT NULL,
      environment TEXT NOT NULL,
      migration_name TEXT NOT NULL,
      migration_hash TEXT NOT NULL,
      phase TEXT,
      status TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deployment_id TEXT,
      error TEXT,
      CONSTRAINT ${quoteIdentifier(`${TABLE}_uniq`)} UNIQUE (project, environment, migration_name)
    )`);
  }
  await db.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${TABLE}_project_env_idx`)} ON ${table} (project, environment)`);
  seen.add(schema);
  return { db, table, schema };
}

function normalizeProject(project) {
  return String(project || "default");
}

function normalizeEnvironment(env) {
  return String(env || "dev");
}

async function isApplied(project, env, migrationName, db = ledgerDb()) {
  await ensureLedger(db);
  const table = tableRef(db);
  const rows = await db.query(
    `SELECT 1 FROM ${table} WHERE project = $1 AND environment = $2 AND migration_name = $3 AND status = 'applied' LIMIT 1`,
    [normalizeProject(project), normalizeEnvironment(env), String(migrationName)]
  );
  const list = rows && rows.rows ? rows.rows : rows;
  return Array.isArray(list) && list.length > 0;
}

async function recordApplied(project, env, migration, deploymentId = null, db = ledgerDb()) {
  await ensureLedger(db);
  const table = tableRef(db);
  const { migrationIdentity } = require("./seeds");
  const name = String(migration.name);
  const hash = migrationIdentity(migration);
  const phase = migration.phase || "manual";
  const pg = normalizeProject(project);
  const environ = normalizeEnvironment(env);
  // Upsert: if a row already exists (e.g. failed then retried), mark applied.
  const existing = await db.query(
    `SELECT id FROM ${table} WHERE project = $1 AND environment = $2 AND migration_name = $3`,
    [pg, environ, name]
  );
  const existingRows = existing && existing.rows ? existing.rows : existing;
  if (Array.isArray(existingRows) && existingRows.length) {
    await db.query(
      `UPDATE ${table} SET status = 'applied', migration_hash = $1, phase = $2, deployment_id = $3, error = NULL, applied_at = CURRENT_TIMESTAMP WHERE project = $4 AND environment = $5 AND migration_name = $6`,
      [hash, phase, deploymentId, pg, environ, name]
    );
    return { recorded: true, updated: true, migration_name: name };
  }
  await db.query(
    `INSERT INTO ${table} (project, environment, migration_name, migration_hash, phase, status, deployment_id) VALUES ($1, $2, $3, $4, $5, 'applied', $6)`,
    [pg, environ, name, hash, phase, deploymentId]
  );
  return { recorded: true, updated: false, migration_name: name };
}

async function recordFailed(project, env, migration, error, deploymentId = null, db = ledgerDb()) {
  await ensureLedger(db);
  const table = tableRef(db);
  const { migrationIdentity } = require("./seeds");
  const name = String(migration.name);
  const hash = migrationIdentity(migration);
  const phase = migration.phase || "manual";
  const pg = normalizeProject(project);
  const environ = normalizeEnvironment(env);
  const message = error && error.message ? error.message : String(error || "unknown error");
  const existing = await db.query(
    `SELECT id FROM ${table} WHERE project = $1 AND environment = $2 AND migration_name = $3`,
    [pg, environ, name]
  );
  const existingRows = existing && existing.rows ? existing.rows : existing;
  if (Array.isArray(existingRows) && existingRows.length) {
    await db.query(
      `UPDATE ${table} SET status = 'failed', migration_hash = $1, phase = $2, deployment_id = $3, error = $4, applied_at = CURRENT_TIMESTAMP WHERE project = $5 AND environment = $6 AND migration_name = $7`,
      [hash, phase, deploymentId, message, pg, environ, name]
    );
    return { recorded: true, updated: true, migration_name: name };
  }
  await db.query(
    `INSERT INTO ${table} (project, environment, migration_name, migration_hash, phase, status, deployment_id, error) VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`,
    [pg, environ, name, hash, phase, deploymentId, message]
  );
  return { recorded: true, updated: false, migration_name: name };
}

async function listApplied(project, env, db = ledgerDb()) {
  await ensureLedger(db);
  const table = tableRef(db);
  const rows = await db.query(
    `SELECT migration_name, migration_hash, phase, status, applied_at, deployment_id, error FROM ${table} WHERE project = $1 AND environment = $2 ORDER BY applied_at`,
    [normalizeProject(project), normalizeEnvironment(env)]
  );
  const list = rows && rows.rows ? rows.rows : rows;
  return Array.isArray(list) ? list : [];
}

/**
 * Return the subset of migrations that have not yet been applied (status
 * applied) for the given project/environment. Migrations are matched by name.
 */
async function filterPending(project, env, migrations = [], db = ledgerDb()) {
  const applied = await listApplied(project, env, db);
  const appliedNames = new Set(
    applied.filter((row) => row.status === "applied").map((row) => row.migration_name)
  );
  return migrations.filter((entry) => {
    const name = entry && entry.migration ? entry.migration.name : entry && entry.name;
    return name && !appliedNames.has(String(name));
  });
}

/**
 * Drop the ledger table. Used by tests to reset state between runs.
 */
async function resetLedger(db = ledgerDb()) {
  try {
    await ensureLedger(db);
  } catch (_err) {
    // Table may not exist yet; ignore.
  }
  const table = tableRef(db);
  await db.query(`DELETE FROM ${table}`);
  const schema = tenantSchema(db) || "sqlite";
  initializedSchemas(db).delete(schema);
}

module.exports = {
  ensureLedger,
  isApplied,
  recordApplied,
  recordFailed,
  listApplied,
  filterPending,
  resetLedger,
  // Exposed for testing / diagnostics
  tableRef,
  tenantSchema,
};
