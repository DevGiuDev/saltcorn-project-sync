const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { transliterate, safeFileName, deduplicateSafeFileNames, stripObjectNoise, pullObjectToDisk, pullPluginToLock, deleteObjectFromDisk } = require("../lib/project-io");

test("transliterate strips common diacritics", () => {
  assert.equal(transliterate("Métricas"), "Metricas");
  assert.equal(transliterate("RemesasJS_Métricas"), "RemesasJS_Metricas");
  assert.equal(transliterate("Categorías"), "Categorias");
  assert.equal(transliterate("Dirección de Envío"), "Direccion de Envio");
  assert.equal(transliterate("Autónoma"), "Autonoma");
  assert.equal(transliterate("Año"), "Ano");
  assert.equal(transliterate("Über"), "Uber");
  assert.equal(transliterate("naïve"), "naive");
  assert.equal(transliterate("café"), "cafe");
});

test("transliterate passes ASCII through unchanged", () => {
  assert.equal(transliterate("hello"), "hello");
  assert.equal(transliterate("Table_1"), "Table_1");
  assert.equal(transliterate(""), "");
});

test("safeFileName transliterates before sanitizing", () => {
  assert.equal(safeFileName("RemesasJS_Métricas"), "remesasjs_metricas");
  assert.equal(safeFileName("Categorías"), "categorias");
  assert.equal(safeFileName("Dirección de Envío"), "direccion_de_envio");
  assert.equal(safeFileName("Año"), "ano");
});

test("safeFileName lowercases and replaces non-alpha", () => {
  assert.equal(safeFileName("Hello World"), "hello_world");
  assert.equal(safeFileName("foo-bar.baz"), "foo-bar.baz");
  assert.equal(safeFileName("  spaces  "), "spaces");
  assert.equal(safeFileName("test/table"), "test_table");
});

test("deduplicateSafeFileNames returns same names when no collisions", () => {
  const names = ["foo", "bar", "baz"];
  assert.deepEqual(deduplicateSafeFileNames(names), ["foo", "bar", "baz"]);
});

test("deduplicateSafeFileNames handles collisions with numeric suffixes", () => {
  // Two names that normalize to the same safe name
  const names = ["Café", "cafe"];
  const result = deduplicateSafeFileNames(names);
  assert.equal(result.length, 2);
  assert.notEqual(result[0], result[1]);
  // First gets _1, second gets _2
  assert.ok(result[0].startsWith("cafe"), `expected prefix 'cafe', got '${result[0]}'`);
  assert.ok(result[1].startsWith("cafe"), `expected prefix 'cafe', got '${result[1]}'`);
});

test("deduplicateSafeFileNames handles three-way collision", () => {
  const names = ["Métricas", "Metricas", "METRICAS"];
  const result = deduplicateSafeFileNames(names);
  assert.equal(result.length, 3);
  assert.deepEqual(result, ["metricas_1", "metricas_2", "metricas_3"]);
});

test("stripObjectNoise removes UI-created field attribute defaults before writing", () => {
  const table = stripObjectNoise({
    name: "test_tabla",
    fields: [{
      name: "sync_test_note",
      label: "sync_test_note",
      type: "String",
      attributes: {
        exact_search_only: false,
        locale: null,
        localizes_field: "",
        max_length: null,
        min_length: null,
        options: "",
        re_invalid_error: "",
        regexp: "",
      },
    }],
  }, "tables");
  assert.deepEqual(table.fields, [{ label: "sync_test_note", name: "sync_test_note", type: "String" }]);
});

test("deduplicateSafeFileNames handles mixed collision and unique", () => {
  const names = ["foo", "bar", "Bar", "baz"];
  const result = deduplicateSafeFileNames(names);
  assert.equal(result.length, 4);
  assert.equal(result[0], "foo");
  assert.equal(result[2], "bar_2");
  assert.equal(result[1], "bar_1");
  assert.equal(result[3], "baz");
});

