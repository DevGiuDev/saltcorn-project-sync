/**
 * Page routes (GET → HTML rendering).
 */
const { sendPage } = require("../auth");
const { summarizeDiff, nativeAdapterOrError, loadScopeSet, approvalMatrix } = require("../helpers");
const { resolveProjectRootFromRequest } = require("./_shared");

const { renderLiveDiff, renderPlanPreview } = require("../renderers/live-diff");
const { renderApprovals } = require("../renderers/approvals");
const { deploymentsTable } = require("../renderers/deployments");
const { renderSettingsPage } = require("../renderers/settings");
const { renderGitPage } = require("../renderers/git");
const { renderProjectList, renderProjectForm, renderProjectDetail } = require("../renderers/projects");
const { renderDeployPage } = require("../renderers/deploy");
const { globalNav, escapeHtml } = require("../renderers/_shared");

const { normalizePack } = require("../../normalizer");
const { loadProjectState } = require("../../project-state");
const { loadChangeIntents } = require("../../change-intents");
const { VERSIONED_KINDS } = require("../../normalizer");

const pageRoutes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async (_req, res) => res.redirect("/project-sync/projects"),
  },
  {
    url: "/project-sync/status",
    method: "get",
    callback: async (_req, res) => res.redirect("/project-sync/projects"),
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
    callback: async (_req, res) => res.redirect("/project-sync/projects"),
  },
  {
    url: "/project-sync/deployments",
    method: "get",
    callback: async (_req, res) => {
      try {
        const { listDeploymentRecords } = require("../deployment-ledger");
        const records = await listDeploymentRecords({ limit: 100 });
        return sendPage(res, "Project Sync Deployments", deploymentsTable(records, { source: "target" }));
      } catch (error) {
        return sendPage(res, "Project Sync Deployments", deploymentsTable(process.cwd(), { source: "local", error: error.message }));
      }
    },
  },
  {
    url: "/project-sync/settings",
    method: "get",
    callback: async (req, res) => {
      try {
        const ps = require("../../project-setup");
        const projectId = req.query?.project_id || req.query?.projectId || "";
        if (!projectId) return sendPage(res, "Settings", renderSettingsPage({ project: null }), { noCache: true });
        const project = await ps.getProject(projectId);
        if (!project) return sendPage(res, "Settings", renderSettingsPage({ project: null, error: "Project not found" }), { noCache: true });
        const environment = req.query?.environment || req.query?.env || "dev";
        const environmentConfig = await require("../operational-config").getOperationalConfig(project.id, environment);
        const { resolveEnvironmentConfig } = require("../../environment");
        const resolved = resolveEnvironmentConfig({ projectDir: project.root_path || process.cwd(), env: environment, uiConfig: environmentConfig, defaults: { adapter: "native", transport: "direct" } });
        const health = await require("../setup-health").runSetupHealth({ project, resolved });
        const tokens = await require("../token-store").listTokens();
        return sendPage(
          res,
          `Settings: ${project.name}`,
          renderSettingsPage({ project, environment, environmentConfig, resolved, health, tokens }),
          { noCache: true }
        );
      } catch (err) {
        return sendPage(res, "Settings", renderSettingsPage({ project: null, error: err.message }), { noCache: true });
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
        return sendPage(res, "Projects", globalNav("projects") + `<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-folder-open me-2"></i>Projects</h5></div><div class="card-body"><div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(err.message)}</div></div></div>`);
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
    url: "/project-sync/projects/:id/deploy",
    method: "get",
    callback: async (req, res) => {
      try {
        const environment = req.query?.environment || req.query?.env || "dev";
        const context = await require("../deploy-service").projectContext(req.params.id, environment);
        const deployService = require("../deploy-service");
        deployService.assertTargetTenant(context);
        const policy = require("../../deploy-orchestrator").backupPolicy(environment, context.resolved.config.backup_policy);
        const info = await deployService.deploymentAdapter(context).info();
        return sendPage(res, `Deploy: ${context.project.name}`, renderDeployPage({
          project: context.project,
          environment,
          defaultRef: context.default_ref,
          backupPolicy: policy,
          backupReady: info?.backup_provider?.ready === true,
          backupProvider: info?.backup_provider?.type || "none",
        }), { noCache: true });
      } catch (err) {
        const project = await require("../../project-setup").getProject(req.params.id).catch(() => null);
        return sendPage(res, "Deploy", renderDeployPage({ project, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/projects/:id",
    method: "get",
    callback: async (req, res) => {
      try {
        const ps = require("../../project-setup");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendPage(res, "Project", globalNav("projects") + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Project not found</h5></div><div class="card-body text-center text-muted py-5"><i class="fas fa-search fa-3x opacity-25 mb-3"></i><p>Project not found.</p><a href="/project-sync/projects" class="btn btn-primary btn-sm">Back to projects</a></div></div>');
        const scoped = await ps.getScopedTenantObjects(project.id);
        return sendPage(res, `Project: ${project.name}`, renderProjectDetail(project, scoped));
      } catch (err) {
        return sendPage(res, "Project", globalNav("projects") + `<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Error</h5></div><div class="card-body"><div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(err.message)}</div></div></div>`);
      }
    },
  },
];

module.exports = pageRoutes;
