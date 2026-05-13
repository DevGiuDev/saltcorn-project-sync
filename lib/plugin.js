const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("./project-io");
const { normalizePack, VERSIONED_KINDS } = require("./normalizer");
const { loadProjectState } = require("./project-state");
const { optionalRequire } = require("./tenant-adapters");
const { loadChangeIntents } = require("./change-intents");
const { ENV_POLICIES, planProject } = require("./planner");
const { diffNamedCollections, diffTables } = require("./diff");
const {
  escapeHtml, renderNav, card, statCard, emptyState, badge, statusBadge,
  countBadge, filterableTable, pageShell, diffIcon, diffRow, envBadge,
  kindIcon, kindLabel, actionIcon, fullTable,
} = require("./ui");

// ─── Plugin Configuration ─────────────────────────────────

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

// ─── Auth helpers ──────────────────────────────────────────

function requirePageAuth(req, res) {
  if (req && req.user && req.user.role_id === 1) return true;
  if (req && req.user) {
    sendPage(res, "Unauthorized", '<div class="alert alert-danger">Admin access required.</div><a href="/" class="btn btn-secondary mt-2">Home</a>');
    return false;
  }
  if (res && typeof res.redirect === "function") {
    res.redirect(`/auth/login?dest=${encodeURIComponent(req ? req.originalUrl : "/project-sync")}`);
    return false;
  }
  return false;
}

function requireApiAuth(req, res) {
  if (req && req.user && req.user.role_id === 1) return true;
  sendJson(res, { ok: false, error: "Authentication required" }, 401);
  return false;
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

// ─── Internal helpers ──────────────────────────────────────

function configuredProjectRoot() {
  return process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";
}

function objectCounts(project = {}) {
  return VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = (project[kind] || []).length;
    return acc;
  }, {});
}

function summarizeDiff(desired = {}, actual = {}) {
  const summary = { tables: null, kinds: {}, plugins: null };
  summary.tables = diffTables(desired.tables || [], actual.tables || []);
  for (const kind of VERSIONED_KINDS.filter((k) => k !== "tables")) {
    summary.kinds[kind] = diffNamedCollections(desired[kind] || [], actual[kind] || []);
  }
  summary.plugins = diffNamedCollections(desired.plugins || [], actual.plugins || []);
  return summary;
}

