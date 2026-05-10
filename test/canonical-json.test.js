const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalStringify } = require("../lib/canonical-json");

test("canonicalStringify sorts object keys recursively", () => {
  assert.equal(canonicalStringify({ b: 1, a: { d: 4, c: 3 } }), '{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 1\n}\n');
});
