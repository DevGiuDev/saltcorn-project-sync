const test = require("node:test");
const assert = require("node:assert/strict");

const { renderSettingsPage } = require("../lib/plugin/renderers/settings");
const {
  renderProjectList,
  renderProjectForm,
  renderProjectDetail,
} = require("../lib/plugin/renderers/projects");
const { renderGitPage } = require("../lib/plugin/renderers/git");
const { renderPlanPreview } = require("../lib/plugin/renderers/live-diff");
const { renderDeployPage } = require("../lib/plugin/renderers/deploy");

test("settings renderer is project-scoped and includes health", () => {
  const html = renderSettingsPage({
    project: {
      id: 7,
      name: "CRM",
      slug: "crm",
      description: "Customer app",
      min_version: "1.6.0",
      root_path: "/srv/projects/crm",
    },
    error: "No root",
  });
  assert.match(html, /CRM settings/);
  assert.match(html, /project-sync\/settings\?project_id=7/);
  assert.match(html, /id="project-setting-root-path"/);
  assert.match(html, /id="btn-save-project-settings"/);
  assert.match(html, /Health/);
  assert.match(html, /Precedence/);
  assert.match(html, /Managed SSH tunnel/);
  assert.match(html, /Generate token/);
  assert.match(html, /window\.SCPS_SETTINGS_PROJECT_ID = 7/);
  assert.match(html, /id="project-setting-backup-policy"/);
  assert.match(html, /id="project-setting-ui-mode"/);
  assert.match(html, /alert-danger/);
});

test("settings renderer asks to choose a project first", () => {
  const html = renderSettingsPage({ project: null });
  assert.match(html, /Choose a project first/);
  assert.match(html, /Open projects/);
});

test("project renderers keep card links, forms, and scope action hooks", () => {
  const listHtml = renderProjectList([{
    id: 7,
    name: "CRM",
    slug: "crm",
    description: "Customer app",
    root_path: "/srv/projects/crm",
    updated_at: "2026-05-15T12:00:00Z",
  }]);
  assert.match(listHtml, /card card-link h-100/);
  assert.match(listHtml, /<code>crm<\/code>/);
  assert.match(listHtml, /New project/);

  const formHtml = renderProjectForm();
  assert.match(formHtml, /id="project-form"/);
  assert.match(formHtml, /id="inp-name"/);
  assert.match(formHtml, /id="inp-slug"/);
  assert.match(formHtml, /Create project/);

  const detailHtml = renderProjectDetail({
    id: 7,
    name: "CRM",
    slug: "crm",
    description: "Customer app",
    min_version: "1.6.0",
    root_path: "/srv/projects/crm",
  }, {
    tables: [{ name: "customers", included: true, field_count: 2, auto_detected: "manual", tags: ["core"] }],
    views: [],
    pages: [],
    triggers: [],
    roles: [],
    plugins: [],
    menu: [],
    settings: [{ name: "site_name", included: true, auto_detected: "stable_setting" }],
  });
  assert.match(detailHtml, /project-sync\/git\?project_id=7/);
  assert.match(detailHtml, /project-sync\/live-diff\?project_id=7/);
  assert.match(detailHtml, /project-sync\/plan-preview\?project_id=7/);
  assert.match(detailHtml, /project-sync\/approvals\?project_id=7/);
  assert.match(detailHtml, /project-sync\/settings\?project_id=7/);
  assert.match(detailHtml, /id="btn-download"/);
  assert.match(detailHtml, /id="btn-write-disk"/);
  assert.match(detailHtml, /id="btn-save-scope"/);
  assert.match(detailHtml, /id="scope-tabs"/);
  assert.match(detailHtml, /id="scope-settings-tab"/);
  assert.match(detailHtml, /data-kind="settings" data-name="site_name"/);
  assert.match(detailHtml, /stable setting/);
  assert.match(detailHtml, /fa-code-branch/);
  assert.match(detailHtml, /class="badge bg-primary">crm<\/span>/);
  assert.match(detailHtml, /scope-toggle/);
  assert.match(detailHtml, /scps-col-filter/);
});