function diffCount(diff = {}) {
  return (diff.created || []).length + (diff.updated || []).length + (diff.orphaned || []).length;
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

// ─── View Renderers ────────────────────────────────────────

function renderOverview() {
  const links = [
    { href: "/project-sync/status", icon: "fa-heartbeat", color: "danger", title: "Status", desc: "Live object counts, adapter capabilities" },
    { href: "/project-sync/live-diff", icon: "fa-exchange-alt", color: "warning", title: "Live Diff", desc: "Compare Git desired state vs. live tenant" },
    { href: "/project-sync/plan-preview", icon: "fa-tasks", color: "success", title: "Plan Preview", desc: "Preview planned operations before apply" },
    { href: "/project-sync/approvals", icon: "fa-shield-alt", color: "info", title: "Approvals", desc: "Environment policy and approval controls" },
    { href: "/project-sync/health", icon: "fa-stethoscope", color: "secondary", title: "Health", desc: "System health checks" },
    { href: "/project-sync/deployments", icon: "fa-rocket", color: "purple", title: "Deployments", desc: "Deployment history log" },
    { href: "/project-sync/projects", icon: "fa-folder-open", color: "teal", title: "Projects", desc: "Define and manage project scopes" },
  ];
  const linkCards = links.map((l) => `
    <div class="col-sm-6 col-lg-4 mb-3">
      <a href="${l.href}" class="card card-link h-100">
        <div class="card-body p-3 d-flex align-items-center">
          <div class="avatar bg-${l.color}-lt rounded me-3" style="width:42px;height:42px;">
            <i class="fas ${l.icon} text-${l.color}" style="font-size:1.1rem;"></i>
          </div>
          <div>
            <div class="fw-bold">${l.title}</div>
            <div class="small text-muted">${l.desc}</div>
          </div>
        </div>
      </a>
    </div>`).join("");

  return pageShell("Overview", "/project-sync",
    card({
      title: "Saltcorn Project Sync",
      subtitle: "Git-backed app versioning and safe deployment planning",
      icon: "fa-code-branch",
      iconColor: "primary",
      body: `
  <div class="alert alert-info mb-4">
    <strong>Core safety rule:</strong> Missing from Git never means drop automatically.
    Orphaned tenant objects are preserved unless explicit change intents authorize destructive operations.
  </div>
  <div class="row">${linkCards}</div>
  <hr class="my-4" />
  <h6 class="mb-2"><i class="fas fa-terminal me-1"></i> Companion CLI</h6>
  <pre class="bg-light p-3 rounded small mb-0">saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev</pre>`,
    })
  );
}

function renderStatus({ info = {}, exported = null, projectRoot = "", error = null } = {}) {
  if (error) {
    return pageShell("Status", "/project-sync/status",
      card({ title: "Project Status", icon: "fa-heartbeat", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const adapter = escapeHtml(info.adapter || "native");
  const version = escapeHtml(info.saltcorn_version || "unknown");
  const rootDisplay = projectRoot ? `<code>${escapeHtml(projectRoot)}</code>` : '<span class="text-muted">not configured</span>';

  // Live object count stats
  const counts = exported ? objectCounts(exported) : {};
  const statCards = exported
    ? `<div class="row mb-4">
      ${statCard("Tables", counts.tables || 0, "fa-table", "primary")}
      ${statCard("Views", counts.views || 0, "fa-eye", "info")}
      ${statCard("Pages", counts.pages || 0, "fa-file-alt", "success")}
      ${statCard("Triggers", counts.triggers || 0, "fa-bolt", "warning")}
    </div>`
    : '<div class="text-muted">Live export unavailable.</div>';

  // Capabilities table
  const capabilities = info.capabilities;
  const capRows = capabilities && capabilities.resources
    ? Object.entries(capabilities.resources).map(([name, cap]) => `<tr>
        <td><code>${escapeHtml(name)}</code></td>
        <td>${cap.export ? '<i class="fas fa-check text-success"></i>' : '<span class="text-muted">—</span>'}</td>
        <td>${cap.apply ? '<i class="fas fa-check text-success"></i>' : '<span class="text-muted">—</span>'}</td>
        <td>${cap.destructive ? '<i class="fas fa-exclamation-triangle text-warning"></i>' : '<span class="text-muted">—</span>'}</td>
      </tr>`).join("")
    : "";

  const capTable = capRows
    ? `<table class="table table-sm table-hover align-middle mb-0">
        <thead><tr><th>Resource</th><th>Export</th><th>Apply</th><th>Destructive</th></tr></thead>
        <tbody>${capRows}</tbody>
      </table>`
    : '<div class="text-muted">No capability report available.</div>';

  return pageShell("Status", "/project-sync/status",
    card({
      title: "Project Status",
      subtitle: "Adapter info and live object counts",
      icon: "fa-heartbeat",
      iconColor: "danger",
      body: `
  <div class="row mb-3">
    <div class="col-sm-4"><div class="small text-muted">Adapter</div><div><code>${adapter}</code></div></div>
    <div class="col-sm-4"><div class="small text-muted">Saltcorn version</div><div><code>${version}</code></div></div>
    <div class="col-sm-4"><div class="small text-muted">Project root</div><div>${rootDisplay}</div></div>
  </div>
  <h6 class="mb-3"><i class="fas fa-cubes me-1"></i> Live Object Counts</h6>
  ${statCards}
  <h6 class="mb-3"><i class="fas fa-puzzle-piece me-1"></i> Adapter Capabilities</h6>
  ${capTable}`,
    })
  );
}

function renderDiffList(diff = {}, label = "item") {
  const items = [
    ...(diff.created || []).map((i) => diffRow("", "created", i.name, "In Git, missing live")),
    ...(diff.updated || []).map((i) => diffRow("", "updated", i.key, "Different live shape")),
    ...(diff.orphaned || []).map((i) => diffRow("", "orphaned", i.name, "Live only; preserved by default")),
  ];
  if (!items.length) return '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No drift detected.</div>';

  const rows = [
    ...(diff.created || []).map((i) => ({ kind: "Created", name: i.name, meaning: "In Git, missing live", _tag: "created" })),
    ...(diff.updated || []).map((i) => ({ kind: "Updated", name: i.key, meaning: "Different live shape", _tag: "updated" })),
    ...(diff.orphaned || []).map((i) => ({ kind: "Orphaned", name: i.name, meaning: "Live only; preserved by default", _tag: "orphaned" })),
  ];
  return filterableTable(`diff-${label}`, [
    { key: "kind", label: "Kind" },
    { key: "name", label: "Name" },
    { key: "meaning", label: "Meaning" },
  ], rows.map((r) => ({
    kind: `${diffIcon(r._tag)}${escapeHtml(r.kind)}`,
    name: `<code>${escapeHtml(r.name)}</code>`,
    meaning: `<small class="text-muted">${escapeHtml(r.meaning)}</small>`,
    _tag: r._tag,
    status: r.kind,
  })), { tags: [{ key: "status", label: "Status" }], emptyMsg: `No ${label} drift.` });
}

function renderLiveDiff({ diff = null, projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Live Diff", icon: "fa-exchange-alt", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> on the server to compare Git desired state with the live tenant.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Live Diff", icon: "fa-exchange-alt", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const tableDiff = diff && diff.tables;
  const fieldRows = [];
  for (const fieldDiff of (tableDiff && tableDiff.fieldDiffs) || []) {
    for (const field of fieldDiff.fields.created || []) fieldRows.push({ table: fieldDiff.table, kind: "Created", field: field.name, meaning: "In Git, missing live", status: "Created" });
    for (const field of fieldDiff.fields.updated || []) fieldRows.push({ table: fieldDiff.table, kind: "Updated", field: field.key, meaning: "Different live shape", status: "Updated" });
    for (const field of fieldDiff.fields.orphaned || []) fieldRows.push({ table: fieldDiff.table, kind: "Orphaned", field: field.name, meaning: "Live only; preserved by default", status: "Orphaned" });
  }

  const totals = {
    tables: diffCount((tableDiff && tableDiff.tables) || {}),
    fields: fieldRows.length,
    plugins: diffCount((diff && diff.plugins) || {}),
  };
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) totals[kind] = diffCount(kindDiff);

  const summaryCards = `<div class="row mb-4">
    ${statCard("Tables", totals.tables, "fa-table", totals.tables ? "warning" : "success")}
    ${statCard("Fields", totals.fields, "fa-columns", totals.fields ? "warning" : "success")}
    ${statCard("Plugins", totals.plugins, "fa-puzzle-piece", totals.plugins ? "warning" : "success")}
    ${statCard("Total drift", Object.values(totals).reduce((a, b) => a + b, 0), "fa-exchange-alt", Object.values(totals).some(v => v > 0) ? "danger" : "success")}
  </div>`;

  // Tables section
  const tablesSection = card({
    title: "Tables",
    icon: kindIcon("tables"),
    classExtra: "mb-4",
    body: renderDiffList((tableDiff && tableDiff.tables) || {}, "table"),
  });

  // Fields section
  const fieldsSection = card({
    title: "Fields",
    icon: "fa-columns",
    classExtra: "mb-4",
    body: fieldRows.length
      ? filterableTable("diff-fields", [
          { key: "table", label: "Table" },
          { key: "kind", label: "Kind" },
          { key: "field", label: "Field" },
          { key: "meaning", label: "Meaning" },
        ], fieldRows.map((r) => ({
          table: `<code>${escapeHtml(r.table)}</code>`,
          kind: `${diffIcon(r.status.toLowerCase())}${escapeHtml(r.kind)}`,
          field: `<code>${escapeHtml(r.field)}</code>`,
          meaning: `<small class="text-muted">${escapeHtml(r.meaning)}</small>`,
          status: r.status,
        })), { tags: [{ key: "status", label: "Status" }] })
      : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No field drift.</div>',
  });

  // Kind sections
  const kindSections = Object.entries((diff && diff.kinds) || {}).map(([kind, kindDiff]) =>
    card({
      title: kindLabel(kind),
      icon: kindIcon(kind),
      classExtra: "mb-4",
      body: renderDiffList(kindDiff, kind),
    })
  ).join("");

  // Plugins section
  const pluginsSection = card({
    title: "Plugins",
    icon: kindIcon("plugins"),
    body: renderDiffList((diff && diff.plugins) || {}, "plugin"),
  });

  return pageShell("Live Diff", "/project-sync/live-diff",
    card({
      title: "Live Diff",
      subtitle: `Comparing Git state vs. live tenant at <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-exchange-alt",
      iconColor: "warning",
      body: `${summaryCards}${tablesSection}${fieldsSection}${kindSections}${pluginsSection}`,
    })
  );
}

function renderPlanPreview({ plan = null, projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return pageShell("Plan Preview", "/project-sync/plan-preview",
      card({ title: "Plan Preview", icon: "fa-tasks", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable plan previews.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Plan Preview", "/project-sync/plan-preview",
      card({ title: "Plan Preview", icon: "fa-tasks", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const ops = (plan && plan.operations) || [];
  const warnings = (plan && plan.warnings) || [];
  const blocked = (plan && plan.blocked) || [];

  const summaryCards = `<div class="row mb-4">
    ${statCard("Operations", ops.length, "fa-cogs", ops.length ? "primary" : "success")}
    ${statCard("Warnings", warnings.length, "fa-exclamation-triangle", warnings.length ? "warning" : "success")}
    ${statCard("Blocked", blocked.length, "fa-ban", blocked.length ? "danger" : "success")}
    ${statCard("Backup", plan && plan.backup_required ? "Required" : "Not needed", plan && plan.backup_required ? "fa-database" : "fa-check-circle", plan && plan.backup_required ? "warning" : "success")}
  </div>`;

  // Blocked
  const blockedSection = blocked.length
    ? `<div class="alert alert-danger"><h6 class="alert-heading"><i class="fas fa-ban me-1"></i>Blocked</h6><ul class="mb-0">${blocked.map((i) => `<li>${escapeHtml(i.reason || JSON.stringify(i))}</li>`).join("")}</ul></div>`
    : '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers.</div>';

  // Warnings
  const warningRows = warnings.map((w) => ({
    type: `<i class="fas fa-exclamation-triangle text-warning me-1"></i>${escapeHtml(w.type || "")}`,
    target: escapeHtml(w.table || w.plugin || w.view || w.page || w.trigger || w.role || ""),
  }));
  const warningsSection = warnings.length
    ? filterableTable("plan-warnings", [
        { key: "type", label: "Type" },
        { key: "target", label: "Target" },
      ], warningRows, { emptyMsg: "No warnings." })
    : '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>No warnings.</div>';

  // Operations
  const opRows = ops.map((op) => ({
    action: `${actionIcon(op.action)}<code>${escapeHtml(op.action)}</code>`,
    target: escapeHtml(op.table || op.plugin || op.view || op.page || op.trigger || op.role || op.field || op.from || ""),
    safe: op.safe ? statusBadge(true, "Safe") : statusBadge(false, "Review", "Caution"),
    status: op.safe ? "safe" : "review",
  }));
  const opsSection = ops.length
    ? filterableTable("plan-ops", [
        { key: "action", label: "Action" },
        { key: "target", label: "Target" },
        { key: "safe", label: "Status" },
      ], opRows, { tags: [{ key: "status", label: "Safety" }], emptyMsg: "No operations." })
    : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No operations planned.</div>';

  return pageShell("Plan Preview", "/project-sync/plan-preview",
    card({
      title: "Plan Preview",
      subtitle: `Project root: <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-tasks",
      iconColor: "success",
      body: `${summaryCards}${blockedSection}<h6 class="mb-3">Warnings</h6>${warningsSection}<h6 class="mb-3">Operations</h6>${opsSection}`,
    })
  );
}

function destructiveOperations(plan = {}) {
  return (plan.operations || []).filter(isDestructiveOperation);
}

function approvalMatrix({ desired = {}, actual = {}, intents = [], backup = false } = {}) {
  return Object.keys(ENV_POLICIES).map((env) => {
    const plan = planProject({ desired, actual, intents, env, backup });
    return {
      env,
      plan,
      blocked: (plan.blocked || []).length,
      warnings: (plan.warnings || []).length,
      operations: (plan.operations || []).length,
      destructive: destructiveOperations(plan).length,
      backup_required: plan.backup_required,
      can_apply: (plan.blocked || []).length === 0,
    };
  });
}

function renderApprovals({ approvals = [], projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return pageShell("Approvals", "/project-sync/approvals",
      card({ title: "Approval Controls", icon: "fa-shield-alt", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable approval previews.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Approvals", "/project-sync/approvals",
      card({ title: "Approval Controls", icon: "fa-shield-alt", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const rows = approvals.map((row) => ({
    env: envBadge(row.env),
    ops: row.operations,
    warnings: row.warnings ? `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>${row.warnings}</span>` : '<span class="text-muted">0</span>',
    blocked: row.blocked ? `<span class="text-danger"><i class="fas fa-ban me-1"></i>${row.blocked}</span>` : '<span class="text-muted">0</span>',
    destructive: row.destructive ? `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>${row.destructive}</span>` : '<span class="text-muted">0</span>',
    backup: row.backup_required ? '<i class="fas fa-database text-warning"></i> Yes' : '<span class="text-muted">No</span>',
    status: row.can_apply ? statusBadge(true, "Ready") : statusBadge(false, "Blocked"),
    _can_apply: row.can_apply,
  }));

  const envTable = filterableTable("approval-matrix", [
    { key: "env", label: "Environment" },
    { key: "ops", label: "Ops" },
    { key: "warnings", label: "Warnings" },
    { key: "blocked", label: "Blocked" },
    { key: "destructive", label: "Destructive" },
    { key: "backup", label: "Backup" },
    { key: "status", label: "Status" },
  ], rows, { tags: [{ key: "_can_apply", label: "Status" }], emptyMsg: "No approval data." });

  // CLI commands
  const cliCmds = approvals.map((row) => `<div class="mb-1">
    ${envBadge(row.env)}
    <code class="ms-2 small">saltcorn-project-sync apply --adapter rest --env ${row.env}${row.destructive ? " --allow-destructive" : ""}</code>
  </div>`).join("");

  // Blocker details
  const blockerDetails = approvals.filter((row) => row.blocked).map((row) => `
    <div class="mb-3">
      <h6>${envBadge(row.env)} Blockers</h6>
      <ul class="mb-0">${(row.plan.blocked || []).map((item) =>
        `<li><i class="fas fa-times-circle text-danger me-1"></i>${escapeHtml(item.reason || JSON.stringify(item))}</li>`
      ).join("")}</ul>
    </div>`).join("");

  return pageShell("Approvals", "/project-sync/approvals",
    card({
      title: "Approval Controls",
      subtitle: "Read-only previews — run deployments from CLI or CI",
      icon: "fa-shield-alt",
      iconColor: "info",
      body: `
  <div class="alert alert-secondary mb-4">
    <i class="fas fa-info-circle me-1"></i>
    These controls are intentionally read-only. REST apply remains guarded by token and environment policy.
  </div>
  ${envTable}
  <h6 class="mt-4 mb-2">CLI Commands</h6>
  ${cliCmds}
  ${blockerDetails ? `<h6 class="mt-4 mb-2">Blocker Details</h6>${blockerDetails}` : '<div class="text-muted mt-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers for the displayed plans.</div>'}`,
    })
  );
}

function renderHealth() {
  const checks = [
    { name: "canonical JSON", ok: true },
    { name: "planner", ok: true },
    { name: "change intents", ok: true },
    { name: "deployment log path", ok: fs.existsSync(path.join(process.cwd(), ".saltcorn-project-sync")) },
  ];
  const rows = checks.map((c) => ({
    name: escapeHtml(c.name),
    status: c.ok ? statusBadge(true, "Healthy") : statusBadge(false, "Issue"),
    _ok: c.ok ? "yes" : "no",
  }));
  const table = filterableTable("health-checks", [
    { key: "name", label: "Check" },
    { key: "status", label: "Status" },
  ], rows, { tags: [{ key: "_ok", label: "Result" }], emptyMsg: "No checks." });

  return pageShell("Health", "/project-sync/health",
    card({ title: "System Health", icon: "fa-stethoscope", body: table })
  );
}

function deploymentsTable(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  const rows = readJsonIfExists(file, []);
  if (!rows.length) {
    return pageShell("Deployments", "/project-sync/deployments",
      card({ title: "Deployments", icon: "fa-rocket", body: emptyState("fa-rocket", "No deployment records found.") })
    );
  }

  const tableRows = rows.map((row) => ({
    recorded: row.recorded_at ? new Date(row.recorded_at).toLocaleDateString() : "",
    kind: badge(row.kind || "deployment", row.kind === "rollback" ? "warning" : "secondary"),
    env: envBadge(row.env || ""),
    status: row.status === "success" ? statusBadge(true, "Success") : row.status === "failed" ? statusBadge(false, "Failed") : badge(row.status || "", "secondary"),
    commit: `<code>${escapeHtml((row.commit || "").substring(0, 8))}</code>`,
    ops: row.operations ?? "",
    warnings: row.warnings ?? "",
    rollback: escapeHtml(row.rollback_of || row.restored_from || ""),
    _status: row.status === "success" ? "success" : row.status === "failed" ? "failed" : "other",
  }));

  const table = filterableTable("deployments", [
    { key: "recorded", label: "Date" },
    { key: "kind", label: "Kind" },
    { key: "env", label: "Env" },
    { key: "status", label: "Status" },
    { key: "commit", label: "Commit" },
    { key: "ops", label: "Ops" },
    { key: "warnings", label: "Warns" },
    { key: "rollback", label: "Rollback" },
  ], tableRows, {
    tags: [{ key: "_status", label: "Status" }],
    searchable: true,
    emptyMsg: "No deployment records.",
  });

  return pageShell("Deployments", "/project-sync/deployments",
    card({ title: "Deployment History", icon: "fa-rocket", body: table })
  );
}

// ─── Project Setup UI Renderers ────────────────────────────

function renderProjectList(projects) {
  if (!projects.length) {
    return pageShell("Projects", "/project-sync/projects",
      card({ title: "Projects", icon: "fa-folder-open", headerRight: '<a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a>',
        body: emptyState("fa-folder-open", "No projects yet. Define which objects from this Saltcorn tenant belong to each project.", "/project-sync/projects/new", "Create project")
      })
    );
  }

  const projectCards = projects.map((p) => `
    <div class="col-sm-6 col-lg-4 mb-3">
      <a href="/project-sync/projects/${p.id}" class="card card-link h-100">
        <div class="card-body p-3">
          <div class="d-flex align-items-center mb-2">
            <div class="avatar bg-primary-lt rounded me-3" style="width:40px;height:40px;">
              <i class="fas fa-folder text-primary"></i>
            </div>
            <div>
              <div class="fw-bold">${escapeHtml(p.name)}</div>
              <div class="small text-muted"><code>${escapeHtml(p.slug)}</code></div>
            </div>
          </div>
          ${p.description ? `<p class="small text-muted mb-2">${escapeHtml(p.description)}</p>` : ""}
          <div class="small">
            ${p.root_path ? `<span class="me-2"><i class="fas fa-hdd me-1"></i>${escapeHtml(p.root_path)}</span>` : ""}
            ${p.updated_at ? `<span class="text-muted"><i class="fas fa-clock me-1"></i>${new Date(p.updated_at).toLocaleDateString()}</span>` : ""}
          </div>
        </div>
      </a>
    </div>`).join("");

  return pageShell("Projects", "/project-sync/projects",
    card({
      title: "Projects",
      subtitle: "Define which objects from this tenant belong to each project",
      icon: "fa-folder-open",
      iconColor: "teal",
      headerRight: '<a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a>',
      body: `<div class="row">${projectCards}</div>`,
    })
  );
}

function renderProjectForm(project = null) {
  const isNew = !project;
  return pageShell(isNew ? "New Project" : "Edit Project", "/project-sync/projects",
    card({
      title: isNew ? "New project" : "Edit project",
      icon: isNew ? "fa-plus" : "fa-pen",
      body: `
<form id="project-form">
  <div class="mb-3">
    <label class="form-label">Name</label>
    <input type="text" id="inp-name" class="form-control" value="${escapeHtml(project?.name || "")}" required />
  </div>
  <div class="mb-3">
    <label class="form-label">Slug</label>
    <input type="text" id="inp-slug" class="form-control" value="${escapeHtml(project?.slug || "")}" placeholder="auto-generated from name" />
    <small class="form-text text-muted">Used as directory and git repo name.</small>
  </div>
  <div class="mb-3">
    <label class="form-label">Description</label>
    <textarea id="inp-description" class="form-control" rows="2">${escapeHtml(project?.description || "")}</textarea>
  </div>
  <div class="mb-3">
    <label class="form-label">Minimum Saltcorn version</label>
    <input type="text" id="inp-min-version" class="form-control" value="${escapeHtml(project?.min_version || "1.6.0")}" />
  </div>
  <button type="submit" class="btn btn-primary">${isNew ? "Create project" : "Save changes"}</button>
  <a href="/project-sync/projects" class="btn btn-secondary ms-2">Cancel</a>
</form>
<div id="status-msg" class="alert mt-3" style="display:none;"></div>
<script>
(function() {
  document.getElementById('project-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var el = function(id) { return document.getElementById(id); };
    var body = {
      name: el('inp-name').value,
      slug: el('inp-slug').value || undefined,
      description: el('inp-description').value,
      min_version: el('inp-min-version').value
    };
    if (!body.name) return;
    var msgEl = document.getElementById('status-msg');
    fetch('/project-sync/api/projects', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); })
      .then(function(j) {
        if (j.ok && j.project) {
          window.location = '/project-sync/projects/' + j.project.id;
        } else {
          msgEl.style.display = 'block';
          msgEl.className = 'alert alert-danger';
          msgEl.textContent = j.error || 'Failed to create project';
        }
      })
      .catch(function(err) {
        msgEl.style.display = 'block';
        msgEl.className = 'alert alert-danger';
        msgEl.textContent = err.message;
      });
  });
})();
<\/script>`,
    })
  );
}

function renderProjectDetail(project, scoped) {
  const OBJECT_LABELS = {
    tables: "Tables", views: "Views", pages: "Pages",
    triggers: "Triggers", roles: "Roles", plugins: "Plugins",
    menu: "Menu",
  };

  // Build scope sections with filterable tables
  let scopeSections = "";
  for (const [kind, label] of Object.entries(OBJECT_LABELS)) {
    const items = scoped[kind] || [];
    if (!items.length) continue;

    const included = items.filter((o) => o.included).length;
    const tableRows = items.map((obj) => {
      const checked = obj.included ? "checked" : "";
      const autoTag = obj.auto_detected
        ? `<span class="badge bg-${obj.included ? "info" : "secondary"}-lt">${escapeHtml(obj.auto_detected)}</span>`
        : '<span class="badge bg-light text-muted">—</span>';
      const detail = obj.viewtemplate ? `<small class="text-muted">${escapeHtml(obj.viewtemplate)}</small>`
        : obj.field_count !== undefined ? `<small class="text-muted">${obj.field_count} fields</small>`
        : obj.item_count !== undefined ? `<small class="text-muted">${obj.item_count} items</small>`
        : obj.version ? `<small class="text-muted">v${escapeHtml(obj.version)}</small>`
        : obj.id !== undefined ? `<small class="text-muted">role #${obj.id}</small>`
        : '<span class="text-muted">—</span>';
      return {
        toggle: `<input type="checkbox" ${checked} data-kind="${kind}" data-name="${escapeHtml(obj.name)}" class="scope-toggle form-check-input" />`,
        name: `<code>${escapeHtml(obj.name)}</code>`,
        detail,
        auto: autoTag,
        _included: obj.included ? "included" : "excluded",
        _auto: obj.auto_detected || "none",
      };
    });

    const kindTable = filterableTable(`scope-${kind}`, [
      { key: "toggle", label: "✓" },
      { key: "name", label: "Name" },
      { key: "detail", label: "Detail" },
      { key: "auto", label: "Auto" },
    ], tableRows, {
      tags: [
        { key: "_included", label: "Status" },
        ...(obj_auto_tags(items).length > 1 ? [{ key: "_auto", label: "Detection" }] : []),
      ],
      compact: true,
      emptyMsg: `No ${label.toLowerCase()}.`,
    });

    scopeSections += card({
      title: `${label} <span class="badge bg-primary-lt ms-2">${included}/${items.length}</span>`,
      icon: kindIcon(kind),
      classExtra: "mb-4",
      headerRight: `<button class="btn btn-outline-secondary btn-sm toggle-all-btn" data-kind="${kind}"><i class="fas fa-check-double me-1"></i>Toggle all</button>`,
      body: kindTable,
    });
  }

  // Summary stats
  let totalIncluded = 0, totalItems = 0;
  for (const kind of Object.keys(OBJECT_LABELS)) {
    const items = scoped[kind] || [];
    totalItems += items.length;
    totalIncluded += items.filter((o) => o.included).length;
  }

  return pageShell(`Project: ${project.name}`, "/project-sync/projects",
    card({
      title: escapeHtml(project.name),
      subtitle: `${badge(project.slug, "primary")} ${project.description ? ` · ${escapeHtml(project.description)}` : ""}`,
      icon: "fa-folder-open",
      iconColor: "primary",
      headerRight: `
        <div class="btn-group btn-group-sm">
          <button id="btn-download" class="btn btn-success"><i class="fas fa-download me-1"></i>ZIP</button>
          ${project.root_path ? '<button id="btn-write-disk" class="btn btn-outline-secondary"><i class="fas fa-hdd me-1"></i>Write disk</button>' : ""}
          <button id="btn-auto-detect" class="btn btn-outline-secondary"><i class="fas fa-sync me-1"></i>Re-detect</button>
          <button id="btn-save-scope" class="btn btn-primary"><i class="fas fa-check me-1"></i>Save scope</button>
        </div>`,
      body: `
  <div class="row mb-4">
    ${statCard("Included", totalIncluded, "fa-check-circle", "success")}
    ${statCard("Excluded", totalItems - totalIncluded, "fa-times-circle", totalItems - totalIncluded ? "warning" : "success")}
    ${statCard("Version", project.min_version || "1.6.0", "fa-code-branch", "info")}
    ${statCard("Root", project.root_path ? "Set" : "Not set", "fa-hdd", project.root_path ? "primary" : "secondary")}
  </div>
  <div id="status-msg" class="alert" style="display:none;"></div>
  ${scopeSections}
  <script>
  (function() {
    const projectId = ${project.id};

    function showMsg(text, ok) {
      const el = document.getElementById('status-msg');
      el.style.display = 'block';
      el.className = 'alert alert-' + (ok ? 'success' : 'danger');
      el.textContent = text;
      setTimeout(function() { el.style.display = 'none'; }, 4000);
    }

    function getScope() {
      const entries = [];
      document.querySelectorAll('.scope-toggle').forEach(function(cb) {
        entries.push({
          object_type: cb.dataset.kind,
          object_name: cb.dataset.name,
          included: cb.checked
        });
      });
      return entries;
    }

    document.getElementById('btn-save-scope').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(getScope())
      }).then(function(r) { return r.json(); })
        .then(function(j) { showMsg('Scope saved (' + j.count + ' entries)', j.ok); })
        .catch(function(e) { showMsg(e.message, false); });
    });

    document.getElementById('btn-auto-detect').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/auto-detect', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(j) {
          if (j.ok) location.reload();
          else showMsg(j.error || 'Failed', false);
        })
        .catch(function(e) { showMsg(e.message, false); });
    });

    document.getElementById('btn-download').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(getScope())
      }).then(function() {
        fetch('/project-sync/api/projects/' + projectId + '/download', { method: 'POST' })
          .then(function(r) {
            if (!r.ok) return r.json().then(function(j) { throw new Error(j.error); });
            return r.blob();
          })
          .then(function(blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '${escapeHtml(project.slug)}-project.zip';
            a.click();
          })
          .catch(function(e) { showMsg(e.message, false); });
      }).catch(function(e) { showMsg(e.message, false); });
    });

    ${project.root_path ? `
    document.getElementById('btn-write-disk').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/write-disk', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(j) { showMsg(j.ok ? 'Written to disk: ' + j.path : j.error, j.ok); })
        .catch(function(e) { showMsg(e.message, false); });
    });` : ""}

    // Toggle all per section
    document.querySelectorAll('.toggle-all-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.dataset.kind;
        var boxes = document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]');
        var allChecked = true;
        boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
        boxes.forEach(function(cb) { cb.checked = !allChecked; });
      });
    });

    // Shift+click to toggle all in section
    document.querySelectorAll('.scope-toggle').forEach(function(cb) {
      cb.addEventListener('click', function(e) {
        if (e.shiftKey) {
          var kind = cb.dataset.kind;
          var newState = cb.checked;
          document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]').forEach(function(other) {
            other.checked = newState;
          });
        }
      });
    });
  })();
  <\/script>`,
    })
  );
}

/** Helper: extract unique auto_detected tags from items */
function obj_auto_tags(items) {
  return [...new Set(items.map((i) => i.auto_detected || "none"))].filter((v, _i, arr) => arr.length > 1 || v !== "none");
}

// ─── Routes ────────────────────────────────────────────────

const routes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Saltcorn Project Sync", renderOverview()),
  },
  {
    url: "/project-sync/status",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Status", renderStatus({ projectRoot, error: adapter.error }));
      try {
        const info = await adapter.info();
        const exported = normalizePack(await adapter.exportProject());
        return sendPage(res, "Project Sync Status", renderStatus({ info, exported, projectRoot }));
      } catch (err) {
        return sendPage(res, "Project Sync Status", renderStatus({ projectRoot, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/live-diff",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      if (!projectRoot) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot }));
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, error: adapter.error }));
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, diff: summarizeDiff(desired, actual) }));
      } catch (err) {
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/plan-preview",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      if (!projectRoot) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot }));
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, error: adapter.error }));
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        const plan = planProject({ desired, actual, intents, env, backup: false });
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, plan }));
      } catch (err) {
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/approvals",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      if (!projectRoot) return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot }));
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, error: adapter.error }));
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, approvals: approvalMatrix({ desired, actual, intents }) }));
      } catch (err) {
        return sendPage(res, "Project Sync Approvals", renderApprovals({ projectRoot, error: err.message }));
      }
    },
  },
  {
    url: "/project-sync/health",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Project Sync Health", renderHealth()),
  },
  {
    url: "/project-sync/deployments",
    method: "get",
    callback: async (_req, res) => sendPage(res, "Project Sync Deployments", deploymentsTable()),
  },
  // ─── API routes (unchanged logic) ────────────────────
  {
    url: "/project-sync/api/status",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const info = await adapter.info();
        const exported = normalizePack(await adapter.exportProject());
        return { ok: true, info, counts: objectCounts(exported), project_root_configured: Boolean(configuredProjectRoot()) };
      }),
  },
  {
    url: "/project-sync/api/live-diff",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        return { ok: true, diff: summarizeDiff(desired, actual) };
      }),
  },
  {
    url: "/project-sync/api/plan-preview",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        return { ok: true, plan: planProject({ desired, actual, intents, env, backup: false }) };
      }),
  },
  {
    url: "/project-sync/api/approvals",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, adapter: "native", error: adapter.error };
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        return { ok: true, approvals: approvalMatrix({ desired, actual, intents }) };
      }),
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
    url: "/project-sync/api/refresh-state",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "unauthorized" }, 403);
      return api(req, res, async () => {
        const refreshed = [];
        const stateModule = optionalRequire(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
        if (stateModule && typeof stateModule.getState === "function") {
          const state = stateModule.getState();
          for (const kind of ["tables", "views", "pages", "triggers"]) {
            const fn = state[`refresh_${kind}`];
            if (typeof fn === "function") {
              try { await fn.call(state, false); refreshed.push(kind); } catch (_e) { /* best effort */ }
            }
          }
        }
        return { ok: true, refreshed };
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
  // ─── Project Setup API ──────────────────────────────
  {
    url: "/project-sync/api/projects",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const adopted = await ps.ensureDefaultProjectFromRoot();
        return { ok: true, adopted, projects: await ps.listProjects() };
      }),
  },
  {
    url: "/project-sync/api/projects",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const body = req.body || {};
        if (!body.name) return sendJson(res, { ok: false, error: "name is required" }, 400);
        const project = await ps.createProject(body);
        const scopeEntries = await ps.seedScope(project.id);
        return { ok: true, project, scope_entries: scopeEntries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);
        const scope = await ps.getScope(project.id);
        return { ok: true, project, scope };
      }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const project = await ps.updateProject(req.params.id, req.body || {});
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);
        return { ok: true, project };
      }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "delete",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        await ps.deleteProject(req.params.id);
        return { ok: true };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/tenant-objects",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const scoped = await ps.getScopedTenantObjects(req.params.id);
        return { ok: true, ...scoped };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        return { ok: true, scope: await ps.getScope(req.params.id) };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const entries = req.body;
        if (!Array.isArray(entries)) return sendJson(res, { ok: false, error: "Expected array of scope entries" }, 400);
        await ps.setScope(req.params.id, entries);
        return { ok: true, count: entries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope/:objectType/:objectName",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const { included } = req.body || {};
        await ps.updateScopeEntry(req.params.id, req.params.objectType, req.params.objectName, included);
        return { ok: true };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/auto-detect",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        const entries = await ps.seedScope(req.params.id);
        return { ok: true, scope_entries: entries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/download",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      try {
        const ps = require("./project-setup");
        const { zipToBuffer } = require("./zip");

        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);

        const os = require("node:os");
        const tmpDir = path.join(os.tmpdir(), `scps-export-${project.slug}-${Date.now()}`);
        const result = await ps.writeProjectToDir(req.params.id, tmpDir);

        const files = {};
        function walk(dir, prefix) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
            else files[rel] = fs.readFileSync(path.join(dir, entry.name));
          }
        }
        walk(tmpDir, project.slug);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const zipBuf = zipToBuffer(files);
        const zipName = `${project.slug}-v0.1.0.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
        res.setHeader("Content-Length", zipBuf.length);
        res.end(zipBuf);
      } catch (err) {
        return sendJson(res, { ok: false, error: err.message }, 500);
      }
    },
  },
  {
    url: "/project-sync/api/projects/:id/write-disk",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("./project-setup");
        return ps.writeProjectToDisk(req.params.id);
      }),
  },
  // ─── Project Setup UI ─────────────────────────────────
  {
    url: "/project-sync/projects",
    method: "get",
    callback: async (_req, res) => {
      try {
        const ps = require("./project-setup");
        await ps.ensureDefaultProjectFromRoot();
        const projects = await ps.listProjects();
        return sendPage(res, "Projects", renderProjectList(projects));
      } catch (err) {
        return sendPage(res, "Projects", pageShell("Projects", "/project-sync/projects",
          card({ title: "Projects", icon: "fa-folder-open", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(err.message)}</div>` })
        ));
      }
    },
  },
  {
    url: "/project-sync/projects/new",
    method: "get",
    callback: async (_req, res) =>
      sendPage(res, "New Project", renderProjectForm()),
  },
  {
    url: "/project-sync/projects/:id",
    method: "get",
    callback: async (req, res) => {
      try {
        const ps = require("./project-setup");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendPage(res, "Project", pageShell("Project", "/project-sync/projects",
          card({ title: "Project not found", icon: "fa-exclamation-triangle", body: emptyState("fa-search", "Project not found.", "/project-sync/projects", "Back to projects") })
        ));
        const scoped = await ps.getScopedTenantObjects(project.id);
        return sendPage(res, `Project: ${project.name}`, renderProjectDetail(project, scoped));
      } catch (err) {
        return sendPage(res, "Project", pageShell("Project", "/project-sync/projects",
          card({ title: "Error", icon: "fa-exclamation-triangle", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(err.message)}</div>` })
        ));
      }
    },
  },
];

// Apply auth guards to all routes
for (const route of routes) {
  const isApiRoute = route.url.includes("/api/");
  const hasTokenAuth = route.callback.toString().includes("applyAuthorized") || route.callback.toString().includes("authorized");
  const origCallback = route.callback;
  if (isApiRoute && hasTokenAuth) {
    route.callback = async (req, res) => {
      if (applyAuthorized(req)) return origCallback(req, res);
      if (requireApiAuth(req, res)) return origCallback(req, res);
    };
  } else if (isApiRoute) {
    route.callback = async (req, res) => {
      if (authorized(req)) return origCallback(req, res);
      if (requireApiAuth(req, res)) return origCallback(req, res);
    };
  } else {
    route.callback = async (req, res) => {
      if (!requirePageAuth(req, res)) return;
      return origCallback(req, res);
    };
  }
}

module.exports = {
  pluginConfigFields,
  routes,
  deploymentsTable,
  authorized,
  applyAuthorized,
  isDestructiveOperation,
  validateApplyPayload,
  renderStatus,
  renderLiveDiff,
  renderPlanPreview,
  renderApprovals,
  renderHealth,
  summarizeDiff,
  approvalMatrix,
  objectCounts,
  escapeHtml,
  sendJson,
  sendPage,
};
