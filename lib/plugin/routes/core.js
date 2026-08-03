/**
 * Core API routes — status, live-diff, info, export, apply, backup, restore.
 */
const {
  api, apiLocal, sendJson, applyAuthorized,
  configuredProjectRoot, getPluginConfig,
  objectCounts, summarizeDiff, diffCount, validateApplyPayload,
  nativeAdapterOrError, approvalMatrix, loadScopeSet,
  normalizePack, VERSIONED_KINDS, loadProjectState,
  optionalRequireOrNull,
  resolveContext, resolveProjectRootFromRequest, exportLivePack,
} = require("./_shared");
const crypto = require("node:crypto");
const {
  acquireDeploymentLock,
  releaseDeploymentLock,
  deploymentLockKey,
} = require("../deployment-requests");

function referenceTablesFromRequest(req = {}) {
  const raw = req.query && (req.query.reference_tables || req.query.referenceTables);
  const values = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0 && value.length <= 63 && !/[\0\r\n]/.test(value));
}

const routes = [
  {
    url: "/project-sync/api/status",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const info = await adapter.info();
        const exported = normalizePack(await adapter.exportProject());
        return { ok: true, info, counts: objectCounts(exported), project_root_configured: Boolean(configuredProjectRoot()) };
      }),
  },
  {
    url: "/project-sync/api/live-diff",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(ctx.projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const scopeSet = await loadScopeSet(ctx.projectRoot);
        return { ok: true, diff: summarizeDiff(desired, actual, scopeSet) };
      }),
  },
  {
    url: "/project-sync/api/info",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        return { ok: true, ...(await adapter.info()) };
      }),
  },
  {
    url: "/api/project-sync/info",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        return { ok: true, ...(await adapter.info()) };
      }),
  },
  {
    url: "/project-sync/api/export",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const r = await exportLivePack({ referenceTables: referenceTablesFromRequest(req) });
        if (r.error) return { ok: false, error: r.error };
        return r.pack;
      }),
  },
  {
    url: "/api/project-sync/export",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const r = await exportLivePack({ referenceTables: referenceTablesFromRequest(req) });
        if (r.error) return { ok: false, error: r.error };
        return r.pack;
      }),
  },
  {
    url: "/project-sync/api/apply",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "apply requires SALTCORN_PROJECT_SYNC_API_TOKEN and matching bearer token" }, 403);
      return api(req, res, async () => {
        const payload = req.body || {};
        const validation = validateApplyPayload(payload);
        if (!validation.valid) return { ok: false, errors: validation.errors };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        let projectSlug = payload.project_slug;
        if (!projectSlug) {
          try { projectSlug = loadManifest(configuredProjectRoot()).slug; } catch (_err) { projectSlug = "default"; }
        }
        const requestId = String(payload.request_id || `api-${crypto.randomUUID()}`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(requestId)) return { ok: false, errors: ["request_id contains invalid characters or length"] };
        const lockKey = deploymentLockKey(projectSlug, validation.env);
        if (!(await acquireDeploymentLock(lockKey, requestId))) {
          const error = new Error("Another deployment is already applying to this project and environment");
          error.statusCode = 409;
          throw error;
        }
        try {
          const result = await adapter.applyPlan({
            desired: payload.desired,
            actual: payload.actual || {},
            plan: payload.plan,
            state: payload.state || {},
            env: validation.env,
            backup: payload.backup === true,
            backup_metadata: payload.backup_metadata || null,
          });
          return { ok: result.ok !== false, request_id: requestId, env: validation.env, destructive_operations: validation.destructive.length, adapter_result: result };
        } finally {
          await releaseDeploymentLock(lockKey, requestId);
        }
      });
    },
  },
  {
    url: "/project-sync/api/refresh-state",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "unauthorized" }, 403);
      return api(req, res, async () => {
        const refreshed = await require("../runtime").refreshSaltcornState();
        return { ok: true, refreshed };
      });
    },
  },
  {
    url: "/project-sync/api/backup",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "backup requires a configured and matching bearer token" }, 403);
      return api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return adapter.backup();
      });
    },
  },
  {
    url: "/project-sync/api/restore",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "restore requires a configured and matching bearer token" }, 403);
      return api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return adapter.restore(req.body || {});
      });
    },
  },
  {
    url: "/project-sync/api/plan-preview",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(ctx.projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(ctx.projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        return { ok: true, plan: planProject({ desired, actual, intents, env, backup: false }) };
      }),
  },
  {
    url: "/project-sync/api/approvals",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(ctx.projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(ctx.projectRoot);
        return { ok: true, approvals: approvalMatrix({ desired, actual, intents }) };
      }),
  },
];

module.exports = routes;
