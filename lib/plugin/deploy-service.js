const { resolveEnvironmentConfig } = require("../environment");
const { nativeSaltcornAdapter } = require("../tenant-adapters");
const { fetchRemote, resolveGitCommit, withGitCommitCheckout, fastForwardWorkingBranch } = require("../git-source");
const { prepareDeployment, executeDeployment } = require("../deploy-orchestrator");
const { refreshSaltcornState } = require("./runtime");
const {
  createDeploymentRequest,
  getDeploymentRequest,
  updateDeploymentRequest,
  requestIsExpired,
  acquireDeploymentLock,
  releaseDeploymentLock,
  deploymentLockKey,
} = require("./deployment-requests");
const { writeDeploymentRecord } = require("./deployment-ledger");
const { resolveBackupProvider, publicBackupProvider, runBackupProvider } = require("../backup");

const running = new Map();

async function projectContext(projectId, environment = "dev") {
  const projectSetup = require("../project-setup");
  const project = await projectSetup.getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.root_path) throw new Error("Project root is not configured");
  const uiConfig = await require("./operational-config").getOperationalConfig(project.id, environment);
  const resolved = resolveEnvironmentConfig({
    projectDir: project.root_path,
    env: environment,
    uiConfig,
    defaults: { adapter: "native", transport: "direct" },
  });
  const git = require("../git-ops");
  const status = git.gitStatus(project.root_path);
  const ref = resolved.config.branch || status.branch || "HEAD";
  return { project, environment, uiConfig, resolved, git_status: status, default_ref: ref };
}

function activeTenant() {
  try {
    const db = require("../tenant-adapters").optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    return db?.getTenantSchema?.() || db?.connectObj?.default_schema || "public";
  } catch (_err) {
    return null;
  }
}

function assertTargetTenant(context) {
  if ((context.resolved.config.adapter || "native") !== "native") {
    throw new Error("Interactive deployment runs in the target tenant and requires adapter=native; use the CLI for REST or command adapters");
  }
  const configured = context.resolved.config.tenant;
  const active = activeTenant();
  if (configured && active && String(configured) !== String(active)) {
    throw new Error(`Configured target tenant ${configured} does not match active Saltcorn tenant ${active}; open Project Sync from the target tenant`);
  }
  return active;
}

function deploymentAdapter(context) {
  const adapter = nativeSaltcornAdapter();
  const provider = resolveBackupProvider(context.resolved.config);
  return {
    ...adapter,
    async info() {
      const info = await adapter.info();
      return {
        ...info,
        backup_provider: publicBackupProvider(provider),
        capabilities: {
          ...(info.capabilities || {}),
          methods: { ...(info.capabilities?.methods || {}), backup: provider.ready },
        },
      };
    },
    async backup() {
      return runBackupProvider(provider, {
        project: context.project.slug,
        environment: context.environment,
        tenant: context.resolved.config.tenant || activeTenant(),
      });
    },
  };
}

async function scopeSetForProject(projectId) {
  const scope = await require("../project-setup").getScope(projectId);
  return new Set((scope || []).filter((entry) => entry.included).map((entry) => `${entry.object_type}::${entry.object_name}`));
}

async function persistScopeAdditions(projectId, additions = [], updateEntry = null) {
  const update = updateEntry || require("../project-setup").updateScopeEntry;
  for (const entry of additions) {
    await update(projectId, entry.object_type, entry.object_name, true);
  }
  return additions.length;
}

function publicPrepared(prepared) {
  return {
    env: prepared.env,
    manifest: { name: prepared.manifest.name, slug: prepared.manifest.slug, version: prepared.manifest.version },
    plan: prepared.plan,
    validation: prepared.validation,
    compatibility: prepared.compatibility,
    adapter_info: prepared.adapter_info,
    backup_policy: prepared.backup_policy,
    backup_requested: prepared.backup_requested,
    desired_digest: prepared.desired_digest,
    actual_digest: prepared.actual_digest,
    plan_digest: prepared.plan_digest,
    summary: prepared.summary,
  };
}

