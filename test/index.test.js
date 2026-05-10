const test = require("node:test");
const assert = require("node:assert/strict");
const plugin = require("../index");

test("Saltcorn entrypoint exposes config-aware routes function", () => {
  assert.equal(typeof plugin.configuration_workflow, "function");
  assert.equal(typeof plugin.routes, "function");
  assert(plugin.routes({}).some((route) => route.url === "/project-sync"));
});
