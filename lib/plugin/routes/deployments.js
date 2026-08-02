const { api, sendJson, applyAuthorized } = require("./_shared");
const {
  listDeploymentRecords,
  getDeploymentRecord,
  writeDeploymentRecord,
} = require("../deployment-ledger");

const routes = [
  {
    url: "/project-sync/api/deployments",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => ({
        ok: true,
        records: await listDeploymentRecords({
          project: req.query?.project,
          environment: req.query?.environment || req.query?.env,
          status: req.query?.status,
          kind: req.query?.kind,
          limit: req.query?.limit,
          offset: req.query?.offset,
        }),
      })),
  },
  {
    url: "/project-sync/api/deployments/:deploymentId",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const record = await getDeploymentRecord(req.params?.deploymentId);
        if (!record) return { ok: false, error: "Deployment record not found" };
        return { ok: true, record };
      }),
  },
  {
    url: "/project-sync/api/deployments",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) {
        return sendJson(res, {
          ok: false,
          error: "deployment ledger writes require SALTCORN_PROJECT_SYNC_API_TOKEN and matching bearer token",
        }, 403);
      }
      return api(req, res, async () => {
        const result = await writeDeploymentRecord(req.body || {});
        return { ok: true, created: result.created, record: result.record };
      });
    },
  },
];

module.exports = routes;
