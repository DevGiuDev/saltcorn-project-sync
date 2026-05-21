/**
 * Page routes (GET → HTML rendering).
 */
const { sendPage, requirePageAuth, requireRootTenant } = require("../auth");
const { configuredProjectRoot, getPluginConfig } = require("../config");
const { summarizeDiff, nativeAdapterOrError, objectCounts, loadScopeSet, approvalMatrix } = require("../helpers");
const { resolveProjectRootFromRequest } = require("./_shared");

const { renderOverview } = require("../renderers/overview");
const { renderStatus } = require("../renderers/status");
const { renderLiveDiff, renderPlanPreview } = require("../renderers/live-diff");
const { renderApprovals } = require("../renderers/approvals");
const { renderHealth } = require("../renderers/health");
const { deploymentsTable } = require("../renderers/deployments");
const { renderSettingsPage } = require("../renderers/settings");
const { renderGitPage } = require("../renderers/git");
const { renderProjectList, renderProjectForm, renderProjectDetail } = require("../renderers/projects");

const { normalizePack } = require("../../normalizer");
const { loadProjectState } = require("../../project-state");
const { loadChangeIntents } = require("../../change-intents");
const { VERSIONED_KINDS } = require("../../normalizer");

const pageRoutes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Saltcorn Project Sync", renderOverview()),
  },
  {
    url: "/project-sync/status",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Status", renderStatus({ projectRoot, error: adapter.error }));
      try {
        const info = await adapter.info();
        const exported = normalizePack(await adapter.exportProject());
        return sendPage(res, "Project Sync Status", renderStatus({ info, exported, projectRoot }));
      } catch (err) {
        return sendPage(res, "Project Sync Status", renderStatus({ projectRoot, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/live-diff",
    method: "get",
    callback: async (req, res) => {
      const ctx = await resolveProjectRootFromRequest(req);
      const projectId = ctx.projectId || req.query?.project_id || req.query?.projectId || "";
      const projectRoot = ctx.projectRoot;
      if (!projectRoot) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, projectId, error: ctx.error }), { noCache: true });
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, projectId, error: adapter.error }), { noCache: true });
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const scopeSet = await loadScopeSet(projectRoot);
        let untracked = [];
        if (scopeSet) {
          const KINDS = [...VERSIONED_KINDS, "plugins"];
          for (const kind of KINDS) {
            for (const obj of (desired[kind] || [])) {
              const key = `${kind}::${obj.name || obj.role}`;
              if (!scopeSet.has(key)) untracked.push({ kind, name: obj.name || obj.role });
            }
          }
        }
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, projectId, diff: summarizeDiff(desired, actual, scopeSet), untracked }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, projectId, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/plan-preview",
    method: "get",
    callback: async (req, res) => {
      const ctx = await resolveProjectRootFromRequest(req);
      const projectId = ctx.projectId || req.query?.project_id || req.query?.projectId || "";
      const projectRoot = ctx.projectRoot;
      if (!projectRoot) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, projectId, error: ctx.error }), { noCache: true });
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, projectId, error: adapter.error }), { noCache: true });
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        const { planProject } = require("../../planner");
        const plan = planProject({ desired, actual, intents, env, backup: false });
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, projectId, plan }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, projectId, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/approvals",
    method: "get",
    callback: async (req, res) => {
      const ctx = await resolveProjectRootFromRequest(req);
      const projectId = ctx.projectId || req.query?.project_id || req.query?.projectId || "";
      const projectRoot = ctx.projectRoot;
      if (!projectRoot) return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, projectId, error: ctx.error }));
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, projectId, error: adapter.error }));
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, projectId, approvals: approvalMatrix({ desired, actual, intents }) }));
      } catch (err) {
        return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, projectId, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/health",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Project Sync Health", renderHealth()),
  },
  {
    url: "/project-sync/deployments",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Project Sync Deployments", deploymentsTable()),
  },
  {
    url: "/project-sync/settings",
    method: "get",
    callback: async (req, res) => {
      if (!requirePageAuth(req, res)) return;
      if (!requireRootTenant(req, res)) return;
      try {
        const cfg = getPluginConfig();
        return sendPage(res, "Settings", renderSettingsPage({ cfg }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Settings", renderSettingsPage({ cfg: {}, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/git",
    method: "get",
    callback: async (req, res) => {
      const ctx = await resolveProjectRootFromRequest(req);
      const projectRoot = ctx.projectRoot;
      const projectId = ctx.projectId || req.query?.project_id || req.query?.projectId || null;
      if (!projectRoot) return sendPage(res, "Git", renderGitPage({ projectRoot, projectId, error: ctx.error }), { noCache: true });
      try {
        const gitOps = require("../../git-ops");
        if (!gitOps.isGitRepo(projectRoot)) return sendPage(res, "Git", renderGitPage({ projectRoot, projectId, error: "Not a git repository" }), { noCache: true });
        const status = gitOps.gitStatus(projectRoot);
        const branches = gitOps.gitBranches(projectRoot);
        const log = gitOps.gitLog(projectRoot, 15);
        const remoteUrl = gitOps.gitRemoteUrl(projectRoot);
        let branchMap = {};
        try {
          const bt = require("../../branch-tenant");
          const bm = await bt.loadBranchMap(projectRoot);
          branchMap = bm.branches || {};
        } catch { /* no branch map file yet */ }
        return sendPage(res, "Git", renderGitPage({ projectRoot, projectId, status, branches, log, remoteUrl, branchMap }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Git", renderGitPage({ projectRoot, projectId, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/projects",
    method: "get",
    callback: async (_req, res) => {
      try {
        const ps = require("../../project-setup");
        await ps.ensureDefaultProjectFromRoot();
        const projects = await ps.listProjects();
        return sendPage(res, "Projects", renderProjectList(projects));
      } catch (err) {
        return sendPage(res, "Projects", require("../../ui").pageShell("Projects", "/project-sync/projects",
          require("../../ui").card({ title: "Projects", icon: "fa-folder-open", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${require("../../ui").escapeHtml(err.message)}</div>` })
        ));
      }
    },
  },
  {
    url: "/project-sync/projects/new",
    method: "get",
    callback: async (_req, res) =>
      sendPage(res, "New Project", renderProjectForm()),
  },
  {
    url: "/project-sync/projects/:id",
    method: "get",
    callback: async (req, res) => {
      try {
        const ps = require("../../project-setup");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendPage(res, "Project", require("../../ui").pageShell("Project", "/project-sync/projects",
          require("../../ui").card({ title: "Project not found", icon: "fa-exclamation-triangle", body: require("../../ui").emptyState("fa-search", "Project not found.", "/project-sync/projects", "Back to projects") })
        ));
        const scoped = await ps.getScopedTenantObjects(project.id);
        return sendPage(res, `Project: ${project.name}`, renderProjectDetail(project, scoped));
      } catch (err) {
        return sendPage(res, "Project", require("../../ui").pageShell("Project", "/project-sync/projects",
          require("../../ui").card({ title: "Error", icon: "fa-exclamation-triangle", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${require("../../ui").escapeHtml(err.message)}</div>` })
        ));
      }
    },
  },
];

module.exports = pageRoutes;
