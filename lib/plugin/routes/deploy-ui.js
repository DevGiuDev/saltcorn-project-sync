const { apiLocal, sendJson } = require("./_shared");
const { sameOriginAdminAuthorized } = require("../auth");
const requests = require("../deployment-requests");
const service = require("../deploy-service");

function actorId(req) {
  return req?.user?.id ?? req?.user?.user_id ?? null;
}

function uiOnly(req, res, handler) {
  if (!sameOriginAdminAuthorized(req)) return sendJson(res, { ok: false, error: "Same-origin administrator session required" }, 403);
  return apiLocal(req, res, handler);
}

const routes = [
  {
    url: "/project-sync/api/projects/:id/deploy/context",
    method: "get",
    callback: async (req, res) => uiOnly(req, res, async () => {
      const environment = req.query?.environment || req.query?.env || "dev";
      const context = await service.projectContext(req.params.id, environment);
      service.assertTargetTenant(context);
      const adapter = service.deploymentAdapter(context);
      const info = await adapter.info();
      return {
        ok: true,
        context: {
          project: { id: context.project.id, name: context.project.name, slug: context.project.slug },
          environment,
          default_ref: context.default_ref,
          git_status: context.git_status,
          tenant: context.resolved.config.tenant || null,
          base_url: context.resolved.config.base_url || null,
          backup_policy: require("../../deploy-orchestrator").backupPolicy(environment, context.resolved.config.backup_policy),
          backup_ready: info?.capabilities?.methods?.backup === true,
        },
      };
    }),
  },
  {
    url: "/project-sync/api/projects/:id/deploy/preview",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => uiOnly(req, res, async () => {
      const body = req.body || {};
      const result = await service.previewDeployment({
        projectId: req.params.id,
        environment: body.environment || "dev",
        sourceRef: body.source_ref,
        // UI previews always refresh origin. Use fetch rather than pull so the
        // immutable remote ref advances without mutating the VPS working tree.
        refreshSource: true,
        backupRequested: body.backup_requested === true,
        actorId: actorId(req),
      });
      return { ok: true, source: result.source, request: result.request, prepared: result.prepared };
    }),
  },
  {
    // Saltcorn's noCsrf lookup compares literal URL prefixes, so parameterized
    // route declarations (":requestId") do not exempt the corresponding
    // browser request. Keep write endpoints static and carry the request ID in
    // the JSON body; uiOnly still requires an admin session and same origin.
    url: "/project-sync/api/deployment-requests/confirm",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => uiOnly(req, res, async () => {
      const request = await service.confirmDeployment({
        requestId: req.body?.request_id,
        actorId: actorId(req),
        planDigest: req.body?.plan_digest,
        typedEnvironment: req.body?.typed_environment || "",
      });
      return { ok: true, request };
    }),
  },
  {
    url: "/project-sync/api/deployment-requests/cancel",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => uiOnly(req, res, async () => ({ ok: true, request: await service.cancelDeployment(req.body?.request_id, actorId(req)) })),
  },
  {
    url: "/project-sync/api/deployment-requests/:requestId",
    method: "get",
    callback: async (req, res) => uiOnly(req, res, async () => {
      const request = await requests.getDeploymentRequest(req.params.requestId);
      if (!request) return sendJson(res, { ok: false, error: "Deployment request not found" }, 404);
      return { ok: true, request };
    }),
  },
];

module.exports = routes;
