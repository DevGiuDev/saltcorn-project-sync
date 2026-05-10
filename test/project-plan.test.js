const test = require("node:test");
const assert = require("node:assert/strict");
const { planProject } = require("../lib/planner");

test("prod plan is blocked without backup", () => {
  const plan = planProject({ desired: {}, actual: {}, env: "prod" });
  assert.equal(plan.backup_required, true);
  assert.equal(plan.blocked[0].code, "backup_required");
});

test("generic objects are planned and orphaned safely", () => {
  const plan = planProject({
    desired: { views: [{ name: "invoice_list" }] },
    actual: { views: [{ name: "old_invoice_list" }] },
    env: "dev",
  });
  assert(plan.operations.some((op) => op.action === "create_view"));
  assert(plan.warnings.some((warning) => warning.type === "orphaned_view"));
});
