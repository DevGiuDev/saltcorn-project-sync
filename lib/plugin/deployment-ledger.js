const crypto = require("node:crypto");
const { canonicalStringify } = require("../canonical-json");
const { optionalRequireOrNull } = require("../tenant-adapters");

const TABLE = "_sc_ps_deployments";
const initialized = new WeakMap();

function deploymentDb() {
  const db = optionalRequireOrNull(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
  if (!db || typeof db.query !== "function") {
    const error = new Error("Saltcorn database module is unavailable; deployment ledger cannot be used");
    error.code = "DEPLOYMENT_LEDGER_UNAVAILABLE";
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

async function ensureDeploymentLedger(db = deploymentDb()) {
  const schema = tenantSchema(db) || "sqlite";
  const seen = initializedSchemas(db);
  if (seen.has(schema)) return { db, table: tableRef(db), schema };

  const table = tableRef(db);
  if (db.isSQLite) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      project TEXT,
      version TEXT,
      commit_sha TEXT,
      environment TEXT NOT NULL,
      status TEXT NOT NULL,
      operation_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      operation_summary TEXT NOT NULL DEFAULT '{}',
      warning_summary TEXT NOT NULL DEFAULT '{}',
      backup TEXT,
      convergence TEXT,
      error TEXT,
      rollback_of TEXT,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      record_hash TEXT NOT NULL
    )`);
  } else {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      deployment_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      project TEXT,
      version TEXT,
      commit_sha TEXT,
      environment TEXT NOT NULL,
      status TEXT NOT NULL,
      operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
      warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
      operation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      warning_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      backup JSONB,
      convergence JSONB,
      error TEXT,
      rollback_of TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      record_hash TEXT NOT NULL
    )`);
  }
  await db.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${TABLE}_recorded_at_idx`)} ON ${table} (recorded_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${TABLE}_project_env_idx`)} ON ${table} (project, environment, recorded_at DESC)`);
  seen.add(schema);
  return { db, table, schema };
}

function cleanText(value, max = 255) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).replace(/[\0\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function redactText(value, max = 2000) {
  const text = cleanText(value, max * 2);
  if (!text) return null;
  return text
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, max);
}

function safeKey(value, field, max = 128) {
  const key = cleanText(value, max);
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(key)) {
    throw new Error(`${field} must contain only letters, numbers, dot, underscore, colon, slash, or dash`);
  }
  return key;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function integerMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(key)) continue;
    result[key] = nonNegativeInteger(count);
  }
  return result;
}

function sanitizeSummary(value) {
  if (typeof value === "number") return { count: nonNegativeInteger(value) };
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    count: nonNegativeInteger(input.count),
    destructive: nonNegativeInteger(input.destructive),
    by_action: integerMap(input.by_action || input.byAction),
    by_kind: integerMap(input.by_kind || input.byKind),
  };
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function sanitizeBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    ok: value.ok !== false,
    id: cleanText(value.id, 255),
    path: cleanText(value.path, 1024),
    created_at: validIso(value.created_at || value.createdAt),
    sha256: /^[a-f0-9]{64}$/i.test(String(value.sha256 || "")) ? String(value.sha256).toLowerCase() : null,
    size: nonNegativeInteger(value.size || value.bytes),
    client_version: cleanText(value.client_version || value.clientVersion, 64),
    server_version: cleanText(value.server_version || value.serverVersion, 64),
  };
  return Object.fromEntries(Object.entries(result).filter(([, entry]) => entry !== null && entry !== ""));
}

function sanitizeConvergence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    ok: value.ok === true,
    operation_count: nonNegativeInteger(value.operation_count || value.operations),
    warning_count: nonNegativeInteger(value.warning_count || value.warnings),
    drift_count: nonNegativeInteger(value.drift_count || value.drift),
    checked_at: validIso(value.checked_at || value.checkedAt),
    error: redactText(value.error, 1000),
  };
  return Object.fromEntries(Object.entries(result).filter(([, entry]) => entry !== null && entry !== ""));
}

function sanitizeDeploymentRecord(input = {}) {
  const requestId = safeKey(input.request_id || input.requestId, "request_id");
  const hashId = crypto.createHash("sha256").update(requestId).digest("hex").slice(0, 16);
  const deploymentId = safeKey(input.deployment_id || input.deploymentId || input.id || `deploy-${hashId}`, "deployment_id");
  const kind = cleanText(input.kind || "deployment", 32);
  if (!/^(deployment|rollback)$/.test(kind)) throw new Error("kind must be deployment or rollback");
  const environment = cleanText(input.environment || input.env, 64);
  if (!environment || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(environment)) throw new Error("environment is required");
  const status = cleanText(input.status, 64);
  if (!status || !/^[a-z][a-z0-9_-]*$/.test(status)) throw new Error("status is required and must be a lowercase status key");

  const operationSummary = sanitizeSummary(input.operation_summary || input.operationSummary || input.operations);
  const warningSummary = sanitizeSummary(input.warning_summary || input.warningSummary || input.warnings);
  const commit = cleanText(input.commit || input.commit_sha || input.commitSha, 64);
  const record = {
    deployment_id: deploymentId,
    request_id: requestId,
    kind,
    project: cleanText(input.project || input.project_name || input.projectName, 255),
    version: cleanText(input.version, 128),
    commit_sha: commit && /^[a-f0-9]{7,64}$/i.test(commit) ? commit.toLowerCase() : null,
    environment,
    status,
    operation_count: operationSummary.count,
    warning_count: warningSummary.count,
    operation_summary: operationSummary,
    warning_summary: warningSummary,
    backup: sanitizeBackup(input.backup || input.backup_receipt || input.backupReceipt),
    convergence: sanitizeConvergence(input.convergence),
    error: redactText(input.error),
    rollback_of: cleanText(input.rollback_of || input.rollbackOf || input.restored_from || input.restoredFrom, 128),
    recorded_at: validIso(input.recorded_at || input.recordedAt),
  };
  record.record_hash = crypto.createHash("sha256").update(canonicalStringify(record)).digest("hex");
  return record;
}

function jsonValue(value) {
  return value === null ? null : JSON.stringify(value);
}

function deserializeRow(row) {
  if (!row) return null;
  const result = { ...row };
  for (const key of ["operation_summary", "warning_summary", "backup", "convergence"]) {
    if (typeof result[key] === "string") {
      try { result[key] = JSON.parse(result[key]); } catch (_error) { result[key] = null; }
    }
  }
  if (result.id !== undefined) result.id = Number(result.id);
  return result;
}

async function findBy(db, table, column, value) {
  const placeholder = db.isSQLite ? "?" : "$1";
  const result = await db.query(`SELECT * FROM ${table} WHERE ${quoteIdentifier(column)} = ${placeholder} LIMIT 1`, [value]);
  return deserializeRow(result.rows && result.rows[0]);
}

async function writeDeploymentRecord(input, providedDb) {
  const record = sanitizeDeploymentRecord(input);
  const { db, table } = await ensureDeploymentLedger(providedDb || deploymentDb());
  const existing = await findBy(db, table, "request_id", record.request_id);
  if (existing) {
    if (existing.record_hash !== record.record_hash) {
      const error = new Error(`request_id ${record.request_id} already exists with different deployment data`);
      error.code = "DEPLOYMENT_REQUEST_CONFLICT";
      error.statusCode = 409;
      throw error;
    }
    return { created: false, record: existing };
  }

  const columns = [
    "deployment_id", "request_id", "kind", "project", "version", "commit_sha", "environment", "status",
    "operation_count", "warning_count", "operation_summary", "warning_summary", "backup", "convergence",
    "error", "rollback_of", "recorded_at", "record_hash",
  ];
  const values = [
    record.deployment_id, record.request_id, record.kind, record.project, record.version, record.commit_sha,
    record.environment, record.status, record.operation_count, record.warning_count,
    jsonValue(record.operation_summary), jsonValue(record.warning_summary), jsonValue(record.backup),
    jsonValue(record.convergence), record.error, record.rollback_of, record.recorded_at, record.record_hash,
  ];
  const placeholders = columns.map((column, index) => {
    const placeholder = db.isSQLite ? "?" : `$${index + 1}`;
    if (!db.isSQLite && ["operation_summary", "warning_summary", "backup", "convergence"].includes(column)) return `${placeholder}::jsonb`;
    if (column === "recorded_at") return `COALESCE(${placeholder}${db.isSQLite ? "" : "::timestamptz"}, ${db.isSQLite ? "CURRENT_TIMESTAMP" : "now()"})`;
    return placeholder;
  });

  try {
    await db.query(
      `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );
  } catch (error) {
    const concurrent = await findBy(db, table, "request_id", record.request_id);
    if (!concurrent) {
      const duplicateId = await findBy(db, table, "deployment_id", record.deployment_id);
      if (duplicateId) {
        const conflict = new Error(`deployment_id ${record.deployment_id} already exists`);
        conflict.code = "DEPLOYMENT_ID_CONFLICT";
        conflict.statusCode = 409;
        throw conflict;
      }
      throw error;
    }
  }

  const inserted = await findBy(db, table, "request_id", record.request_id);
  if (!inserted) throw new Error("Deployment ledger write completed without a readable record");
  if (inserted.record_hash !== record.record_hash) {
    const error = new Error(`request_id ${record.request_id} already exists with different deployment data`);
    error.code = "DEPLOYMENT_REQUEST_CONFLICT";
    error.statusCode = 409;
    throw error;
  }
  return { created: true, record: inserted };
}

