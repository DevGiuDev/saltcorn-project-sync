const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, versionSatisfiesMin, checkPluginCompatibility, checkSaltcornCompatibility, effectiveMinVersion, SUPPORTED_SALTCORN_MIN_VERSION } = require("../lib/compatibility");

test("compareVersions compares semver triples", () => {
  assert.equal(compareVersions("1.2.3", "1.2.0"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.3.0"), -1);
});

test("versionSatisfiesMin validates minimum versions", () => {
  assert.equal(versionSatisfiesMin("1.5.7", "1.5.0"), true);
  assert.equal(versionSatisfiesMin("1.4.9", "1.5.0"), false);
});

test("Saltcorn compatibility enforces supported minimum 1.6.0", () => {
  assert.equal(SUPPORTED_SALTCORN_MIN_VERSION, "1.6.0");
  assert.equal(effectiveMinVersion({ saltcorn: { min_version: "1.5.0" } }), "1.6.0");
  assert.equal(effectiveMinVersion({ saltcorn: { min_version: "1.7.0" } }), "1.7.0");
  assert.equal(checkSaltcornCompatibility({ saltcorn: { min_version: null } }, "1.5.9").ok, false);
  assert.equal(checkSaltcornCompatibility({ saltcorn: { min_version: null } }, "1.6.0").ok, true);
  const unknown = checkSaltcornCompatibility({ saltcorn: { min_version: null } }, null);
  assert.equal(unknown.ok, true);
  assert.equal(unknown.verified, false);
});

test("checkPluginCompatibility detects missing and mismatched plugins", () => {
  const result = checkPluginCompatibility(
    [{ name: "a", version: "1" }, { name: "b", version: "2" }],
    [{ name: "a", version: "0" }]
  );
  assert.equal(result.ok, false);
  assert.equal(result.missing[0].name, "b");
  assert.equal(result.mismatched[0].required.name, "a");
});
