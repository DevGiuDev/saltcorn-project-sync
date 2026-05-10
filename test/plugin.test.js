const test = require("node:test");
const assert = require("node:assert/strict");
const { routes, deploymentsTable, authorized, applyAuthorized, validateApplyPayload, sendPage, sendJson } = require("../lib/plugin");

test("plugin exposes project sync routes", () => {
  assert(routes.some((route) => route.url === "/project-sync"));
  assert(routes.some((route) => route.url === "/project-sync/deployments"));
  assert(routes.some((route) => route.url === "/api/project-sync/export"));
  assert(routes.some((route) => route.url === "/api/project-sync/apply"));
});

test("deploymentsTable handles missing log", () => {
  assert.match(deploymentsTable("/definitely/missing/project/root"), /No deployment records/);
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
