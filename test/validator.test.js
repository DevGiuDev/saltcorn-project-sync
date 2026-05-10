const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeCanonicalJson } = require("../lib/project-io");
const { defaultManifest } = require("../lib/manifest");
const { validateProject } = require("../lib/validator");

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scps-"));
}

test("validateProject detects duplicate fields", () => {
  const dir = tempProject();
  fs.mkdirSync(path.join(dir, "objects", "tables"), { recursive: true });
  fs.mkdirSync(path.join(dir, "environments"), { recursive: true });
  writeCanonicalJson(path.join(dir, "plugins.lock.json"), { plugins: [] });
  writeCanonicalJson(path.join(dir, "objects", "tables", "t.json"), {
    name: "t",
    fields: [{ name: "x", type: "String" }, { name: "x", type: "String" }],
  });
  const result = validateProject(dir, defaultManifest({ name: "T", slug: "t" }), []);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("duplicate field x")));
});
