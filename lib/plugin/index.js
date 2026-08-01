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
// API routes accept either a configured Bearer token (CLI/CI) or an admin
// session from the same origin (plugin UI). Destructive deployment endpoints
// perform the stricter Bearer-only check inside their own callbacks.
for (const route of routes) {
  const isApiRoute = route.url.includes("/api/");
  const origCallback = route.callback;
  if (isApiRoute) {
    route.callback = async (req, res) => {
      if (authorized(req)) return origCallback(req, res);
      return sendJson(res, { ok: false, error: "Authentication required" }, 401);
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