test("plan renderer shows targets for settings and menu entries", () => {
  const html = renderPlanPreview({
    projectRoot: "/srv/project",
    projectId: 7,
    plan: {
      operations: [
        { action: "create_setting", setting: "site_name", safe: true },
        { action: "update_menu", menu: "menu_items", safe: true },
      ],
      warnings: [
        { type: "orphaned_setting", setting: "search_use_websearch" },
        { type: "orphaned_menu", menu: "legacy_menu" },
      ],
      blocked: [],
      backup_required: false,
    },
  });
  assert.match(html, /search_use_websearch/);
  assert.match(html, /legacy_menu/);
  assert.match(html, /site_name/);
  assert.match(html, /menu_items/);
});

test("git renderer exposes a client-style workspace and action hooks", () => {
  const gitHtml = renderGitPage({
    projectRoot: "/srv/project",
    status: {
      branch: "main",
      clean: false,
      ahead: 1,
      behind: 2,
      staged: [{ status: "M", path: "project.json" }],
      unstaged: [{ status: "M", path: "tables/customers.json" }],
      untracked: ["views/by_customer.json"],
      conflicted: [],
    },
    branches: { current: "main", local: ["main", "feature/demo"] },
    log: { commits: [{ hash: "abc123", message: "feat: ui", author: "Dev", date: "2026-05-15" }] },
    remoteUrl: { ok: true, stdout: "origin" },
    branchMap: { "feature/demo": { tenant: "feature_demo" } },
    projectId: 7,
  });
  assert.match(gitHtml, /project-sync\/live-diff\?project_id=7/);
  assert.match(gitHtml, /project-sync\/plan-preview\?project_id=7/);
  assert.match(gitHtml, /project-sync\/approvals\?project_id=7/);
  assert.match(gitHtml, /project-sync\/settings\?project_id=7/);
  assert.match(gitHtml, /id="btn-git-commit"/);
  assert.match(gitHtml, /id="btn-git-pull"/);
  assert.match(gitHtml, /id="btn-create-branch"/);
  assert.match(gitHtml, /class="scps-git-layout"/);
  assert.match(gitHtml, /stage-btn/);
  assert.match(gitHtml, /unstage-btn/);
  assert.match(gitHtml, /checkout-btn/);
  assert.match(gitHtml, /window\.SCPS_GIT_PROJECT_ID = 7/);
  assert.match(gitHtml, /scps-repo-path[^>]*>\/srv\/project/);
  assert.match(gitHtml, /Working tree/);
  assert.match(gitHtml, /Recent history/);
});

test("deploy renderer exposes immutable preview and confirmation workflow", () => {
  const html = renderDeployPage({ project: { id: 7, name: "CRM" }, environment: "dev", defaultRef: "develop", backupPolicy: "optional" });
  assert.match(html, /data-rail="source">Source/);
  assert.match(html, /data-rail="preflight">Preflight/);
  assert.match(html, /data-rail="receipt">Receipt/);
  assert.match(html, /id="btn-deploy-preview"/);
  assert.match(html, /id="btn-deploy-confirm"/);
  assert.match(html, /id="deploy-scope-changes"/);
  assert.match(html, /id="deploy-source-ref" class="form-select"/);
  assert.match(html, /Configured branch/);
  assert.match(html, /This profile selects tenant, safety policy and backup provider/);
  assert.doesNotMatch(html, /id="btn-deploy-environment"/);
  assert.doesNotMatch(html, /id="deploy-fetch-source"/);
  assert.match(html, /window\.SCPS_DEPLOY/);
});

test("deployment navigation hides workspace-only tools", () => {
  const html = renderDeployPage({ project: { id: 7, name: "CRM" }, environment: "dev", defaultRef: "main", uiMode: "deployment" });
  assert.match(html, /project-sync\/projects\/7\/deploy/);
  assert.match(html, /project-sync\/settings\?project_id=7/);
  assert.doesNotMatch(html, /project-sync\/git\?project_id=7/);
  assert.doesNotMatch(html, /project-sync\/live-diff\?project_id=7/);
});
