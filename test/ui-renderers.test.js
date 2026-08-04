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
const { renderMigrationsPage } = require("../lib/plugin/renderers/migrations");

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

  const autoAddedHtml = renderProjectDetail({ id: 8, name: "Automatic", slug: "automatic" }, {
    tables: [{ name: "new_table", included: true, has_scope: true, auto_detected: "new_object" }],
  });
  assert.match(autoAddedHtml, /auto-added/);
  assert.match(autoAddedHtml, /New tenant objects are added to this project scope automatically/);
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
      staged: [{ status: "A", path: "objects/views/dashboard.json" }],
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
  assert.match(gitHtml, /id="git-commit-push"/);
  assert.doesNotMatch(gitHtml, /git-commit-sync-scope/);
  assert.match(gitHtml, /added to the portable deployment scope automatically/);
  assert.match(gitHtml, /btn-git-push[^>]*btn-warning/);
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

// ─── Migrations / Seeds manager ─────────────────────────────

test("migrations renderer asks to choose a project when no root is set", () => {
  const html = renderMigrationsPage({ projectId: "", projectRoot: "" });
  assert.match(html, /Data scripts/);
  assert.match(html, /Choose a project first/);
});

test("migrations renderer shows empty blocks and create buttons when a root is configured", () => {
  const html = renderMigrationsPage({
    project: { id: 3, name: "Shop" },
    projectId: 3,
    projectRoot: "/srv/shop",
    environment: "dev",
    migrations: [],
    seeds: [],
  });
  assert.match(html, /Data scripts/);
  assert.match(html, /project-sync\/migrations\?project_id=3/);
  // Two blocks per kind (once + always) with their empty states
  assert.match(html, /Single execution \(once\)/);
  assert.match(html, /Recurring \(always\)/);
  assert.match(html, /id="btn-new-migration"/);
  assert.match(html, /id="btn-new-seed"/);
  assert.match(html, /id="dataEditorModal"/);
  assert.match(html, /id="wizardModal"/);
});

test("migrations renderer splits migrations into once and always blocks", () => {
  const html = renderMigrationsPage({
    project: { id: 3, name: "Shop" },
    projectId: 3,
    projectRoot: "/srv/shop",
    migrations: [
      { file: "001-idx.json", name: "create-index", phase: "pre-deploy", run: "once", steps: 1, valid: true, ledger_status: "applied", ledger_applied_at: "2026-08-03T12:00:00Z" },
      { file: "002-backfill.json", name: "backfill", phase: "post-deploy", run: "once", steps: 2, valid: false, ledger_status: null },
      { file: "003-recurring.json", name: "recurring-cleanup", phase: "pre-deploy", run: "always", steps: 1, valid: true, ledger_status: null },
    ],
    seeds: [],
  });
  assert.match(html, /001-idx\.json/);
  assert.match(html, /create-index/);
  assert.match(html, /pre-deploy/);
  assert.match(html, /post-deploy/);
  assert.match(html, /applied/);
  assert.match(html, /pending/);
  assert.match(html, /invalid/);
  // The recurring migration lands in the "always" block
  assert.match(html, /003-recurring\.json/);
  assert.match(html, /recurring-cleanup/);
});

test("migrations renderer editor modal has fixed controls container and tabs", () => {
  const html = renderMigrationsPage({ project: { id: 3 }, projectId: 3, projectRoot: "/srv/p", migrations: [], seeds: [] });
  // Fixed controls and step editor shells (populated by JS)
  assert.match(html, /id="fixed-controls"/);
  assert.match(html, /id="step-editor"/);
  assert.match(html, /id="wizard-buttons"/);
  // Tabs (form + raw JSON)
  assert.match(html, /id="tab-form-btn"/);
  assert.match(html, /id="tab-json-btn"/);
  assert.match(html, /id="data-editor-json"/);
  // Monaco-friendly textarea for raw JSON (static in the JSON tab)
  assert.match(html, /class="to-code"/);
  assert.match(html, /mode="application\/json"/);
});

test("migrations renderer wizard buttons include the main recipes", () => {
  const html = renderMigrationsPage({ project: { id: 3 }, projectId: 3, projectRoot: "/srv/p", migrations: [], seeds: [] });
  // The wizard button container exists; the buttons themselves are injected by JS.
  assert.match(html, /id="wizard-buttons"/);
  assert.match(html, /id="wizardModal"/);
  assert.match(html, /id="wizard-confirm"/);
});

test("migrations renderer lists seeds with mode badges and run blocks", () => {
  const html = renderMigrationsPage({
    project: { id: 3, name: "Shop" },
    projectId: 3,
    projectRoot: "/srv/shop",
    migrations: [],
    seeds: [
      { file: "001-countries.json", name: "countries", phase: "post-deploy", mode: "upsert", run: "always", tables: 1, valid: true },
      { file: "002-fixture.json", name: "fixture-once", phase: "post-deploy", mode: "upsert", run: "once", tables: 2, valid: true },
    ],
  });
  assert.match(html, /001-countries\.json/);
  assert.match(html, /upsert/);
  assert.match(html, /002-fixture\.json/);
});

test("migrations renderer shows error banner when present", () => {
  const html = renderMigrationsPage({ project: { id: 1 }, projectId: 1, projectRoot: "/srv/p", error: "disk full" });
  assert.match(html, /alert-danger/);
  assert.match(html, /disk full/);
});

test("migrations renderer exposes project id to client script", () => {
  const html = renderMigrationsPage({ project: { id: 9 }, projectId: 9, projectRoot: "/srv/p", migrations: [], seeds: [] });
  assert.match(html, /window\.SCPS_DATA_PROJECT_ID = 9/);
  assert.match(html, /window\.SCPS_DATA_ENVIRONMENT = "dev"/);
});

test("splitByRun separates once and always items", () => {
  const { splitByRun } = require("../lib/plugin/renderers/migrations");
  const items = [{ name: "a", run: "once" }, { name: "b", run: "always" }, { name: "c" }];
  const { once, always } = splitByRun(items);
  assert.equal(once.length, 2); // a + c (default once)
  assert.equal(always.length, 1); // b
  assert.equal(always[0].name, "b");
});
