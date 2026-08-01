const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, writeCanonicalJson, safeFileName } = require("./project-io");

function referenceDataDir(projectDir = process.cwd()) {
  return path.join(projectDir, "objects", "data", "reference_tables");
}

function loadReferenceData(projectDir = process.cwd()) {
  const dir = referenceDataDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJsonIfExists(path.join(dir, file)))
    .filter(Boolean);
}

function writeReferenceTable(projectDir, tableName, rows, options = {}) {
  const object = {
    table: tableName,
    mode: options.mode || "upsert",
    key: options.key || "id",
    rows: rows || [],
  };
  const file = path.join(referenceDataDir(projectDir), `${safeFileName(tableName)}.json`);
  writeCanonicalJson(file, object);
  return file;
}

function keyValue(row, key) {
  if (Array.isArray(key)) return key.map((part) => row[part]).join("\u0000");
  return row[key];
}

function diffReferenceTable(desiredRef, actualRows = []) {
  const key = desiredRef.key || "id";
  const desiredRows = desiredRef.rows || [];
  const actualByKey = new Map(actualRows.map((row) => [keyValue(row, key), row]));
  const desiredByKey = new Map(desiredRows.map((row) => [keyValue(row, key), row]));
  const upsert = [];
  const orphaned = [];

  for (const [rowKey, desiredRow] of desiredByKey) {
    const actualRow = actualByKey.get(rowKey);
    const comparableActual = actualRow && Object.keys(desiredRow).reduce((acc, column) => {
      acc[column] = actualRow[column];
      return acc;
    }, {});
    if (!actualRow || JSON.stringify(comparableActual) !== JSON.stringify(desiredRow)) upsert.push(desiredRow);
  }

  for (const [rowKey, actualRow] of actualByKey) {
    if (!desiredByKey.has(rowKey)) orphaned.push(actualRow);
  }

  return { table: desiredRef.table, key, mode: desiredRef.mode || "upsert", upsert, orphaned };
}

function diffReferenceData(desiredRefs = [], actualReferenceData = {}) {
  return desiredRefs.map((desiredRef) =>
    diffReferenceTable(desiredRef, actualReferenceData[desiredRef.table] || [])
  );
}

function applyReferenceData({ desiredRefs = [], actualReferenceData = {} }) {
  const out = { ...actualReferenceData };
  const warnings = [];
  for (const ref of desiredRefs) {
    const key = ref.key || "id";
    const existingRows = out[ref.table] || [];
    const byKey = new Map(existingRows.map((row) => [keyValue(row, key), row]));
    for (const row of ref.rows || []) byKey.set(keyValue(row, key), row);
    out[ref.table] = [...byKey.values()];
    const diff = diffReferenceTable(ref, existingRows);
    if (diff.orphaned.length) {
      warnings.push({
        type: "orphaned_reference_rows",
        table: ref.table,
        count: diff.orphaned.length,
        message: "Preserved by default",
      });
    }
  }
  return { referenceData: out, warnings };
}

module.exports = {
  referenceDataDir,
  loadReferenceData,
  writeReferenceTable,
  diffReferenceTable,
  diffReferenceData,
  applyReferenceData,
};
