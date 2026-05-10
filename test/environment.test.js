const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnvironmentConfig, applyEnvironmentOverlay } = require("../lib/environment");

test("validateEnvironmentConfig rejects secrets", () => {
  const result = validateEnvironmentConfig({ api_key: "nope" });
  assert.equal(result.valid, false);
});

test("applyEnvironmentOverlay merges non-secret settings", () => {
  const result = applyEnvironmentOverlay({ settings: { a: 1 } }, { settings: { b: 2 } });
  assert.deepEqual(result.settings, { a: 1, b: 2 });
});
