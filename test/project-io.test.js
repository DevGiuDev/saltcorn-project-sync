const test = require("node:test");
const assert = require("node:assert/strict");
const { transliterate, safeFileName, deduplicateSafeFileNames, stripObjectNoise } = require("../lib/project-io");

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
