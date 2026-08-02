/**
 * Business logic helpers: diff computation, planning, adapter access.
 */
const { configuredProjectRoot } = require("./config");
const { normalizePack, VERSIONED_KINDS } = require("../normalizer");
const { diffNamedCollections, diffTables } = require("../diff");
const { ENV_POLICIES, planProject, comparablePlugin } = require("../planner");
const { optionalRequire } = require("../tenant-adapters");
const { loadManifest, readSyncMeta, computeFileSyncStatus } = require("../manifest");
const { isVerifiableBackupMetadata } = require("../backup");

// ─── Object counting ───────────────────────────────────────

function objectCounts(project = {}) {
  return VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = (project[kind] || []).length;
    return acc;
  }, {});
}

// ─── Scope ─────────────────────────────────────────────────

async function loadScopeSet(projectRoot = configuredProjectRoot()) {
  if (!projectRoot) return null;
  try {
    const ps = require("../project-setup");
    const projects = await ps.listProjects();
    const project = projects.find((p) => p.root_path === projectRoot);
    if (!project) return null;
    const scope = await ps.getScope(project.id);
    if (!scope || !scope.length) return null;
    const scopeSet = new Set();
    for (const e of scope) {
      if (e.included) scopeSet.add(`${e.object_type}::${e.object_name}`);
    }
    return scopeSet;
  } catch {
    return null;
  }
}

// ─── Diff ──────────────────────────────────────────────────

function filterPackByScope(pack, scopeSet) {
  if (!scopeSet) return pack;
  const result = { ...pack };
  for (const kind of [...VERSIONED_KINDS, "plugins"]) {
    if (!Array.isArray(result[kind])) continue;
    result[kind] = result[kind].filter((obj) =>
      scopeSet.has(`${kind}::${obj.name || obj.role}`)
    );
  }
  return result;
}

function summarizeDiff(desired = {}, actual = {}, scopeSet = null) {
  const d = scopeSet ? filterPackByScope(desired, scopeSet) : desired;
  const a = scopeSet ? filterPackByScope(actual, scopeSet) : actual;
  const summary = { tables: null, kinds: {}, plugins: null };
  summary.tables = diffTables(d.tables || [], a.tables || []);
  for (const kind of VERSIONED_KINDS.filter((k) => k !== "tables")) {
    summary.kinds[kind] = diffNamedCollections(d[kind] || [], a[kind] || []);
  }
  summary.plugins = diffNamedCollections(
    (d.plugins || []).map(comparablePlugin),
    (a.plugins || []).map(comparablePlugin)
  );
  return summary;
}

function diffCount(diff = {}) {
  return (
    (diff.created || []).length +
    (diff.updated || []).length +
    (diff.orphaned || []).length
  );
}

// ─── Planning ──────────────────────────────────────────────

function isDestructiveOperation(op = {}) {
  return /^(drop_|rename_|alter_)/.test(op.action || "");
}

function validateApplyPayload(payload = {}) {
  const env = payload.env || "dev";
  const plan = payload.plan || {};
  const errors = [];
  if (!payload.desired || typeof payload.desired !== "object")
    errors.push("desired project state is required");
  if (!Array.isArray(plan.operations)) errors.push("plan.operations must be an array");
  if (!Object.prototype.hasOwnProperty.call(ENV_POLICIES, env))
    errors.push(`unsupported environment: ${env}`);
  for (const blocked of plan.blocked || [])
    errors.push(
      `blocked plan item: ${typeof blocked === "string" ? blocked : JSON.stringify(blocked)}`
    );
  const destructive = (Array.isArray(plan.operations) ? plan.operations : []).filter(isDestructiveOperation);
  if (destructive.length && payload.allow_destructive !== true)
    errors.push("destructive operations require allow_destructive=true");
  if (["test", "prod"].includes(env)) {
    if (payload.backup !== true)
      errors.push(`backup confirmation is required for ${env}`);
    if (!isVerifiableBackupMetadata(payload.backup_metadata))
      errors.push(`verifiable backup metadata is required for ${env}`);
  }
  return { valid: errors.length === 0, errors, env, destructive };
}

function destructiveOperations(plan = {}) {
  return (plan.operations || []).filter(isDestructiveOperation);
}

function approvalMatrix({ desired = {}, actual = {}, intents = [], backup = false } = {}) {
  return Object.keys(ENV_POLICIES).map((env) => {
    const plan = planProject({ desired, actual, intents, env, backup });
    return {
      env,
      plan,
      blocked: (plan.blocked || []).length,
      warnings: (plan.warnings || []).length,
      operations: (plan.operations || []).length,
      destructive: destructiveOperations(plan).length,
      backup_required: plan.backup_required,
      can_apply: (plan.blocked || []).length === 0,
    };
  });
}

// ─── Adapter ───────────────────────────────────────────────

async function nativeAdapterOrError() {
  try {
    const { nativeSaltcornAdapter } = require("../tenant-adapters");
    return nativeSaltcornAdapter();
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Misc ──────────────────────────────────────────────────

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "justo ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return date.toLocaleDateString();
}

module.exports = {
  objectCounts,
  loadScopeSet,
  filterPackByScope,
  summarizeDiff,
  diffCount,
  isDestructiveOperation,
  validateApplyPayload,
  destructiveOperations,
  approvalMatrix,
  nativeAdapterOrError,
  timeAgo,
};
