const test = require("node:test");
const assert = require("node:assert/strict");
const { routes, deploymentsTable, authorized } = require("../lib/plugin");

test("plugin exposes project sync routes", () => {
  assert(routes.some((route) => route.url === "/project-sync"));
  assert(routes.some((route) => route.url === "/project-sync/deployments"));
  assert(routes.some((route) => route.url === "/api/project-sync/export"));
});

test("deploymentsTable handles missing log", () => {
  assert.match(deploymentsTable("/definitely/missing/project/root"), /No deployment records/);
});

test("authorized checks bearer token when configured", () => {
  const old = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = "abc";
  assert.equal(authorized({ headers: { authorization: "Bearer abc" } }), true);
  assert.equal(authorized({ headers: { authorization: "Bearer wrong" } }), false);
  if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_API_TOKEN;
  else process.env.SALTCORN_PROJECT_SYNC_API_TOKEN = old;
});
