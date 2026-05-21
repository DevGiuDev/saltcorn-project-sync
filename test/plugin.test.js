const test = require("node:test");
const assert = require("node:assert/strict");
const { routes, deploymentsTable, authorized, applyAuthorized, validateApplyPayload, renderStatus, renderLiveDiff, renderPlanPreview, renderApprovals, summarizeDiff, approvalMatrix, objectCounts, escapeHtml, sendPage, sendJson } = require("../lib/plugin");

test("plugin exposes project sync routes", () => {
  assert(routes.some((route) => route.url === "/project-sync"));
  assert(routes.some((route) => route.url === "/project-sync/deployments"));
  assert(routes.some((route) => route.url === "/project-sync/status"));
  assert(routes.some((route) => route.url === "/project-sync/live-diff"));
  assert(routes.some((route) => route.url === "/project-sync/plan-preview"));
  assert(routes.some((route) => route.url === "/project-sync/approvals"));
  assert(routes.some((route) => route.url === "/project-sync/api/status"));
  assert(routes.some((route) => route.url === "/project-sync/api/live-diff"));
  assert(routes.some((route) => route.url === "/project-sync/api/plan-preview"));
  assert(routes.some((route) => route.url === "/project-sync/api/approvals"));
  assert(routes.some((route) => route.url === "/api/project-sync/export"));
  assert(routes.some((route) => route.url === "/project-sync/api/apply"));
});

test("status and plan preview render safe UI summaries", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.deepEqual(objectCounts({ tables: [{}], views: [{}, {}], plugins: [{}] }).tables, 1);
  const status = renderStatus({
    info: {
      adapter: "native",
      saltcorn_version: "1.2.3",
      capabilities: { resources: { tables: { export: true, apply: true, destructive: false } } },
    },
    exported: { tables: [{ name: "t" }], plugins: [] },
    projectRoot: "/srv/project",
  });
  assert.match(status, /Project Status/);
  assert.match(status, /Live Object Counts/);

  const preview = renderPlanPreview({
    projectRoot: "/srv/project",
    plan: { operations: [{ action: "create_table", table: "customers", safe: true }], warnings: [], blocked: [], backup_required: false },
  });
  assert.match(preview, /Plan/);
  assert.match(preview, /create_table/);
});

test("live diff renders drift and preserves orphan wording", () => {
  const diff = summarizeDiff(
    { tables: [{ name: "customers", fields: [{ name: "email" }] }], plugins: [{ name: "calendar" }] },
    { tables: [{ name: "clients", fields: [{ name: "legacy" }] }], plugins: [{ name: "legacy-plugin" }] }
  );
  const html = renderLiveDiff({ projectRoot: "/srv/project", diff });
  assert.match(html, /Live Diff/);
  assert.match(html, /customers/);
  assert.match(html, /clients/);
  assert.match(html, /preserved by default/);
  assert.match(html, /legacy-plugin/);
});

test("live diff explains missing project selection", () => {
  assert.match(renderLiveDiff({ projectRoot: "" }), /Choose a project first/);
  assert.match(renderLiveDiff({ projectRoot: "" }), /Live Diff/);
});

test("approval controls summarize environment gates", () => {
  const approvals = approvalMatrix({
    desired: { tables: [{ name: "customers", fields: [] }] },
    actual: { tables: [] },
    intents: [],
  });
  assert.equal(approvals.length, 4);
  assert(approvals.some((row) => row.env === "prod" && row.backup_required && row.blocked));
  const html = renderApprovals({ projectRoot: "/srv/project", approvals });
  assert.match(html, /Approval Controls/);
  assert.match(html, /saltcorn-project-sync apply/);
  assert.match(html, /Blocker Details/);
  assert.match(html, /prod/);
});

test("approval controls explain missing project selection", () => {
  assert.match(renderApprovals({ projectRoot: "" }), /Choose a project first/);
  assert.match(renderApprovals({ projectRoot: "" }), /Approval Controls/);
});

test("plan preview explains missing project selection", () => {
  assert.match(renderPlanPreview({ projectRoot: "" }), /Choose a project first/);
  assert.match(renderPlanPreview({ projectRoot: "" }), /Plan/);
});

test("deploymentsTable handles missing log", () => {
  assert.match(deploymentsTable("/definitely/missing/project/root"), /No deployment records/);
});

test("deploymentsTable displays rollback kind", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { appendRollbackRecord } = require("../lib/deployments");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-ui-rollback-"));
  appendRollbackRecord(dir, { env: "prod", status: "restored-live", rollback_of: "deploy-000001" });
  const html = deploymentsTable(dir);
  assert.match(html, /rollback/);
  assert.match(html, /deploy-000001/);
});

test("sendPage and sendJson write to express response", () => {
  const calls = [];
  const pageRes = { sendWrap: (title, body) => calls.push(["wrap", title, body]) };
  sendPage(pageRes, "T", "B");
  assert.deepEqual(calls[0], ["wrap", "T", "B"]);

  const jsonRes = {
    status: (code) => ({ json: (body) => calls.push(["json", code, body]) }),
    json: () => {},
  };
  sendJson(jsonRes, { ok: true }, 201);
  assert.deepEqual(calls[1], ["json", 201, { ok: true }]);
});

test("validateApplyPayload guards REST apply", () => {
  const result = validateApplyPayload({ env: "prod", desired: {}, plan: { operations: [] } });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => /restricted/.test(error)));
  const destructive = validateApplyPayload({ env: "dev", desired: {}, plan: { operations: [{ action: "drop_field" }] } });
  assert.equal(destructive.valid, false);
});

test("applyAuthorized requires configured bearer token", () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  assert.equal(applyAuthorized({ headers: {} }), false);
  process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = "abc";
  assert.equal(applyAuthorized({ headers: { authorization: "Bearer abc" } }), true);
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  else process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = old;
});

test("authorized checks bearer token when configured", () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = "abc";
  assert.equal(authorized({ headers: { authorization: "Bearer abc" } }), true);
  assert.equal(authorized({ headers: { authorization: "Bearer wrong" } }), false);
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  else process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = old;
});
