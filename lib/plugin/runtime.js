const { optionalRequireOrNull } = require("../tenant-adapters");

async function refreshSaltcornState() {
  const refreshed = [];
  const stateModule = optionalRequireOrNull(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
  if (!stateModule || typeof stateModule.getState !== "function") return refreshed;
  const state = stateModule.getState();
  for (const kind of ["tables", "views", "pages", "triggers"]) {
    const fn = state[`refresh_${kind}`];
    if (typeof fn !== "function") continue;
    try {
      await fn.call(state, false);
      refreshed.push(kind);
    } catch (_err) {
      // The execution receipt reports what was actually refreshed.
    }
  }
  return refreshed;
}

module.exports = { refreshSaltcornState };
