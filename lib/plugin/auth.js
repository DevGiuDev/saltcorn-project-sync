/**
 * Authentication, authorization, and response helpers.
 */
const { configuredToken, configuredProjectRoot } = require("./config");
const { optionalRequire } = require("../tenant-adapters");

// ─── Response helpers ──────────────────────────────────────

function sendPage(res, title, body, opts = {}) {
  if (res && typeof res.setHeader === "function" && opts.noCache) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  if (res && typeof res.sendWrap === "function") return res.sendWrap(title, body);
  if (res && typeof res.send === "function")
    return res.send(`<!doctype html><title>${title}</title>${body}`);
  return { title, body };
}

function sendJson(res, body, status = 200) {
  if (res && typeof res.status === "function" && typeof res.json === "function")
    return res.status(status).json(body);
  return { json: body, status };
}

// ─── Auth guards ───────────────────────────────────────────

function requirePageAuth(req, res) {
  if (req && req.user && req.user.role_id === 1) return true;
  if (req && req.user) {
    sendPage(
      res,
      "Unauthorized",
      '<div class="alert alert-danger">Admin access required.</div><a href="/" class="btn btn-secondary mt-2">Home</a>'
    );
    return false;
  }
  if (res && typeof res.redirect === "function") {
    res.redirect(
      `/auth/login?dest=${encodeURIComponent(req ? req.originalUrl : "/project-sync")}`
    );
    return false;
  }
  return false;
}

function requireApiAuth(req, res) {
  if (req && req.user && req.user.role_id === 1) return true;
  sendJson(res, { ok: false, error: "Authentication required" }, 401);
  return false;
}

function authorized(req) {
  const token = configuredToken();
  if (!token) return true;
  const header = req && (req.headers?.authorization || req.headers?.Authorization);
  return header === `Bearer ${token}`;
}

function applyAuthorized(req) {
  const token = configuredToken();
  if (!token) return false;
  return authorized(req);
}

function requireRootTenant(req, res) {
  try {
    const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    if (dbMod) {
      const tenant = dbMod.getTenantSchema();
      if (tenant && tenant !== "public" && tenant !== dbMod.connectObj?.default_schema) {
        sendPage(
          res,
          "Settings",
          '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-1"></i>' +
            "Plugin settings can only be changed from the <strong>default tenant</strong> (public). " +
            "You are on tenant <code>" +
            tenant +
            "</code>.</div>" +
            '<a href="/project-sync" class="btn btn-secondary">Back to overview</a>'
        );
        return false;
      }
    }
  } catch {
    /* can't check — allow */
  }
  return true;
}

// ─── Branch guard ──────────────────────────────────────────

function guardBranchForRequest(req) {
  const projectRoot = configuredProjectRoot();
  if (!projectRoot) return null;

  try {
    const bt = require("../branch-tenant");
    const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    const requestTenant = dbMod ? dbMod.getTenantSchema() : "";
    const guard = bt.guardBranchTenant(projectRoot, requestTenant);
    if (!guard.ok) {
      console.warn("[scps-guard]", guard.error);
      return (
        guard.error +
        `. Navigate to the correct tenant or switch git branch to match.`
      );
    }
  } catch {
    // branch-tenant not available (e.g. not multi-tenant) → skip guard
  }
  return null;
}

// ─── API wrappers ──────────────────────────────────────────

async function api(req, res, handler) {
  if (!authorized(req)) return sendJson(res, { ok: false, error: "unauthorized" }, 401);
  try {
    const guardErr = guardBranchForRequest(req);
    if (guardErr) return sendJson(res, { ok: false, error: guardErr }, 409);
    return sendJson(res, await handler());
  } catch (err) {
    console.error("[scps-api]", err.message);
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

async function apiLocal(req, res, handler) {
  try {
    return sendJson(res, await handler());
  } catch (err) {
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

module.exports = {
  sendPage,
  sendJson,
  requirePageAuth,
  requireApiAuth,
  authorized,
  applyAuthorized,
  requireRootTenant,
  guardBranchForRequest,
  api,
  apiLocal,
};
