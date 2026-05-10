function parseVersion(version) {
  if (!version) return null;
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function versionSatisfiesMin(actual, min) {
  if (!min) return true;
  const cmp = compareVersions(actual, min);
  return cmp !== null && cmp >= 0;
}

function pluginMap(plugins = []) {
  return new Map((plugins || []).filter((p) => p && p.name).map((p) => [p.name, p]));
}

function checkPluginCompatibility(required = [], actual = []) {
  const actualMap = pluginMap(actual);
  const missing = [];
  const mismatched = [];
  for (const plugin of required || []) {
    if (!plugin.name) continue;
    const installed = actualMap.get(plugin.name);
    if (!installed) missing.push(plugin);
    else if (plugin.version && installed.version && plugin.version !== installed.version) {
      mismatched.push({ required: plugin, actual: installed });
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

function checkSaltcornCompatibility(manifest = {}, actualVersion = null) {
  const min = manifest.saltcorn && manifest.saltcorn.min_version;
  if (!min) return { ok: true, min_version: null, actual_version: actualVersion };
  return {
    ok: versionSatisfiesMin(actualVersion, min),
    min_version: min,
    actual_version: actualVersion,
  };
}

module.exports = {
  parseVersion,
  compareVersions,
  versionSatisfiesMin,
  checkPluginCompatibility,
  checkSaltcornCompatibility,
};
