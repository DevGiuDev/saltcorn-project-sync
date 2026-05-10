const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnvironmentConfig, applyEnvironmentOverlay } = require("../lib/environment");

test("validateEnvironmentConfig rejects secrets", () => {
  const result = validateEnvironmentConfig({ api_key: "nope", bearer_auth: "nope" });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => /api_key/.test(error)));
  assert(result.errors.some((error) => /bearer_auth/.test(error)));
});

test("applyEnvironmentOverlay merges non-secret settings", () => {
  const result = applyEnvironmentOverlay({ settings: { a: 1 } }, { settings: { b: 2 } });
  assert.deepEqual(result.settings, { a: 1, b: 2 });
});
