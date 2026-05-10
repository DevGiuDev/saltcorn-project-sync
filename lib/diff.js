function keyByName(items = []) {
  const out = new Map();
  for (const item of items) out.set(item.name || item.key || item.id, item);
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
    fieldDiffs.push({
      table: tableName,
      fields: diffNamedCollections(desiredTable.fields || [], actualTable.fields || []),
    });
  }

  return { tables: tableDiff, fieldDiffs };
}

module.exports = { diffNamedCollections, diffTables };
