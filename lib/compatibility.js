const SUPPORTED_SALTCORN_MIN_VERSION = "1.6.0";

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

function effectiveMinVersion(manifest = {}) {
  const manifestMin = manifest.saltcorn && manifest.saltcorn.min_version;
  if (!manifestMin) return SUPPORTED_SALTCORN_MIN_VERSION;
  const cmp = compareVersions(manifestMin, SUPPORTED_SALTCORN_MIN_VERSION);
  if (cmp === null) return SUPPORTED_SALTCORN_MIN_VERSION;
  return cmp >= 0 ? manifestMin : SUPPORTED_SALTCORN_MIN_VERSION;
}

function checkSaltcornCompatibility(manifest = {}, actualVersion = null) {
  const min = effectiveMinVersion(manifest);
  if (!actualVersion) {
    return {
      ok: true,
      verified: false,
      min_version: min,
      manifest_min_version: manifest.saltcorn && manifest.saltcorn.min_version ? manifest.saltcorn.min_version : null,
      supported_min_version: SUPPORTED_SALTCORN_MIN_VERSION,
      actual_version: actualVersion,
      warning: `Saltcorn version is unknown; supported minimum ${min} could not be verified`,
    };
  }
  const ok = versionSatisfiesMin(actualVersion, min);
  return {
    ok,
    verified: true,
    min_version: min,
    manifest_min_version: manifest.saltcorn && manifest.saltcorn.min_version ? manifest.saltcorn.min_version : null,
    supported_min_version: SUPPORTED_SALTCORN_MIN_VERSION,
    actual_version: actualVersion,
    reason: ok ? null : `Saltcorn ${actualVersion} does not satisfy supported minimum ${min}`,
  };
}

module.exports = {
  SUPPORTED_SALTCORN_MIN_VERSION,
  parseVersion,
  compareVersions,
  versionSatisfiesMin,
  checkPluginCompatibility,
  effectiveMinVersion,
  checkSaltcornCompatibility,
};
