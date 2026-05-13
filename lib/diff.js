function keyByName(items = []) {
  const out = new Map();
  for (const item of items) out.set(item.name || item.key || item.id, item);
  return out;
}

/**
 * Normalize a field for comparison purposes.
 * Strips auto-generated/derivable properties that cause false diffs.
 */
function comparableField(f) {
  const out = { ...f };
  // Strip auto-generated PK attributes (Saltcorn adds NonSerial on Table.create)
  if (out.attributes && typeof out.attributes === "object") {
    delete out.attributes.NonSerial;
    delete out.attributes.unique_error_msg;
    // default:null is noise from export, not a meaningful attribute
    if (out.attributes.default === null) delete out.attributes.default;
    if (Object.keys(out.attributes).length === 0) delete out.attributes;
  }
  // Strip auto-generated labels (Saltcorn capitalizes field name)
  if (out.label) {
    const auto = out.name.charAt(0).toUpperCase() + out.name.slice(1).replace(/_/g, " ");
    if (out.label === auto || out.label === out.name.toUpperCase() || out.label === out.name) {
      delete out.label;
    }
  }
  return out;
}

function diffNamedCollections(desired = [], actual = []) {
  const desiredMap = keyByName(desired);
  const actualMap = keyByName(actual);
  const created = [];
  const updated = [];
  const orphaned = [];

  for (const [key, desiredItem] of desiredMap) {
    if (!actualMap.has(key)) created.push(desiredItem);
    else {
      const actualItem = actualMap.get(key);
      if (JSON.stringify(desiredItem) !== JSON.stringify(actualItem)) {
        updated.push({ key, desired: desiredItem, actual: actualItem });
      }
    }
  }

  for (const [key, actualItem] of actualMap) {
    if (!desiredMap.has(key)) orphaned.push(actualItem);
  }

  return { created, updated, orphaned };
}

function diffTables(desiredTables = [], actualTables = []) {
  const tableDiff = diffNamedCollections(desiredTables, actualTables);
  const fieldDiffs = [];
  const actualByName = keyByName(actualTables);

  for (const desiredTable of desiredTables) {
    const tableName = desiredTable.name;
    const actualTable = actualByName.get(tableName);
    if (!actualTable) continue;
    // Normalize fields for comparison to avoid false positives from
    // auto-generated labels, NonSerial attributes, etc.
    const desiredFields = (desiredTable.fields || []).map(comparableField);
    const actualFields = (actualTable.fields || []).map(comparableField);
    fieldDiffs.push({
      table: tableName,
      fields: diffNamedCollections(desiredFields, actualFields),
    });
  }

  return { tables: tableDiff, fieldDiffs };
}

module.exports = { diffNamedCollections, diffTables };
