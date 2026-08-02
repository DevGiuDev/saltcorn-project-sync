const test = require("node:test");
const assert = require("node:assert/strict");
const { routes, deploymentsTable, authorized, applyAuthorized, validateApplyPayload, renderLiveDiff, renderPlanPreview, renderApprovals, summarizeDiff, approvalMatrix, objectCounts, escapeHtml, sendPage, sendJson } = require("../lib/plugin");

test("plugin exposes project sync routes", () => {
  assert(routes.some((route) => route.url === "/project-sync"));
  assert(routes.some((route) => route.url === "/project-sync/deployments"));
  assert(routes.some((route) => route.url === "/project-sync/api/deployments" && route.method === "get"));
  assert(routes.some((route) => route.url === "/project-sync/api/deployments" && route.method === "post"));
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

test("plan preview renders safe UI summaries", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.deepEqual(objectCounts({ tables: [{}], views: [{}, {}], plugins: [{}] }).tables, 1);
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

test("live diff compares only stable plugin lock fields", () => {
  const diff = summarizeDiff(
    { plugins: [{ name: "calendar", version: "1.2.3", source: "npm" }] },
    {
      plugins: [{
        name: "calendar",
        version: "1.2.3",
        source: "npm",
        configuration: {},
        location: "/tenant-local/path",
        deploy_private_key: "must-not-affect-diff",
      }],
    }
  );
  assert.deepEqual(diff.plugins, { created: [], updated: [], orphaned: [] });
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
  const missingBackup = validateApplyPayload({ env: "prod", desired: {}, plan: { operations: [] } });
  assert.equal(missingBackup.valid, false);
  assert(missingBackup.errors.some((error) => /verifiable backup metadata/.test(error)));

  const backedUp = validateApplyPayload({
    env: "prod",
    desired: {},
    backup: true,
    backup_metadata: { id: "backup-1", created_at: "2026-01-01T00:00:00Z" },
    plan: { operations: [] },
  });
  assert.equal(backedUp.valid, true);

  const destructive = validateApplyPayload({ env: "dev", desired: {}, plan: { operations: [{ action: "drop_field" }] } });
  assert.equal(destructive.valid, false);
  assert(destructive.errors.some((error) => /allow_destructive/.test(error)));

  const unknown = validateApplyPayload({ env: "qa", desired: {}, plan: { operations: [] } });
  assert.equal(unknown.valid, false);
  assert(unknown.errors.some((error) => /unsupported environment/.test(error)));
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

test("authorized accepts Bearer or same-origin admin session without exposing anonymous APIs", () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = "abc";
  assert.equal(authorized({ headers: { authorization: "Bearer abc" } }), true);
  assert.equal(authorized({ headers: { authorization: "Bearer wrong" } }), false);
  assert.equal(authorized({ method: "GET", user: { role_id: 1 }, headers: {} }), true);
  assert.equal(authorized({ method: "POST", user: { role_id: 1 }, headers: { host: "example.test", origin: "https://example.test" } }), true);
  assert.equal(authorized({ method: "POST", user: { role_id: 1 }, headers: { host: "example.test", origin: "https://evil.test" } }), false);
  assert.equal(applyAuthorized({ method: "POST", user: { role_id: 1 }, headers: { host: "example.test", origin: "https://example.test" } }), false);

  delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  assert.equal(authorized({ method: "GET", headers: {} }), false);
  assert.equal(authorized({ method: "GET", user: { role_id: 1 }, headers: {} }), true);

  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  else process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = old;
});
