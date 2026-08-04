const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateChangeIntent, singularOfKind, writeDropIntent, loadChangeIntents } = require("../lib/change-intents");

test("rename_field requires table/from/to", () => {
  const result = validateChangeIntent({ id: "x", type: "rename_field", reason: "test", table: "t" });
  assert.equal(result.valid, false);
  assert(result.errors.includes("from is required for rename_field"));
  assert(result.errors.includes("to is required for rename_field"));
});

test("drop_field with required keys is valid", () => {
  const result = validateChangeIntent({ id: "x", type: "drop_field", reason: "test", table: "t", field: "f" });
  assert.equal(result.valid, true);
});

test("alter_field_type requires from and to", () => {
  const result = validateChangeIntent({ id: "x", type: "alter_field_type", reason: "test", table: "t", field: "f" });
  assert.equal(result.valid, false);
  assert(result.errors.includes("from is required for alter_field_type"));
  assert(result.errors.includes("to is required for alter_field_type"));
});

test("singularOfKind strips the trailing s", () => {
  assert.equal(singularOfKind("views"), "view");
  assert.equal(singularOfKind("tables"), "table");
  assert.equal(singularOfKind("pages"), "page");
});

test("writeDropIntent writes a valid, versioned drop intent to changes/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-intent-"));
  try {
    const { file, intent } = writeDropIntent(dir, "views", "OldDashboard", { version: "0.3.0" });
    assert.ok(fs.existsSync(file));
    assert.equal(intent.type, "drop_view");
    assert.equal(intent.view, "OldDashboard");
    assert.equal(intent.version, "0.3.0");
    assert.equal(intent.id, "drop-view-olddashboard");

    // The written file is a valid intent and loadChangeIntents picks it up
    const { validateChangeIntent } = require("../lib/change-intents");
    assert.equal(validateChangeIntent(intent).valid, true);
    const loaded = loadChangeIntents(dir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, intent.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeDropIntent default reason is set when none provided", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-intent-"));
  try {
    const { intent } = writeDropIntent(dir, "tables", "legacy_t", { version: "1.0.0" });
    assert.ok(intent.reason && intent.reason.length > 0);
    assert.equal(intent.type, "drop_table");
    assert.equal(intent.table, "legacy_t");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeDropIntent with sinceVersion filter: applied intent is retired after deploy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-intent-"));
  try {
    writeDropIntent(dir, "views", "GoneView", { version: "0.3.0" });

    // Tenant at 0.2.0 → intent (v0.3.0) is included: > sinceVersion
    const beforeDeploy = loadChangeIntents(dir, { sinceVersion: "0.2.0" });
    assert.equal(beforeDeploy.length, 1);

    // Tenant at 0.3.0 → intent (v0.3.0) is NOT included: not > sinceVersion
    const afterDeploy = loadChangeIntents(dir, { sinceVersion: "0.3.0" });
    assert.equal(afterDeploy.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
