const test = require("node:test");
const assert = require("node:assert/strict");

const { renderSettingsPage } = require("../lib/plugin/renderers/settings");
const {
  renderProjectList,
  renderProjectForm,
  renderProjectDetail,
} = require("../lib/plugin/renderers/projects");
const { renderOverview } = require("../lib/plugin/renderers/overview");
const { renderGitPage } = require("../lib/plugin/renderers/git");

test("settings renderer keeps helper-driven form controls and ids", () => {
  const html = renderSettingsPage({ cfg: {}, error: "No root" });
  assert.match(html, /Plugin Settings/);
  assert.match(html, /id="setting-project-root"/);
  assert.match(html, /id="btn-browse-root"/);
  assert.match(html, /id="btn-save-settings"/);
  assert.match(html, /alert-danger/);
  assert.match(html, /SALTCORN_PROJECT_SYNC_PROJECT_ROOT/);
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
  });
  assert.match(detailHtml, /id="btn-download"/);
  assert.match(detailHtml, /id="btn-write-disk"/);
  assert.match(detailHtml, /id="btn-save-scope"/);
  assert.match(detailHtml, /class="badge bg-primary">crm<\/span>/);
  assert.match(detailHtml, /scope-toggle/);
});

test("overview and git renderers preserve primary navigation and JS hooks", () => {
  const overviewHtml = renderOverview();
  assert.match(overviewHtml, /Saltcorn Project Sync/);
  assert.match(overviewHtml, /Core safety rule/);
  assert.match(overviewHtml, /title="Plugin settings"/);
  assert.match(overviewHtml, /Companion CLI/);

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
  });
  assert.match(gitHtml, /id="btn-git-commit"/);
  assert.match(gitHtml, /id="btn-git-pull"/);
  assert.match(gitHtml, /id="btn-create-branch"/);
  assert.match(gitHtml, /class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn"/);
  assert.match(gitHtml, /class="btn btn-outline-secondary btn-sm py-0 px-2 checkout-btn"/);
  assert.match(gitHtml, /<code>\/srv\/project<\/code>/);
});
