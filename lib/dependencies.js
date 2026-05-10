function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

const KEY_TO_KIND = {
  table_name: "tables",
  reftable_name: "tables",
  ref_table: "tables",
  view_name: "views",
  page_name: "pages",
  trigger_name: "triggers",
  role_name: "roles",
};

function scanNamedReferences(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) scanNamedReferences(item, refs);
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value)) {
    if (KEY_TO_KIND[key] && typeof child === "string") {
      refs.push({ kind: KEY_TO_KIND[key], name: child, reason: key });
    }
    scanNamedReferences(child, refs);
  }
  return refs;
}

function tableDependenciesFromTable(table) {
  return uniqueSorted((table.fields || []).map((field) => field.reftable_name || field.reftable || field.ref_table));
}

function dependenciesForObject(kind, object) {
  const deps = [];
  if (kind === "tables") {
    deps.push(...tableDependenciesFromTable(object).map((name) => ({ kind: "tables", name, reason: `${object.name} foreign key` })));
  }
  if (kind === "views" && object.table_name) {
    deps.push({ kind: "tables", name: object.table_name, reason: `${object.name} view table` });
  }
  if (kind === "triggers" && (object.table_name || object.table)) {
    deps.push({ kind: "tables", name: object.table_name || object.table, reason: `${object.name} trigger table` });
  }
  deps.push(...scanNamedReferences(object).map((dep) => ({ ...dep, reason: `${object.name} ${dep.reason}` })));
  return uniqueDeps(deps).filter((dep) => !(dep.kind === kind && dep.name === object.name));
}

function uniqueDeps(deps) {
  const seen = new Set();
  const out = [];
  for (const dep of deps) {
    const key = `${dep.kind}:${dep.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dep);
  }
  return out;
}

function analyzeDependencies(projectState) {
  const dependencies = [];
  const missing = [];
  const present = new Map();

  for (const [kind, items] of Object.entries(projectState || {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items || []) present.set(`${kind}:${item.name}`, item);
  }

  for (const [kind, items] of Object.entries(projectState || {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items || []) {
      for (const dep of dependenciesForObject(kind, item)) {
        dependencies.push({ from: { kind, name: item.name }, to: dep });
        if (!present.has(`${dep.kind}:${dep.name}`)) missing.push({ from: { kind, name: item.name }, missing: dep });
      }
    }
  }

  return { dependencies, missing };
}

module.exports = { KEY_TO_KIND, scanNamedReferences, tableDependenciesFromTable, dependenciesForObject, analyzeDependencies };
