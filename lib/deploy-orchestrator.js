const crypto = require("node:crypto");
const { canonicalStringify } = require("./canonical-json");
const { loadProjectState } = require("./project-state");
const { loadManifest } = require("./manifest");
const { loadChangeIntents } = require("./change-intents");
const { validateProject } = require("./validator");
const { checkSaltcornCompatibility } = require("./compatibility");
const { normalizeProjectExport } = require("./normalizer");
const { planProject, requireBackup } = require("./planner");
const { applyProject } = require("./apply-engine");
const { isVerifiableBackupMetadata } = require("./backup");

function digest(value) {
  return crypto.createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function isDestructive(op = {}) {
  return op.safe === false || /^(drop_|rename_|alter_)/.test(op.action || "");
}

function summarizePlan(plan = {}) {
  const byAction = {};
  for (const op of plan.operations || []) byAction[op.action || "unknown"] = (byAction[op.action || "unknown"] || 0) + 1;
  return {
    count: (plan.operations || []).length,
    destructive: (plan.operations || []).filter(isDestructive).length,
    safe: (plan.operations || []).filter((op) => !isDestructive(op)).length,
    warnings: (plan.warnings || []).length,
    blockers: (plan.blocked || []).length,
    by_action: byAction,
  };
}

function backupPolicy(env, configured = null) {
  if (requireBackup(env)) return "required";
  return configured === "required" ? "required" : "optional";
}

function filterState(state, scopeSet) {
  if (!scopeSet) return state;
  return require("./plugin/helpers").filterPackByScope(state, scopeSet);
}

async function prepareDeployment({
  sourceDir,
  adapter,
  env = "dev",
  backupRequested = false,
  configuredBackupPolicy = null,
  scopeSet = null,
} = {}) {
  if (!sourceDir) throw new Error("sourceDir is required");
  if (!adapter || typeof adapter.exportProject !== "function") throw new Error("tenant adapter is required");
  const manifest = loadManifest(sourceDir);
  const intents = loadChangeIntents(sourceDir);
  const validation = validateProject(sourceDir, manifest, intents);
  const desired = filterState(loadProjectState(sourceDir), scopeSet);
  const info = adapter.info ? await adapter.info() : {};
  const compatibility = checkSaltcornCompatibility(manifest, info?.saltcorn_version);
  const actual = filterState(normalizeProjectExport(await adapter.exportProject({ referenceTables: desired.reference_data || [] })), scopeSet);
  const policy = backupPolicy(env, configuredBackupPolicy);
  const backupPlanned = policy === "required" || backupRequested === true;
  const plan = planProject({ desired, actual, intents, env, backup: backupPlanned });
  for (const error of validation.errors || []) plan.blocked.push({ code: "project_validation", reason: error });
  if (!compatibility.ok) {
    for (const error of compatibility.errors || ["Saltcorn compatibility check failed"]) plan.blocked.push({ code: "compatibility", reason: error });
  }
  return {
    sourceDir,
    env,
    manifest,
    intents,
    desired,
    actual,
    plan,
    validation,
    compatibility,
    adapter_info: info,
    backup_policy: policy,
    backup_requested: backupPlanned,
    desired_digest: digest(desired),
    actual_digest: digest(actual),
    plan_digest: digest(plan),
    summary: summarizePlan(plan),
  };
}

function receiptBackup(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ok: value.ok !== false,
    skipped: value.skipped === true,
    id: value.id || value.backup_id || value.snapshot_id || null,
    path: value.path || value.file || value.artifact || null,
    created_at: value.created_at || value.completed_at || null,
    sha256: value.sha256 || null,
    provider: value.provider || null,
  };
}

async function executeDeployment({ prepared, adapter, allowDestructive = false, refresh = async () => [], onStep = async () => {} } = {}) {
  if (!prepared || !adapter) throw new Error("prepared deployment and adapter are required");
  if ((prepared.plan.blocked || []).length) throw new Error("blocked deployment cannot be executed");
  if (prepared.summary.destructive && !allowDestructive) throw new Error("destructive operations require explicit confirmation");
  const steps = [];
  const step = async (name, data = {}) => {
    const entry = { step: name, at: new Date().toISOString(), ...data };
    steps.push(entry);
    await onStep(entry);
  };

  let backupResult = null;
  if (prepared.backup_requested) {
    await step("backup", { status: "running" });
    try {
      backupResult = await adapter.backup();
      const verified = isVerifiableBackupMetadata(backupResult);
      await step("backup", { status: verified ? "complete" : "failed", receipt: receiptBackup(backupResult) });
      if (!verified) throw new Error(`${prepared.backup_policy} backup did not return verifiable metadata`);
    } catch (error) {
      if (!steps.some((entry) => entry.step === "backup" && entry.status === "failed")) await step("backup", { status: "failed" });
      error.deploymentStep = "backup";
      throw error;
    }
  } else {
    await step("backup", { status: "skipped", optional: true });
  }

  const applied = applyProject({
    desired: prepared.desired,
    actual: prepared.actual,
    intents: prepared.intents,
    env: prepared.env,
    backup: isVerifiableBackupMetadata(backupResult),
    force: false,
  });
  if (!applied.applied) throw new Error((applied.errors || ["apply preflight failed"]).join("; "));

  await step("apply", { status: "running", operations: prepared.summary.count });
  let adapterResult;
  try {
    adapterResult = adapter.applyPlan
      ? await adapter.applyPlan({
          desired: prepared.desired,
          actual: prepared.actual,
          plan: applied.plan,
          state: applied.state,
          env: prepared.env,
          backup: isVerifiableBackupMetadata(backupResult),
          backup_metadata: backupResult,
          allow_destructive: allowDestructive,
        })
      : await adapter.applyProject(applied.state);
    if (adapterResult?.ok === false) throw new Error(adapterResult.error || "adapter apply failed");
  } catch (error) {
    await step("apply", { status: "failed" });
    error.deploymentStep = "apply";
    throw error;
  }
  await step("apply", { status: "complete", operations: prepared.summary.count });

  await step("refresh", { status: "running" });
  let refreshed;
  try {
    refreshed = await refresh();
  } catch (error) {
    await step("refresh", { status: "failed" });
    error.deploymentStep = "refresh";
    throw error;
  }
  await step("refresh", { status: "complete", refreshed });

  await step("verify", { status: "running" });
  let verification;
  try {
    const after = normalizeProjectExport(await adapter.exportProject({ referenceTables: prepared.desired.reference_data || [] }));
    verification = planProject({ desired: prepared.desired, actual: after, intents: prepared.intents, env: prepared.env, backup: true });
  } catch (error) {
    await step("verify", { status: "failed" });
    error.deploymentStep = "verify";
    throw error;
  }
  const convergence = {
    ok: verification.operations.length === 0 && verification.blocked.length === 0,
    operation_count: verification.operations.length,
    warning_count: verification.warnings.length,
    drift_count: verification.operations.length,
    checked_at: new Date().toISOString(),
  };
  await step("verify", { status: convergence.ok ? "complete" : "drifted", convergence });
  return { ok: convergence.ok, steps, backup: receiptBackup(backupResult), adapter_result: adapterResult, convergence };
}

module.exports = { digest, isDestructive, summarizePlan, backupPolicy, prepareDeployment, executeDeployment, receiptBackup };
