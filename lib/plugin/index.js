/**
 * Plugin entrypoint — assembles routes and re-exports public API.
 */
const { pluginConfigFields } = require("./config");
const pageRoutes = require("./routes/pages");
const apiRoutes = require("./routes/api");

const { authorized, applyAuthorized, sendPage, sendJson } = require("./auth");
const {
  objectCounts, summarizeDiff, approvalMatrix,
  isDestructiveOperation, validateApplyPayload,
} = require("./helpers");
const { escapeHtml } = require("./renderers/_shared");
const { renderLiveDiff, renderPlanPreview } = require("./renderers/live-diff");
const { renderApprovals } = require("./renderers/approvals");
const { deploymentsTable } = require("./renderers/deployments");

// ─── Combine all routes ────────────────────────────────────
const routes = [...pageRoutes, ...apiRoutes];

// ─── Auth guards (applied to all routes) ───────────────────
for (const route of routes) {
  const isApiRoute = route.url.includes("/api/");
  const hasTokenAuth =
    route.callback.toString().includes("applyAuthorized") ||
    route.callback.toString().includes("authorized");
  const origCallback = route.callback;
  if (isApiRoute && hasTokenAuth) {
    route.callback = async (req, res) => {
      if (applyAuthorized(req)) return origCallback(req, res);
      if (authorized(req)) return origCallback(req, res);
      sendJson(res, { ok: false, error: "Authentication required" }, 401);
    };
  } else if (isApiRoute) {
    route.callback = async (req, res) => {
      if (authorized(req)) return origCallback(req, res);
      sendJson(res, { ok: false, error: "Authentication required" }, 401);
    };
  } else {
    route.callback = async (req, res) => {
      const { requirePageAuth } = require("./auth");
      if (!requirePageAuth(req, res)) return;
      return origCallback(req, res);
    };
  }
}

module.exports = {
  pluginConfigFields,
  routes,
  // Re-exports for backward compatibility (tests)
  deploymentsTable,
  authorized,
  applyAuthorized,
  isDestructiveOperation,
  validateApplyPayload,
  renderLiveDiff,
  renderPlanPreview,
  renderApprovals,
  summarizeDiff,
  approvalMatrix,
  objectCounts,
  escapeHtml,
  sendJson,
  sendPage,
};
