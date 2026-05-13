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

test("rename_table intent converts orphan/create pair into rename", () => {
  const plan = planTables({
    desiredTables: [{ name: "customers", fields: [{ name: "email", type: "String" }] }],
    actualTables: [{ name: "clients", fields: [{ name: "email", type: "String" }] }],
    intents: [{ id: "rename-table", type: "rename_table", from: "clients", to: "customers", reason: "test" }],
  });
  assert.deepEqual(plan.operations, [{ action: "rename_table", from: "clients", to: "customers", safe: false }]);
  assert.deepEqual(plan.warnings, []);
});

test("rename_table intent is ignored when target is not desired", () => {
  const plan = planTables({
    desiredTables: [{ name: "customers", fields: [] }],
    actualTables: [{ name: "clients", fields: [] }],
    intents: [{ id: "rename-table", type: "rename_table", from: "clients", to: "people", reason: "test" }],
  });
  assert(plan.operations.some((op) => op.action === "create_table" && op.table === "customers"));
  assert.equal(plan.warnings[0].type, "orphaned_table");
});

test("field type changes are blocked without alter intent", () => {
  const plan = planTables({
    desiredTables: [{ name: "invoices", fields: [{ name: "total", type: "Integer" }] }],
    actualTables: [{ name: "invoices", fields: [{ name: "total", type: "Float" }] }],
  });
  assert.equal(plan.blocked[0].code, "field_type_change_requires_intent");
});

test("alter_field_type intent enables explicit type change", () => {
  const plan = planTables({
    desiredTables: [{ name: "invoices", fields: [{ name: "total", type: "Integer" }] }],
    actualTables: [{ name: "invoices", fields: [{ name: "total", type: "Float" }] }],
    intents: [{ id: "alter", type: "alter_field_type", table: "invoices", field: "total", from: "Float", to: "Integer", reason: "test" }],
  });
  assert.equal(plan.operations[0].action, "alter_field_type");
});
