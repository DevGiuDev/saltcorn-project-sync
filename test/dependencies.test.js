const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeDependencies } = require("../lib/dependencies");

test("analyzeDependencies detects missing referenced tables", () => {
  const result = analyzeDependencies({
    tables: [{ name: "invoices", fields: [{ name: "customer_id", reftable_name: "customers" }] }],
  });
  assert.equal(result.missing[0].missing.name, "customers");
});

test("analyzeDependencies accepts present referenced tables", () => {
  const result = analyzeDependencies({
    tables: [
      { name: "customers", fields: [] },
      { name: "invoices", fields: [{ name: "customer_id", reftable_name: "customers" }] },
    ],
  });
  assert.equal(result.missing.length, 0);
});
