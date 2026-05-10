function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function tableDependenciesFromTable(table) {
  return uniqueSorted((table.fields || []).map((field) => field.reftable_name || field.reftable || field.ref_table));
}

function dependenciesForObject(kind, object) {
  if (kind === "tables") {
    return tableDependenciesFromTable(object).map((name) => ({ kind: "tables", name, reason: `${object.name} foreign key` }));
  }
  if (kind === "views") {
    return object.table_name ? [{ kind: "tables", name: object.table_name, reason: `${object.name} view table` }] : [];
  }
  if (kind === "triggers") {
    return object.table_name || object.table
      ? [{ kind: "tables", name: object.table_name || object.table, reason: `${object.name} trigger table` }]
      : [];
  }
  return [];
}

function analyzeDependencies(projectState) {
  const dependencies = [];
  const missing = [];
  const present = new Map();

  for (const [kind, items] of Object.entries(projectState || {})) {
    for (const item of items || []) present.set(`${kind}:${item.name}`, item);
  }

  for (const [kind, items] of Object.entries(projectState || {})) {
    for (const item of items || []) {
      for (const dep of dependenciesForObject(kind, item)) {
        dependencies.push({ from: { kind, name: item.name }, to: dep });
        if (!present.has(`${dep.kind}:${dep.name}`)) missing.push({ from: { kind, name: item.name }, missing: dep });
      }
    }
  }

  return { dependencies, missing };
}

module.exports = { tableDependenciesFromTable, dependenciesForObject, analyzeDependencies };
