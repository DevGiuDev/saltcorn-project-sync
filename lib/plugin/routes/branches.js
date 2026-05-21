/**
 * Branch API routes — branch-guard, CRUD, create, switch, merge, delete.
 */
const {
  api, sendJson,
  configuredProjectRoot,
  optionalRequire,
  resolveProjectRootFromRequest,
} = require("./_shared");

async function projectRootForRequest(req) {
  const ctx = await resolveProjectRootFromRequest(req);
  if (!ctx.projectRoot) return { error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
  return ctx;
}

const routes = [
  // Branch guard — lightweight endpoint for the global toast (no auth required)
  {
    url: "/project-sync/api/branch-guard",
    method: "get",
    callback: async (req, res) => {
      try {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return sendJson(res, { ok: true });
        const bt = require("../../branch-tenant");
        const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        if (!dbMod) return sendJson(res, { ok: true });
        const currentTenant = dbMod.getTenantSchema();
        const guard = bt.guardBranchTenant(projectRoot, currentTenant);
        if (guard.ok) return sendJson(res, { ok: true });
        const host = (req && req.headers && req.headers.host) || 'localhost:3000';
        const parts = host.split(':');
        const baseHost = parts[0].split('.').pop();
        const port = parts[1] ? ':' + parts[1] : '';
        const targetUrl = guard.expected === 'public'
          ? `http://${baseHost}${port}`
          : `http://${guard.expected}.${baseHost}${port}`;
        return sendJson(res, {
          ok: false,
          branch: guard.branch,
          expected: guard.expected,
          actual: guard.actual,
          target_url: targetUrl,
          suggested_branch: guard.suggested_branch || null,
        });
      } catch {
        return sendJson(res, { ok: true }); // fail open
      }
    },
  },
  {
    url: "/project-sync/api/branches",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectRootForRequest(req);
        if (ctx.error) return { ok: false, error: ctx.error };
        const bt = require("../../branch-tenant");
        return bt.listBranchTenants(ctx.projectRoot);
      }),
  },
  {
    url: "/project-sync/api/branches/create",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectRootForRequest(req);
        if (ctx.error) return { ok: false, error: ctx.error };
        const { branch, source } = req.body || {};
        if (!branch) return { ok: false, error: "branch name is required" };
        const bt = require("../../branch-tenant");
        try {
          return await bt.createBranchTenant({ branchName: branch, projectRoot: ctx.projectRoot, sourceSchema: source || undefined });
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
  {
    url: "/project-sync/api/branches/switch",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectRootForRequest(req);
        if (ctx.error) return { ok: false, error: ctx.error };
        const { branch } = req.body || {};
        if (!branch) return { ok: false, error: "branch name is required" };
        const bt = require("../../branch-tenant");
        try {
          return await bt.switchBranch({ branchName: branch, projectRoot: ctx.projectRoot });
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
  {
    url: "/project-sync/api/branches/merge",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectRootForRequest(req);
        if (ctx.error) return { ok: false, error: ctx.error };
        const { branch } = req.body || {};
        if (!branch) return { ok: false, error: "branch name is required" };
        const gitOps = require("../../git-ops");
        try {
          const result = gitOps.gitMerge(branch, ctx.projectRoot);
          if (!result.ok) return { ok: false, error: result.error || result.stderr || "Merge failed" };
          return { ok: true, message: result.stdout || `Merged ${branch}` };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
  {
    url: "/project-sync/api/branches/:name",
    method: "delete",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectRootForRequest(req);
        if (ctx.error) return { ok: false, error: ctx.error };
        const { force } = req.body || {};
        const bt = require("../../branch-tenant");
        try {
          return await bt.deleteBranchTenant({ branchName: req.params.name, projectRoot: ctx.projectRoot, force: force || false });
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
];

module.exports = routes;
