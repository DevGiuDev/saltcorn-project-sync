const { spawnSync } = require("node:child_process");

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sequenceTableLikePattern(pattern = "_sc_%") {
  return pattern || "_sc_%";
}

function buildCheckSequencesSql({ tableLike = "_sc_%" } = {}) {
  const pattern = sqlLiteral(sequenceTableLikePattern(tableLike));
  return `WITH seqs AS (
  SELECT
    c.oid AS seq_oid,
    n.nspname AS seq_schema,
    c.relname AS seq_name,
    tn.nspname AS table_schema,
    t.relname AS table_name,
    a.attname AS column_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
  JOIN pg_class t ON t.oid = d.refobjid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
  WHERE c.relkind = 'S'
    AND tn.nspname NOT IN ('pg_catalog', 'information_schema')
    AND t.relname LIKE ${pattern} ESCAPE '\\'
), vals AS (
  SELECT
    seq_schema,
    seq_name,
    table_schema,
    table_name,
    column_name,
    format('%I.%I', seq_schema, seq_name) AS seq_fq,
    format('%I.%I', table_schema, table_name) AS table_fq
  FROM seqs
), checked AS (
  SELECT
    *,
    (xpath('/row/last_value/text()', query_to_xml(format('SELECT last_value FROM %s', seq_fq), false, true, '')))[1]::text::bigint AS last_value,
    (xpath('/row/max/text()', query_to_xml(format('SELECT COALESCE(max(%I), 0) AS max FROM %s', column_name, table_fq), false, true, '')))[1]::text::bigint AS max_id
  FROM vals
)
SELECT CASE WHEN last_value < max_id THEN 'BAD' ELSE 'OK' END
  || E'\\t' || table_fq || '.' || column_name
  || E'\\t' || seq_fq
  || E'\\t' || last_value
  || E'\\t' || max_id
FROM checked
ORDER BY CASE WHEN last_value < max_id THEN 0 ELSE 1 END, table_name, column_name;`;
}

function buildFixSequencesSql({ tableLike = "_sc_%" } = {}) {
  const pattern = sqlLiteral(sequenceTableLikePattern(tableLike));
  return `DO $$
DECLARE
  r record;
  max_id bigint;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS seq_schema,
      c.relname AS seq_name,
      tn.nspname AS table_schema,
      t.relname AS table_name,
      a.attname AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE c.relkind = 'S'
      AND tn.nspname NOT IN ('pg_catalog', 'information_schema')
      AND t.relname LIKE ${pattern} ESCAPE '\\'
  LOOP
    EXECUTE format('SELECT COALESCE(max(%I), 0) FROM %I.%I', r.column_name, r.table_schema, r.table_name) INTO max_id;
    EXECUTE format('SELECT setval(%L, GREATEST(%s, 1), true)', format('%I.%I', r.seq_schema, r.seq_name), max_id);
    RAISE NOTICE 'set %.% for %.%.% to %', r.seq_schema, r.seq_name, r.table_schema, r.table_name, r.column_name, GREATEST(max_id, 1);
  END LOOP;
END $$;`;
}

function parseSequenceCheckOutput(stdout = "") {
  const rows = String(stdout)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, column, sequence, lastValue, maxId] = line.split("\t");
      return {
        ok: status === "OK",
        status,
        column,
        sequence,
        last_value: Number(lastValue),
        max_id: Number(maxId),
      };
    });
  return { ok: rows.every((row) => row.ok), rows, bad: rows.filter((row) => !row.ok) };
}

function runPsql(sql, { args = ["-v", "ON_ERROR_STOP=1", "-At"], env = process.env } = {}) {
  const result = spawnSync("psql", args, { input: sql, encoding: "utf8", env, maxBuffer: 1024 * 1024 * 20 });
  if (result.status !== 0) {
    const err = new Error(result.stderr || `psql exited with ${result.status}`);
    err.status = result.status;
    throw err;
  }
  return result.stdout || "";
}

function checkSequences(options = {}) {
  const stdout = runPsql(buildCheckSequencesSql(options), options);
  return parseSequenceCheckOutput(stdout);
}

function fixSequences(options = {}) {
  const stdout = runPsql(buildFixSequencesSql(options), { ...options, args: ["-v", "ON_ERROR_STOP=1"] });
  return { ok: true, output: stdout };
}

module.exports = {
  sequenceTableLikePattern,
  buildCheckSequencesSql,
  buildFixSequencesSql,
  parseSequenceCheckOutput,
  runPsql,
  checkSequences,
  fixSequences,
};
