const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("./project-io");
const { normalizePack } = require("./normalizer");

function pluginConfigFields() {
  return {
    steps: [
      {
        name: "Project Sync",
        form: async () => ({
          fields: [
            {
              name: "project_root",
              label: "Project root path",
              type: "String",
              required: false,
              sublabel: "Filesystem path used by the companion CLI on trusted deployments.",
            },
            {
              name: "environment",
              label: "Environment",
              type: "String",
              required: true,
              default: "dev",
            },
            {
              name: "api_token_env",
              label: "API token environment variable",
              type: "String",
              required: false,
              default: "SALTCORN_PROJECT_SYNC_API_TOKEN",
            },
          ],
        }),
      },
    ],
  };
}

function sendPage(res, title, body) {
  if (res && typeof res.sendWrap === "function") return res.sendWrap(title, body);
  if (res && typeof res.send === "function") return res.send(`<!doctype html><title>${title}</title>${body}`);
  return { title, body };
}

function sendJson(res, body, status = 200) {
  if (res && typeof res.status === "function" && typeof res.json === "function") return res.status(status).json(body);
  return { json: body, status };
}

function nav() {
  return `<p>
<a href="/project-sync">Overview</a> |
<a href="/project-sync/health">Health</a> |
<a href="/project-sync/deployments">Deployments</a>
</p>`;
}

function deploymentsTable(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  const rows = readJsonIfExists(file, []);
  if (!rows.length) return "<p>No deployment records found.</p>";
  return `<table><thead><tr><th>Recorded</th><th>Env</th><th>Status</th><th>Commit</th><th>Ops</th><th>Warnings</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${row.recorded_at || ""}</td><td>${row.env || ""}</td><td>${row.status || ""}</td><td><code>${row.commit || ""}</code></td><td>${row.operations ?? ""}</td><td>${row.warnings ?? ""}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

function configuredToken() {
  return process.env.SALTCORN_PROJECT_SYNC_API_TOKEN || "";
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

function isDestructiveOperation(op = {}) {
  return /^(drop_|rename_|alter_)/.test(op.action || "");
}

function validateApplyPayload(payload = {}) {
  const env = payload.env || "dev";
  const plan = payload.plan || {};
  const errors = [];
  if (!payload.desired) errors.push("desired project state is required");
  if (!plan.operations) errors.push("plan.operations is required");
  if (!["local", "dev"].includes(env)) errors.push("REST apply is currently restricted to local/dev environments");
  for (const blocked of plan.blocked || []) errors.push(`blocked plan item: ${typeof blocked === "string" ? blocked : JSON.stringify(blocked)}`);
  const destructive = (plan.operations || []).filter(isDestructiveOperation);
  if (destructive.length && payload.allow_destructive !== true) errors.push("destructive operations require allow_destructive=true");
  return { valid: errors.length === 0, errors, env, destructive };
}

async function nativeAdapterOrError() {
  try {
    const { nativeSaltcornAdapter } = require("./tenant-adapters");
    return nativeSaltcornAdapter();
  } catch (err) {
    return { error: err.message };
  }
}

async function api(req, res, handler) {
  if (!authorized(req)) return sendJson(res, { ok: false, error: "unauthorized" }, 401);
  try {
    return sendJson(res, await handler());
  } catch (err) {
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

const routes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async (_req, res) =>
      sendPage(
        res,
        "Saltcorn Project Sync",
        `${nav()}<h1>Saltcorn Project Sync</h1>
<p>Git-backed app versioning and safe deployment planning.</p>
<h2>Core safety rule</h2>
<p><strong>Missing from Git never means drop automatically.</strong> Orphaned tenant objects are preserved unless explicit change intents authorize destructive operations.</p>
<h2>Companion CLI</h2>
<pre>saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev</pre>
<h2>REST endpoints</h2>
<pre>GET  /project-sync/api/info
GET  /project-sync/api/export
POST /project-sync/api/apply
POST /project-sync/api/backup
POST /project-sync/api/restore</pre>
<p>Legacy GET aliases also exist under <code>/api/project-sync</code>. POST uses <code>/project-sync/api</code> to avoid Saltcorn core API routing.</p>
<p>REST apply is guarded: it requires a configured bearer token, local/dev environment, and an unblocked CLI-generated plan.</p>`
      ),
  },
  {
    url: "/project-sync/health",
    method: "get",
    callback: async (_req, res) => {
      const checks = [
        ["canonical JSON", true],
        ["planner", true],
        ["change intents", true],
        ["deployment log path", fs.existsSync(path.join(process.cwd(), ".saltcorn-project-sync"))],
      ];
      return sendPage(
        res,
        "Project Sync Health",
        `${nav()}<h1>Health</h1><ul>${checks
          .map(([name, ok]) => `<li>${ok ? "✅" : "⚠️"} ${name}</li>`)
          .join("")}</ul>`
      );
    },
  },
  {
    url: "/project-sync/deployments",
    method: "get",
    callback: async (_req, res) =>
      sendPage(res, "Project Sync Deployments", `${nav()}<h1>Deployments</h1>${deploymentsTable()}`),
  },
  {
    url: "/project-sync/api/info",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        return { ok: true, ...(await adapter.info()) };
      }),
  },
  {
    url: "/api/project-sync/info",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        return { ok: true, ...(await adapter.info()) };
      }),
  },
  {
    url: "/project-sync/api/export",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return normalizePack(await adapter.exportProject());
      }),
  },
  {
    url: "/api/project-sync/export",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return normalizePack(await adapter.exportProject());
      }),
  },
  {
    url: "/project-sync/api/apply",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "apply requires SALTCORN_PROJECT_SYNC_API_TOKEN and matching bearer token" }, 403);
      return api(req, res, async () => {
        const payload = req.body || {};
        const validation = validateApplyPayload(payload);
        if (!validation.valid) return { ok: false, errors: validation.errors };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        const result = await adapter.applyPlan({ desired: payload.desired, actual: payload.actual || {}, plan: payload.plan, state: payload.state || {} });
        return { ok: result.ok !== false, env: validation.env, destructive_operations: validation.destructive.length, adapter_result: result };
      });
    },
  },
  {
    url: "/project-sync/api/backup",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return adapter.backup();
      }),
  },
  {
    url: "/project-sync/api/restore",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        return adapter.restore(req.body || {});
      }),
  },
];

module.exports = {
  pluginConfigFields,
  routes,
  deploymentsTable,
  authorized,
  applyAuthorized,
  isDestructiveOperation,
  validateApplyPayload,
  sendJson,
  sendPage,
};