async function previewDeployment({ projectId, environment = "dev", sourceRef, refreshSource = true, backupRequested = false, actorId = null } = {}) {
  const context = await projectContext(projectId, environment);
  assertTargetTenant(context);
  if (refreshSource) fetchRemote(context.project.root_path);
  const source = resolveGitCommit(context.project.root_path, sourceRef || context.default_ref);
  source.checkout_sync = fastForwardWorkingBranch(context.project.root_path, source);
  const adapter = deploymentAdapter(context);
  const scopeSet = await scopeSetForProject(projectId);
  const prepared = await withGitCommitCheckout(context.project.root_path, source.commit, (checkout) =>
    prepareDeployment({
      sourceDir: checkout,
      adapter,
      env: environment,
      backupRequested,
      configuredBackupPolicy: context.resolved.config.backup_policy,
      scopeSet,
    })
  );
  const backupReady = prepared.adapter_info?.capabilities?.methods?.backup === true;
  if (prepared.backup_requested && !backupReady) {
    prepared.plan.blocked.push({ code: "backup_unavailable", reason: "Selected backup policy requires a configured target backup provider" });
    prepared.plan_digest = require("../deploy-orchestrator").digest(prepared.plan);
    prepared.summary = require("../deploy-orchestrator").summarizePlan(prepared.plan);
  }
  const request = await createDeploymentRequest({
    project_id: projectId,
    environment,
    actor_id: actorId,
    source_ref: source.ref,
    resolved_ref: source.resolved_ref,
    commit_sha: source.commit,
    desired_digest: prepared.desired_digest,
    actual_digest: prepared.actual_digest,
    plan_digest: prepared.plan_digest,
    operation_summary: prepared.summary,
    warning_summary: prepared.plan.warnings || [],
    blocker_summary: prepared.plan.blocked || [],
    backup_policy: prepared.backup_policy,
    backup_requested: prepared.backup_requested,
    allow_destructive: false,
  });
  return { context, source, request, prepared: publicPrepared(prepared) };
}

function stepStatus(entry) {
  if (entry.status !== "running") return null;
  return { backup: "backup", apply: "applying", refresh: "refreshing", verify: "verifying" }[entry.step] || null;
}

async function recordTerminal(request, context, prepared, result, error = null) {
  const status = error ? `${error.deploymentStep || "apply"}_failed` : (result?.convergence?.ok ? "verified" : "drifted");
  const deploymentId = `deploy-${request.request_id}`;
  try {
    await writeDeploymentRecord({
      request_id: request.request_id,
      deployment_id: deploymentId,
      kind: "deployment",
      project: context.project.slug || context.project.name,
      version: prepared?.manifest?.version || null,
      commit: request.commit_sha,
      environment: request.environment,
      status,
      operations: prepared?.summary || { count: 0 },
      warnings: { count: prepared?.summary?.warnings || 0 },
      backup: result?.backup || null,
      convergence: result?.convergence || null,
      error: error?.message || null,
    });
    return { deploymentId, error: null };
  } catch (error) {
    return { deploymentId: null, error };
  }
}

async function runDeploymentRequest(requestId, actorId = null) {
  let request = await getDeploymentRequest(requestId);
  if (!request) throw new Error("Deployment request not found");
  let context = null;
  let lockKey = null;
  let prepared = null;
  let result = null;
  let steps = [];
  try {
    context = await projectContext(request.project_id, request.environment);
    assertTargetTenant(context);
    lockKey = deploymentLockKey(context.project.slug, request.environment);
    if (request.status !== "confirmed") throw new Error(`Deployment request is not confirmed (${request.status})`);
    if (request.actor_id && actorId && String(request.actor_id) !== String(actorId)) throw new Error("Deployment request belongs to another administrator session");
    if (request.resolved_ref?.startsWith("refs/remotes/origin/")) fetchRemote(context.project.root_path);
    const source = resolveGitCommit(context.project.root_path, request.source_ref);
    if (source.commit !== request.commit_sha) {
      await updateDeploymentRequest(requestId, { status: "stale", finished_at: new Date().toISOString(), error: "Git ref changed after preview" });
      return;
    }
    const scopeSet = await scopeSetForProject(request.project_id);
    const adapter = deploymentAdapter(context);
    prepared = await withGitCommitCheckout(context.project.root_path, source.commit, (checkout) =>
      prepareDeployment({
        sourceDir: checkout,
        adapter,
        env: request.environment,
        backupRequested: request.backup_requested,
        configuredBackupPolicy: request.backup_policy,
        scopeSet,
      })
    );
    if (prepared.desired_digest !== request.desired_digest || prepared.actual_digest !== request.actual_digest || prepared.plan_digest !== request.plan_digest) {
      await updateDeploymentRequest(requestId, { status: "stale", finished_at: new Date().toISOString(), error: "Source, tenant, or plan changed after preview" });
      return;
    }
    result = await executeDeployment({
      prepared,
      adapter,
      allowDestructive: request.allow_destructive,
      refresh: refreshSaltcornState,
      onStep: async (entry) => {
        steps.push(entry);
        const status = stepStatus(entry);
        await updateDeploymentRequest(requestId, { ...(status ? { status } : {}), steps });
      },
    });
    if (result.ok && (prepared.plan.scope_additions || []).length) {
      const runningScope = { step: "scope", at: new Date().toISOString(), status: "running", additions: prepared.plan.scope_additions.length };
      steps.push(runningScope);
      await updateDeploymentRequest(requestId, { steps });
      try {
        await persistScopeAdditions(request.project_id, prepared.plan.scope_additions);
      } catch (error) {
        steps.push({ step: "scope", at: new Date().toISOString(), status: "failed", additions: prepared.plan.scope_additions.length });
        await updateDeploymentRequest(requestId, { steps });
        error.deploymentStep = "scope";
        throw error;
      }
      steps.push({ step: "scope", at: new Date().toISOString(), status: "complete", additions: prepared.plan.scope_additions.length });
      await updateDeploymentRequest(requestId, { steps });
    }
    const receipt = await recordTerminal(request, context, prepared, result);
    await updateDeploymentRequest(requestId, {
      status: receipt.error ? "record_failed" : (result.ok ? "applied" : "drifted"),
      finished_at: new Date().toISOString(),
      deployment_id: receipt.deploymentId,
      error: receipt.error ? `Deployment applied but its target receipt could not be recorded: ${receipt.error.message}` : null,
      steps,
    });
  } catch (error) {
    const receipt = await recordTerminal(request, context, prepared, result, error);
    await updateDeploymentRequest(requestId, {
      status: `${error.deploymentStep || "apply"}_failed`,
      finished_at: new Date().toISOString(),
      deployment_id: receipt.deploymentId,
      error: error.message,
      steps,
    });
  } finally {
    if (!lockKey) {
      const project = await require("../project-setup").getProject(request.project_id).catch(() => null);
      if (project?.slug) lockKey = deploymentLockKey(project.slug, request.environment);
    }
    if (lockKey) await releaseDeploymentLock(lockKey, requestId);
    running.delete(requestId);
  }
}

