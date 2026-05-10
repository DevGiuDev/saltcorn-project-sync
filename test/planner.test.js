const test = require("node:test");
const assert = require("node:assert/strict");
const { planTables } = require("../lib/planner");

const desiredTables = [
  { name: "invoices", fields: [{ name: "status", type: "String" }, { name: "total", type: "Float" }] },
];
const actualTables = [
  { name: "invoices", fields: [{ name: "old_status", type: "String" }, { name: "total", type: "Float" }] },
];

test("orphaned fields are preserved without intent", () => {
  const plan = planTables({ desiredTables, actualTables, env: "prod" });
  assert.deepEqual(plan.operations, [{ action: "create_field", table: "invoices", field: "status", safe: true }]);
  assert.equal(plan.warnings[0].type, "orphaned_field");
  assert.equal(plan.warnings[0].field, "old_status");
});

test("rename intent enables explicit rename operation", () => {
  const plan = planTables({
    desiredTables,
    actualTables,
    env: "prod",
    intents: [
      { id: "rename", type: "rename_field", table: "invoices", from: "old_status", to: "status", reason: "test" },
    ],
  });
  assert(plan.operations.some((op) => op.action === "rename_field" && op.from === "old_status"));
});