test("deleteObjectFromDisk removes the file written by pullObjectToDisk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-del-"));
  try {
    pullObjectToDisk(dir, "views", { name: "myview", template: "List" });
    const expectedPath = path.join(dir, "objects", "views", "myview.json");
    assert.ok(fs.existsSync(expectedPath), "file should exist after pull");

    const res = deleteObjectFromDisk(dir, "views", "myview");
    assert.equal(res.removed, true);
    assert.ok(!fs.existsSync(expectedPath), "file should be gone after delete");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteObjectFromDisk is idempotent when the file is already gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-del-"));
  try {
    const res = deleteObjectFromDisk(dir, "views", "ghost");
    assert.equal(res.removed, false);
    assert.ok(!fs.existsSync(res.file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock writes plugins.lock.json and not objects/plugins/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    const res = pullPluginToLock(dir, { name: "saltcorn-project-sync", version: "0.6.1", source: "local", location: "saltcorn-project-sync" });
    assert.equal(res.mode, "full");

    const lockPath = path.join(dir, "plugins.lock.json");
    assert.equal(res.file, lockPath);
    assert.ok(fs.existsSync(lockPath), "plugins.lock.json should be written");

    const stray = path.join(dir, "objects", "plugins", "saltcorn-project-sync.json");
    assert.ok(!fs.existsSync(stray), "should NOT write a stray objects/plugins/ file");

    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.deepEqual(lock.plugins, [{ name: "saltcorn-project-sync", version: "0.6.1", source: "local", location: "saltcorn-project-sync" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock persists the npm package name as location when it differs from name", () => {
  // The json plugin's local name is "json" but its npm package is "@saltcorn/json".
  // loadAndSaveNewPlugin needs the npm package name to install on a remote tenant.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    pullPluginToLock(dir, { name: "json", version: "0.4.6", source: "npm", location: "@saltcorn/json" });
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "plugins.lock.json"), "utf8"));
    assert.deepEqual(lock.plugins, [{ name: "json", version: "0.4.6", source: "npm", location: "@saltcorn/json" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock defaults location to name when the live export omits it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    pullPluginToLock(dir, { name: "buyapp", version: "0.6.1", source: "npm" });
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "plugins.lock.json"), "utf8"));
    assert.equal(lock.plugins[0].location, "buyapp");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock upserts an existing plugin instead of duplicating", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    pullPluginToLock(dir, { name: "buyapp", version: "0.6.0", source: "npm", location: "@buyapp/integration" });
    pullPluginToLock(dir, { name: "buyapp", version: "0.6.1", source: "npm", location: "@buyapp/integration" });

    const lock = JSON.parse(fs.readFileSync(path.join(dir, "plugins.lock.json"), "utf8"));
    assert.deepEqual(lock.plugins, [{ name: "buyapp", version: "0.6.1", source: "npm", location: "@buyapp/integration" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock selective mode merges only the requested property", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    pullPluginToLock(dir, { name: "buyapp", version: "0.6.0", source: "npm" });
    const res = pullPluginToLock(dir, { name: "buyapp", version: "0.6.1", source: "npm" }, ["version"]);
    assert.equal(res.mode, "selective");
    assert.deepEqual(res.adopted_keys, ["version"]);

    const lock = JSON.parse(fs.readFileSync(path.join(dir, "plugins.lock.json"), "utf8"));
    // version updated to live value, source/location untouched (defaulted from name on first pull)
    assert.deepEqual(lock.plugins, [{ name: "buyapp", version: "0.6.1", source: "npm", location: "buyapp" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pullPluginToLock falls back to package_version when version is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-plugin-"));
  try {
    pullPluginToLock(dir, { name: "buyapp", package_version: "1.2.3" });
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "plugins.lock.json"), "utf8"));
    assert.deepEqual(lock.plugins, [{ name: "buyapp", version: "1.2.3", source: "unknown", location: "buyapp" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
