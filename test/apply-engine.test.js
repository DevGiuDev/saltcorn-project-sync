const test = require("node:test");
const assert = require("node:assert/strict");
const { applyProject } = require("../lib/apply-engine");

const desired = {
  tables: [
    { name: "invoices", fields: [{ name: "status", type: "String" }, { name: "total", type: "Float" }] },
  ],
};
const actual = {
  tables: [
    { name: "invoices", fields: [{ name: "old_status", type: "String" }, { name: "total", type: "Float" }] },
  ],
};

test("applyProject creates desired fields but preserves orphaned fields", () => {
  const result = applyProject({ desired, actual, env: "dev" });
  const fields = result.state.tables[0].fields.map((field) => field.name).sort();
  assert.equal(result.applied, true);
  assert.deepEqual(fields, ["old_status", "status", "total"]);
});

test("applyProject refuses prod without backup", () => {
  const result = applyProject({ desired, actual, env: "prod" });
  assert.equal(result.applied, false);
  assert.equal(result.errors[0], "plan has blocked operations");
});

test("applyProject can execute explicit rename intent", () => {
  const result = applyProject({
    desired,
    actual,
    env: "prod",
    backup: true,
    intents: [
      { id: "rename", type: "rename_field", table: "invoices", from: "old_status", to: "status", reason: "test" },
    ],
  });
  const fields = result.state.tables[0].fields.map((field) => field.name).sort();
  assert.equal(result.applied, true);
  assert.deepEqual(fields, ["status", "total"]);
});
