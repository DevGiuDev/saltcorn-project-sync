const test = require("node:test");
const assert = require("node:assert/strict");
const { routes, deploymentsTable } = require("../lib/plugin");

test("plugin exposes project sync routes", () => {
  assert(routes.some((route) => route.url === "/project-sync"));
  assert(routes.some((route) => route.url === "/project-sync/deployments"));
});

test("deploymentsTable handles missing log", () => {
  assert.match(deploymentsTable("/definitely/missing/project/root"), /No deployment records/);
});