async function listDeploymentRecords(filters = {}, providedDb) {
  const { db, table } = await ensureDeploymentLedger(providedDb || deploymentDb());
  const values = [];
  const clauses = [];
  const add = (column, value) => {
    if (!value) return;
    values.push(cleanText(value, 255));
    clauses.push(`${quoteIdentifier(column)} = ${db.isSQLite ? "?" : `$${values.length}`}`);
  };
  add("project", filters.project);
  add("environment", filters.environment || filters.env);
  add("status", filters.status);
  add("kind", filters.kind);
  const limit = Math.min(Math.max(nonNegativeInteger(filters.limit) || 50, 1), 100);
  const offset = Math.min(nonNegativeInteger(filters.offset), 1000000);
  const result = await db.query(
    `SELECT * FROM ${table}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY recorded_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  return (result.rows || []).map(deserializeRow);
}

async function getDeploymentRecord(id, providedDb) {
  const { db, table } = await ensureDeploymentLedger(providedDb || deploymentDb());
  return findBy(db, table, "deployment_id", safeKey(id, "deployment_id"));
}

module.exports = {
  TABLE,
  deploymentDb,
  ensureDeploymentLedger,
  sanitizeDeploymentRecord,
  writeDeploymentRecord,
  listDeploymentRecords,
  getDeploymentRecord,
  deserializeRow,
};
