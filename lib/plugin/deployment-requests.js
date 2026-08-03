const crypto = require("node:crypto");
const { optionalRequire } = require("../tenant-adapters");

const REQUESTS_TABLE = "_sc_ps_deployment_requests";
const LOCKS_TABLE = "_sc_ps_deployment_locks";

function requestDb() {
  return optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
}

function rows(result) {
  return result?.rows || result || [];
}

async function ensureDeploymentRequestTables(db = requestDb()) {
  if (db.isSQLite) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${REQUESTS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL,
      environment TEXT NOT NULL,
      actor_id TEXT,
      source_ref TEXT NOT NULL,
      resolved_ref TEXT,
      commit_sha TEXT NOT NULL,
      desired_digest TEXT NOT NULL,
      actual_digest TEXT NOT NULL,
      plan_digest TEXT NOT NULL,
      operation_summary TEXT NOT NULL,
      warning_summary TEXT NOT NULL,
      blocker_summary TEXT NOT NULL,
      backup_policy TEXT NOT NULL,
      backup_requested INTEGER NOT NULL DEFAULT 0,
      allow_destructive INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      finished_at TEXT,
      deployment_id TEXT,
      error TEXT,
      steps TEXT NOT NULL DEFAULT '[]'
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${LOCKS_TABLE} (lock_key TEXT PRIMARY KEY, request_id TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  } else {
    await db.query(`CREATE TABLE IF NOT EXISTS ${REQUESTS_TABLE} (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES _sc_ps_projects(id) ON DELETE CASCADE,
      environment TEXT NOT NULL,
      actor_id TEXT,
      source_ref TEXT NOT NULL,
      resolved_ref TEXT,
      commit_sha TEXT NOT NULL,
      desired_digest TEXT NOT NULL,
      actual_digest TEXT NOT NULL,
      plan_digest TEXT NOT NULL,
      operation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      warning_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
      blocker_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
      backup_policy TEXT NOT NULL,
      backup_requested BOOLEAN NOT NULL DEFAULT false,
      allow_destructive BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      confirmed_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      deployment_id TEXT,
      error TEXT,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS ${REQUESTS_TABLE}_project_idx ON ${REQUESTS_TABLE} (project_id, environment, created_at DESC)`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${LOCKS_TABLE} (
      lock_key TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`);
  }
}

function clean(value, max = 255) {
  return String(value ?? "").replace(/[\0\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function redactError(value, max = 2000) {
  return clean(value, max * 2)
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, max) || null;
}

function safeEnvironment(value) {
  const env = clean(value, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(env)) throw new Error("invalid deployment environment");
  return env;
}

function safeDigest(value, field) {
  const result = clean(value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result;
}

function deploymentLockKey(projectSlug, environment) {
  const slug = clean(projectSlug, 128).toLowerCase();
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) throw new Error("invalid deployment project slug");
  return `deploy:${slug}:${safeEnvironment(environment).toLowerCase()}`;
}

function parseJsonFields(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of ["operation_summary", "warning_summary", "blocker_summary", "steps"]) {
    if (typeof result[field] === "string") {
      try { result[field] = JSON.parse(result[field]); } catch (_err) { result[field] = field === "operation_summary" ? {} : []; }
    }
  }
  result.backup_requested = result.backup_requested === true || result.backup_requested === 1;
  result.allow_destructive = result.allow_destructive === true || result.allow_destructive === 1;
  return result;
}

async function createDeploymentRequest(input, db = requestDb()) {
  await ensureDeploymentRequestTables(db);
  const requestId = input.request_id || `ui-${crypto.randomUUID()}`;
  if (!/^ui-[A-Za-z0-9-]{8,80}$/.test(requestId)) throw new Error("invalid UI deployment request ID");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.min(Math.max(Number(input.ttl_ms) || 10 * 60_000, 60_000), 30 * 60_000));
  const values = [
    requestId, Number(input.project_id), safeEnvironment(input.environment), clean(input.actor_id, 128) || null,
    clean(input.source_ref, 255), clean(input.resolved_ref, 255) || null, clean(input.commit_sha, 64).toLowerCase(),
    safeDigest(input.desired_digest, "desired_digest"), safeDigest(input.actual_digest, "actual_digest"), safeDigest(input.plan_digest, "plan_digest"),
    JSON.stringify(input.operation_summary || {}), JSON.stringify(input.warning_summary || []), JSON.stringify(input.blocker_summary || []),
    input.backup_policy === "required" ? "required" : "optional", input.backup_requested === true, input.allow_destructive === true,
    "previewed", now.toISOString(), expiresAt.toISOString(), "[]",
  ];
  const placeholders = values.map((_, index) => db.isSQLite ? "?" : `$${index + 1}`);
  if (!db.isSQLite) {
    for (const index of [10, 11, 12, 19]) placeholders[index] += "::jsonb";
    placeholders[14] += "::boolean";
    placeholders[15] += "::boolean";
    placeholders[17] += "::timestamptz";
    placeholders[18] += "::timestamptz";
  }
  await db.query(`INSERT INTO ${REQUESTS_TABLE} (
    request_id, project_id, environment, actor_id, source_ref, resolved_ref, commit_sha,
    desired_digest, actual_digest, plan_digest, operation_summary, warning_summary, blocker_summary,
    backup_policy, backup_requested, allow_destructive, status, created_at, expires_at, steps
  ) VALUES (${placeholders.join(", ")})`, values);
  return getDeploymentRequest(requestId, db);
}

async function getDeploymentRequest(requestId, db = requestDb()) {
  await ensureDeploymentRequestTables(db);
  const p = db.isSQLite ? "?" : "$1";
  const result = await db.query(`SELECT * FROM ${REQUESTS_TABLE} WHERE request_id = ${p} LIMIT 1`, [clean(requestId, 128)]);
  return parseJsonFields(rows(result)[0]);
}

async function updateDeploymentRequest(requestId, fields, db = requestDb()) {
  await ensureDeploymentRequestTables(db);
  const allowed = new Set(["status", "confirmed_at", "finished_at", "deployment_id", "error", "steps", "allow_destructive"]);
  const sets = [];
  const values = [];
  for (const [field, raw] of Object.entries(fields || {})) {
    if (!allowed.has(field)) continue;
    let value = raw;
    if (field === "error") value = redactError(raw);
    if (field === "steps") value = JSON.stringify(raw || []);
    if (field === "allow_destructive") value = raw === true;
    values.push(value);
    let p = db.isSQLite ? "?" : `$${values.length}`;
    if (!db.isSQLite && field === "steps") p += "::jsonb";
    if (!db.isSQLite && field === "allow_destructive") p += "::boolean";
    if (!db.isSQLite && ["confirmed_at", "finished_at"].includes(field)) p += "::timestamptz";
    sets.push(`${field} = ${p}`);
  }
  if (!sets.length) return getDeploymentRequest(requestId, db);
  values.push(clean(requestId, 128));
  await db.query(`UPDATE ${REQUESTS_TABLE} SET ${sets.join(", ")} WHERE request_id = ${db.isSQLite ? "?" : `$${values.length}`}`, values);
  return getDeploymentRequest(requestId, db);
}

function requestIsExpired(request) {
  return !request || new Date(request.expires_at).valueOf() <= Date.now();
}

async function acquireDeploymentLock(lockKey, requestId, ttlMs = 60 * 60_000, db = requestDb()) {
  await ensureDeploymentRequestTables(db);
  const key = clean(lockKey, 255);
  const req = clean(requestId, 128);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const p = db.isSQLite ? "?" : (n) => `$${n}`;
  await db.query(`DELETE FROM ${LOCKS_TABLE} WHERE lock_key = ${db.isSQLite ? p : p(1)} AND expires_at < ${db.isSQLite ? p : `${p(2)}::timestamptz`}`, [key, now.toISOString()]);
  try {
    await db.query(`INSERT INTO ${LOCKS_TABLE} (lock_key, request_id, acquired_at, expires_at) VALUES (${db.isSQLite ? "?, ?, ?, ?" : "$1, $2, $3::timestamptz, $4::timestamptz"})`, [key, req, now.toISOString(), expires.toISOString()]);
    return true;
  } catch (_err) {
    return false;
  }
}

async function releaseDeploymentLock(lockKey, requestId, db = requestDb()) {
  await ensureDeploymentRequestTables(db);
  await db.query(`DELETE FROM ${LOCKS_TABLE} WHERE lock_key = ${db.isSQLite ? "?" : "$1"} AND request_id = ${db.isSQLite ? "?" : "$2"}`, [clean(lockKey, 255), clean(requestId, 128)]);
}

module.exports = {
  REQUESTS_TABLE,
  LOCKS_TABLE,
  ensureDeploymentRequestTables,
  createDeploymentRequest,
  getDeploymentRequest,
  updateDeploymentRequest,
  requestIsExpired,
  acquireDeploymentLock,
  releaseDeploymentLock,
  parseJsonFields,
  deploymentLockKey,
};
