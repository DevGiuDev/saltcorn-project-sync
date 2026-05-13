const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCheckSequencesSql, buildFixSequencesSql, parseSequenceCheckOutput } = require("../lib/postgres-sequences");

test("sequence SQL uses configurable Saltcorn table pattern", () => {
  const sql = buildCheckSequencesSql({ tableLike: "\\_sc\\_%" });
  assert.match(sql, /LIKE '\\_sc\\_%'/);
  assert.match(sql, /last_value/);
  assert.match(buildFixSequencesSql({ tableLike: "public_%" }), /setval/);
});

test("sequence check parser reports bad sequences", () => {
  const result = parseSequenceCheckOutput("BAD\tpublic._sc_table.id\tpublic._sc_table_id_seq\t2\t5\nOK\tpublic._sc_ok.id\tpublic._sc_ok_id_seq\t6\t5\n");
  assert.equal(result.ok, false);
  assert.equal(result.bad.length, 1);
  assert.deepEqual(result.bad[0], {
    ok: false,
    status: "BAD",
    column: "public._sc_table.id",
    sequence: "public._sc_table_id_seq",
    last_value: 2,
    max_id: 5,
  });
});
