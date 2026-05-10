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

test("analyzeDependencies scans nested named references", () => {
  const result = analyzeDependencies({
    tables: [{ name: "invoices", fields: [] }],
    pages: [{ name: "home", configuration: { widgets: [{ table_name: "missing_table" }] } }],
  });
  assert(result.missing.some((dep) => dep.missing.name === "missing_table"));
});
