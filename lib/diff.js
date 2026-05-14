function keyByName(items = []) {
  const out = new Map();
  for (const item of items) out.set(item.name || item.key || item.id, item);
  return out;
}

/**
 * Produce a semantic key-value diff between two objects.
 * Returns { added:[], removed:[], changed:[{key,from,to}] }.
 * Only compares own enumerable string keys; skips internal keys like id/name.
 */
function semanticDiff(desired = {}, actual = {}) {
  const SKIP_KEYS = new Set(["id", "name", "key", "fields", "tags"]);
  const allKeys = new Set([...Object.keys(desired), ...Object.keys(actual)]);
  const added = [];
  const removed = [];
  const changed = [];

  for (const k of allKeys) {
    if (SKIP_KEYS.has(k)) continue;
    const dVal = desired[k];
    const aVal = actual[k];
    const dStr = JSON.stringify(dVal);
    const aStr = JSON.stringify(aVal);

    if (dStr === aStr) continue;

    if (dVal === undefined) removed.push({ key: k, from: aVal });
    else if (aVal === undefined) added.push({ key: k, to: dVal });
    else changed.push({ key: k, from: aVal, to: dVal });
  }
  return { added, removed, changed };
}

/**
 * Format a semantic diff into a human-readable summary string.
 */
function formatSemanticDiff(sd = {}) {
  const parts = [];
  for (const c of sd.changed || []) parts.push(`${c.key}: ${formatVal(c.from)} → ${formatVal(c.to)}`);
  for (const a of sd.added || []) parts.push(`+${a.key}: ${formatVal(a.to)}`);
  for (const r of sd.removed || []) parts.push(`−${r.key}`);
  return parts.join(", ");
}

function formatVal(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.substring(0, 37) + "…" : s;
  }
  return String(v);
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
        const changes = semanticDiff(desiredItem, actualItem);
        updated.push({ key, desired: desiredItem, actual: actualItem, changes, changesText: formatSemanticDiff(changes) });
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

module.exports = { diffNamedCollections, diffTables, semanticDiff, formatSemanticDiff };
