const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, versionSatisfiesMin, checkPluginCompatibility } = require("../lib/compatibility");

test("compareVersions compares semver triples", () => {
  assert.equal(compareVersions("1.2.3", "1.2.0"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.3.0"), -1);
});

test("versionSatisfiesMin validates minimum versions", () => {
  assert.equal(versionSatisfiesMin("1.5.7", "1.5.0"), true);
  assert.equal(versionSatisfiesMin("1.4.9", "1.5.0"), false);
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