async function confirmDeployment({ requestId, actorId = null, planDigest, typedEnvironment = "" } = {}) {
  const request = await getDeploymentRequest(requestId);
  if (!request) throw new Error("Deployment request not found");
  if (request.status !== "previewed") throw new Error(`Deployment request cannot be confirmed from status ${request.status}`);
  if (requestIsExpired(request)) {
    await updateDeploymentRequest(requestId, { status: "expired", finished_at: new Date().toISOString() });
    throw new Error("Deployment preview expired; generate a new plan");
  }
  if ((request.blocker_summary || []).length) throw new Error("Blocked deployment request cannot be confirmed");
  if (planDigest !== request.plan_digest) throw new Error("Plan digest does not match preview");
  if (request.actor_id && actorId && String(request.actor_id) !== String(actorId)) throw new Error("Deployment request belongs to another administrator session");
  const destructive = request.operation_summary?.destructive > 0;
  if (destructive && typedEnvironment !== request.environment) {
    throw new Error("Type the target environment to confirm destructive operations");
  }
  const context = await projectContext(request.project_id, request.environment);
  assertTargetTenant(context);
  const lockKey = deploymentLockKey(context.project.slug, request.environment);
  if (!(await acquireDeploymentLock(lockKey, requestId))) throw new Error("Another deployment is already running for this target");
  let confirmed;
  try {
    confirmed = await updateDeploymentRequest(requestId, { status: "confirmed", confirmed_at: new Date().toISOString(), allow_destructive: destructive });
  } catch (error) {
    await releaseDeploymentLock(lockKey, requestId);
    throw error;
  }
  const task = runDeploymentRequest(requestId, actorId);
  running.set(requestId, task);
  task.catch(() => {});
  return confirmed;
}

async function cancelDeployment(requestId, actorId = null) {
  const request = await getDeploymentRequest(requestId);
  if (!request) throw new Error("Deployment request not found");
  if (request.actor_id && actorId && String(request.actor_id) !== String(actorId)) throw new Error("Deployment request belongs to another administrator session");
  if (!["previewed", "confirmed"].includes(request.status) || running.has(requestId)) throw new Error("Deployment can no longer be cancelled");
  return updateDeploymentRequest(requestId, { status: "cancelled", finished_at: new Date().toISOString() });
}

module.exports = {
  projectContext,
  scopeSetForProject,
  persistScopeAdditions,
  publicPrepared,
  activeTenant,
  assertTargetTenant,
  deploymentAdapter,
  previewDeployment,
  confirmDeployment,
  runDeploymentRequest,
  cancelDeployment,
};
