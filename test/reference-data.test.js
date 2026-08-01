const test = require("node:test");
const assert = require("node:assert/strict");
const { diffReferenceTable, applyReferenceData } = require("../lib/reference-data");

test("diffReferenceTable upserts changed rows and preserves orphaned rows", () => {
  const diff = diffReferenceTable(
    { table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] },
    [{ code: "ES", name: "España" }, { code: "FR", name: "France" }]
  );
  assert.deepEqual(diff.upsert, [{ code: "ES", name: "Spain" }]);
  assert.deepEqual(diff.orphaned, [{ code: "FR", name: "France" }]);
});

test("diffReferenceTable ignores tenant-only columns when desired values match", () => {
  const diff = diffReferenceTable(
    { table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] },
    [{ id: 42, code: "ES", name: "Spain", created_at: "tenant-only" }]
  );
  assert.deepEqual(diff.upsert, []);
  assert.deepEqual(diff.orphaned, []);
});

test("applyReferenceData upserts without deleting actual rows", () => {
  const result = applyReferenceData({
    desiredRefs: [{ table: "countries", key: "code", rows: [{ code: "ES", name: "Spain" }] }],
    actualReferenceData: { countries: [{ code: "FR", name: "France" }] },
  });
  assert.equal(result.referenceData.countries.length, 2);
  assert.equal(result.warnings[0].type, "orphaned_reference_rows");
});
