/**
 * Git API routes — status, add, commit, push, pull, fetch, branches, checkout, log, stash.
 */
const {
  api,
  resolveProjectRootFromRequest,
} = require("./_shared");

function requireRoot(handler) {
  return async (req, res) =>
    api(req, res, async () => {
      const ctx = await resolveProjectRootFromRequest(req);
      if (!ctx.projectRoot) return { ok: false, error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
      const gitOps = require("../../git-ops");
      return handler(req, res, ctx.projectRoot, gitOps, ctx.project);
    });
}

const routes = [
  {
    url: "/project-sync/api/git/status",
    method: "get",
    callback: requireRoot(async (_req, _res, projectRoot, gitOps) => {
      if (!gitOps.isGitRepo(projectRoot)) return { ok: false, error: "Not a git repository" };
      return gitOps.gitStatus(projectRoot);
    }),
  },
  {
    url: "/project-sync/api/git/add",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const { paths } = req.body || {};
      return gitOps.gitAdd(projectRoot, paths);
    }),
  },
  {
    url: "/project-sync/api/git/reset",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      return gitOps.gitReset(projectRoot, req.body?.paths);
    }),
  },
  {
    url: "/project-sync/api/git/commit",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const { message, push, sync_scope } = req.body || {};
      const committed = gitOps.gitCommit(projectRoot, message, { syncScope: sync_scope === true });
      if (!committed.ok || push !== true) return committed;
      const pushed = gitOps.gitPush(projectRoot);
      return {
        ...committed,
        pushed: pushed.ok === true,
        push_error: pushed.ok ? null : pushed.error,
        push_result: pushed,
      };
    }),
  },
  {
    url: "/project-sync/api/git/push",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const { remote, branch } = req.body || {};
      return gitOps.gitPush(projectRoot, remote, branch);
    }),
  },
  {
    url: "/project-sync/api/git/pull",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const { remote, branch } = req.body || {};
      return gitOps.gitPull(projectRoot, remote, branch);
    }),
  },
  {
    url: "/project-sync/api/git/fetch",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (_req, _res, projectRoot, gitOps) => {
      return gitOps.git(["fetch", "--all"], projectRoot, { timeout: 60_000 });
    }),
  },
  {
    url: "/project-sync/api/git/branches",
    method: "get",
    callback: requireRoot(async (_req, _res, projectRoot, gitOps) => {
      return gitOps.gitBranches(projectRoot);
    }),
  },
  {
    url: "/project-sync/api/git/checkout",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const { branch, force } = req.body || {};
      if (!branch) return { ok: false, error: "branch is required" };
      return gitOps.gitCheckout(projectRoot, branch, force);
    }),
  },
  {
    url: "/project-sync/api/git/log",
    method: "get",
    callback: requireRoot(async (req, _res, projectRoot, gitOps) => {
      const count = parseInt(req.query?.count, 10) || 10;
      return gitOps.gitLog(projectRoot, count);
    }),
  },
  {
    url: "/project-sync/api/git/stash",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (_req, _res, projectRoot, gitOps) => {
      return gitOps.gitStash(projectRoot);
    }),
  },
  {
    url: "/project-sync/api/git/stash-pop",
    method: "post",
    noCsrf: true,
    callback: requireRoot(async (_req, _res, projectRoot, gitOps) => {
      return gitOps.gitStashPop(projectRoot);
    }),
  },
];

module.exports = routes;
