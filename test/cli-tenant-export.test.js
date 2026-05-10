const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "bin", "saltcorn-project-sync.js");

test("CLI rejects error JSON as tenant export", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-"));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, JSON.stringify({ ok: false, error: "unauthorized" }));
  const init = spawnSync(process.execPath, [CLI, "init", "--name", "x", "--slug", "x"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0);
  const result = spawnSync(process.execPath, [CLI, "plan", "--tenant-export", bad], { cwd: dir, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /error response/);
});
