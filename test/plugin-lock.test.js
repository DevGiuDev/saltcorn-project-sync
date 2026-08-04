const test = require("node:test");
const assert = require("node:assert/strict");
const { planPlugins, planProject } = require("../lib/planner");
const { applyProject } = require("../lib/apply-engine");

const desiredPlugins = [
  { name: "calendar", version: "1.2.0", source: "npm" },
  { name: "maps", version: "2.0.0", source: "npm" },
];
const actualPlugins = [
  { name: "calendar", version: "1.1.0", source: "npm" },
  { name: "legacy", version: "0.1.0", source: "npm" },
];

test("planPlugins installs and updates locked plugins but preserves orphaned plugins", () => {
  const plan = planPlugins(desiredPlugins, actualPlugins);
  assert.deepEqual(plan.operations, [
    { action: "install_plugin", plugin: "maps", version: "2.0.0", safe: true },
    { action: "update_plugin", plugin: "calendar", version: "1.2.0", safe: true },
  ]);
  assert.deepEqual(plan.warnings, [{ type: "orphaned_plugin", plugin: "legacy", message: "Preserved by default" }]);
});

test("planPlugins does not try to install or update bundled plugins", () => {
  const plan = planPlugins(
    [{ name: "base", version: null, source: "builtin" }],
    [{ name: "base", version: "latest", source: "npm" }]
  );
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.warnings, []);
});

test("planPlugins ignores Saltcorn plugin export noise", () => {
  const plan = planPlugins(
    [{ name: "base", version: "latest", source: "npm" }],
    [{ name: "base", version: "latest", source: "npm", location: "@saltcorn/base-plugin", configuration: null, deploy_private_key: "__REDACTED__" }]
  );
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.warnings, []);
});

test("drop_plugin requires explicit intent", () => {
  const plan = planPlugins(desiredPlugins, actualPlugins, [
    { id: "drop-legacy", type: "drop_plugin", plugin: "legacy", reason: "unused" },
  ]);
  assert(plan.operations.some((op) => op.action === "drop_plugin" && op.plugin === "legacy"));
  assert.equal(plan.warnings.length, 0);
});

test("applyProject applies plugin lock changes without deleting orphans", () => {
  const result = applyProject({
    desired: { plugins: desiredPlugins },
    actual: { plugins: actualPlugins },
    env: "dev",
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.state.plugins.map((plugin) => `${plugin.name}@${plugin.version}`), [
    "calendar@1.2.0",
    "legacy@0.1.0",
    "maps@2.0.0",
  ]);
});

test("planProject includes plugin lock changes", () => {
  const plan = planProject({ desired: { plugins: desiredPlugins }, actual: { plugins: actualPlugins } });
  assert(plan.operations.some((op) => op.action === "install_plugin" && op.plugin === "maps"));
  assert(plan.operations.some((op) => op.action === "update_plugin" && op.plugin === "calendar"));
});

test("planPlugins does not drift when only the source differs (local vs npm)", () => {
  // Same plugin, same version, different source: dev has it as "local", prod
  // as "npm". This is legitimate (source is machine-specific) and must NOT
  // produce an update_plugin, otherwise the plan never converges.
  const plan = planPlugins(
    [{ name: "saltcorn-project-sync", version: "0.6.1", source: "local" }],
    [{ name: "saltcorn-project-sync", version: "0.6.1", source: "npm" }]
  );
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.warnings, []);
});
