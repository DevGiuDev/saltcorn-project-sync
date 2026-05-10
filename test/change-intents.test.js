const test = require("node:test");
const assert = require("node:assert/strict");
const { validateChangeIntent } = require("../lib/change-intents");

test("rename_field requires table/from/to", () => {
  const result = validateChangeIntent({ id: "x", type: "rename_field", reason: "test", table: "t" });
  assert.equal(result.valid, false);
  assert(result.errors.includes("from is required for rename_field"));
  assert(result.errors.includes("to is required for rename_field"));
});

test("drop_field with required keys is valid", () => {
  const result = validateChangeIntent({ id: "x", type: "drop_field", reason: "test", table: "t", field: "f" });
  assert.equal(result.valid, true);
});

test("alter_field_type requires from and to", () => {
  const result = validateChangeIntent({ id: "x", type: "alter_field_type", reason: "test", table: "t", field: "f" });
  assert.equal(result.valid, false);
  assert(result.errors.includes("from is required for alter_field_type"));
  assert(result.errors.includes("to is required for alter_field_type"));
});
