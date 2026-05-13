const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("./project-io");
const { normalizePack, VERSIONED_KINDS } = require("./normalizer");
const { loadProjectState } = require("./project-state");
const { optionalRequire } = require("./tenant-adapters");
const { loadChangeIntents } = require("./change-intents");
const { ENV_POLICIES, planProject } = require("./planner");
const { diffNamedCollections, diffTables } = require("./diff");

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

/**
 * Check if request comes from an authenticated admin user.
 * Returns true if authorized, or sends a redirect/401 and returns false.
 */
function requirePageAuth(req, res) {
  if (req && req.user && req.user.role_id === 1) return true;
  if (req && req.user) {
    sendPage(res, "Unauthorized", '<p>Admin access required.</p><a href="/">Home</a>');
    return false;
  }
  // Not logged in — redirect to login
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

function nav() {
  return `<p>
<a href="/project-sync">Overview</a> |
<a href="/project-sync/status">Status</a> |
<a href="/project-sync/live-diff">Live diff</a> |
<a href="/project-sync/plan-preview">Plan preview</a> |
<a href="/project-sync/approvals">Approvals</a> |
<a href="/project-sync/health">Health</a> |
<a href="/project-sync/deployments">Deployments</a> |
<a href="/project-sync/projects"><strong>Projects</strong></a>
</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function configuredProjectRoot() {
  return process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";
}

function objectCounts(project = {}) {
  const counts = VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = (project[kind] || []).length;
    return acc;
  }, {});
  counts.plugins = (project.plugins || []).length;
  return counts;
}

function countsTable(counts = {}) {
  return `<table><thead><tr><th>Kind</th><th>Count</th></tr></thead><tbody>${Object.keys(counts)
    .sort()
    .map((kind) => `<tr><td>${escapeHtml(kind)}</td><td>${escapeHtml(counts[kind])}</td></tr>`)
    .join("")}</tbody></table>`;
}

function renderStatus({ info = {}, exported = null, projectRoot = "", error = null } = {}) {
  const capabilities = info.capabilities;
  const capabilityRows = capabilities && capabilities.resources
    ? Object.entries(capabilities.resources)
        .map(
          ([name, cap]) =>
            `<tr><td>${escapeHtml(name)}</td><td>${cap.export ? "✅" : "—"}</td><td>${cap.apply ? "✅" : "—"}</td><td>${cap.destructive ? "⚠️" : "—"}</td></tr>`
        )
        .join("")
    : "";
  return `${nav()}<h1>Project status</h1>
${error ? `<p>⚠️ ${escapeHtml(error)}</p>` : ""}
<ul>
<li>Adapter: <code>${escapeHtml(info.adapter || "native")}</code></li>
<li>Saltcorn version: <code>${escapeHtml(info.saltcorn_version || "unknown")}</code></li>
<li>Configured project root: <code>${escapeHtml(projectRoot || "not configured")}</code></li>
</ul>
<h2>Live object counts</h2>
${exported ? countsTable(objectCounts(exported)) : "<p>Live export unavailable.</p>"}
<h2>Adapter capabilities</h2>
${capabilityRows ? `<table><thead><tr><th>Resource</th><th>Export</th><th>Apply</th><th>Destructive</th></tr></thead><tbody>${capabilityRows}</tbody></table>` : "<p>No capability report available.</p>"}`;
}

function summarizeDiff(desired = {}, actual = {}) {
  const summary = { tables: null, kinds: {}, plugins: null };
  summary.tables = diffTables(desired.tables || [], actual.tables || []);
  for (const kind of VERSIONED_KINDS.filter((kind) => kind !== "tables")) {
    summary.kinds[kind] = diffNamedCollections(desired[kind] || [], actual[kind] || []);
  }
  summary.plugins = diffNamedCollections(desired.plugins || [], actual.plugins || []);
  return summary;
}

function diffCount(diff = {}) {
  return (diff.created || []).length + (diff.updated || []).length + (diff.orphaned || []).length;
}

function renderDiffList(diff = {}, label = "item") {
  const rows = [];
  for (const item of diff.created || []) rows.push(`<tr><td>Created</td><td>${escapeHtml(item.name)}</td><td>In Git, missing live</td></tr>`);
  for (const item of diff.updated || []) rows.push(`<tr><td>Updated</td><td>${escapeHtml(item.key)}</td><td>Different live shape</td></tr>`);
  for (const item of diff.orphaned || []) rows.push(`<tr><td>Orphaned</td><td>${escapeHtml(item.name)}</td><td>Live only; preserved by default</td></tr>`);
  if (!rows.length) return `<p>No ${escapeHtml(label)} drift.</p>`;
  return `<table><thead><tr><th>Kind</th><th>Name</th><th>Meaning</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function renderLiveDiff({ diff = null, projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return `${nav()}<h1>Live diff</h1><p>Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> on the server to compare Git desired state with the live tenant.</p>`;
  }
  if (error) return `${nav()}<h1>Live diff</h1><p>⚠️ ${escapeHtml(error)}</p>`;
  const tableDiff = diff && diff.tables;
  const fieldRows = [];
  for (const fieldDiff of (tableDiff && tableDiff.fieldDiffs) || []) {
    for (const field of fieldDiff.fields.created || []) fieldRows.push(`<tr><td>${escapeHtml(fieldDiff.table)}</td><td>Created</td><td>${escapeHtml(field.name)}</td><td>In Git, missing live</td></tr>`);
    for (const field of fieldDiff.fields.updated || []) fieldRows.push(`<tr><td>${escapeHtml(fieldDiff.table)}</td><td>Updated</td><td>${escapeHtml(field.key)}</td><td>Different live shape</td></tr>`);
    for (const field of fieldDiff.fields.orphaned || []) fieldRows.push(`<tr><td>${escapeHtml(fieldDiff.table)}</td><td>Orphaned</td><td>${escapeHtml(field.name)}</td><td>Live only; preserved by default</td></tr>`);
  }
  const totals = {
    tables: diffCount((tableDiff && tableDiff.tables) || {}),
    fields: fieldRows.length,
    plugins: diffCount((diff && diff.plugins) || {}),
  };
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) totals[kind] = diffCount(kindDiff);
  return `${nav()}<h1>Live diff</h1>
<p>Project root: <code>${escapeHtml(projectRoot)}</code></p>
<h2>Summary</h2>${countsTable(totals)}
<h2>Tables</h2>${renderDiffList((tableDiff && tableDiff.tables) || {}, "table")}
<h2>Fields</h2>${fieldRows.length ? `<table><thead><tr><th>Table</th><th>Kind</th><th>Field</th><th>Meaning</th></tr></thead><tbody>${fieldRows.join("")}</tbody></table>` : "<p>No field drift.</p>"}
${Object.entries((diff && diff.kinds) || {})
  .map(([kind, kindDiff]) => `<h2>${escapeHtml(kind)}</h2>${renderDiffList(kindDiff, kind)}`)
  .join("")}
<h2>Plugins</h2>${renderDiffList((diff && diff.plugins) || {}, "plugin")}`;
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
    return `${nav()}<h1>Approval controls</h1><p>Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> on the server to enable approval previews.</p>`;
  }
  if (error) return `${nav()}<h1>Approval controls</h1><p>⚠️ ${escapeHtml(error)}</p>`;
  const rows = approvals
    .map(
      (row) => `<tr>
<td><code>${escapeHtml(row.env)}</code></td>
<td>${row.operations}</td>
<td>${row.warnings ? `⚠️ ${row.warnings}` : "0"}</td>
<td>${row.blocked ? `❌ ${row.blocked}` : "0"}</td>
<td>${row.destructive ? `⚠️ ${row.destructive}` : "0"}</td>
<td>${row.backup_required ? "yes" : "no"}</td>
<td>${row.can_apply ? "Ready for CLI apply" : "Blocked"}</td>
<td><code>${escapeHtml(`saltcorn-project-sync apply --adapter rest --env ${row.env}${row.destructive ? " --allow-destructive" : ""}`)}</code></td>
</tr>`
    )
    .join("");
  const blockerDetails = approvals
    .filter((row) => row.blocked)
    .map(
      (row) => `<h3>${escapeHtml(row.env)} blockers</h3><ul>${(row.plan.blocked || [])
        .map((item) => `<li>❌ ${escapeHtml(item.reason || JSON.stringify(item))}</li>`)
        .join("")}</ul>`
    )
    .join("");
  return `${nav()}<h1>Approval controls</h1>
<p>Project root: <code>${escapeHtml(projectRoot)}</code></p>
<p>These controls are intentionally read-only. Run Git and deployment commands from the companion CLI or CI runner. REST apply remains guarded by token and environment policy.</p>
<table><thead><tr><th>Env</th><th>Ops</th><th>Warnings</th><th>Blocked</th><th>Destructive</th><th>Backup required</th><th>Status</th><th>CLI command</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Blocker details</h2>${blockerDetails || "<p>No blockers for the displayed plans.</p>"}`;
}

function renderPlanPreview({ plan = null, projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return `${nav()}<h1>Plan preview</h1><p>Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> on the server to enable project-state plan previews.</p>`;
  }
  if (error) return `${nav()}<h1>Plan preview</h1><p>⚠️ ${escapeHtml(error)}</p>`;
  const ops = (plan && plan.operations) || [];
  const warnings = (plan && plan.warnings) || [];
  const blocked = (plan && plan.blocked) || [];
  return `${nav()}<h1>Plan preview</h1>
<p>Project root: <code>${escapeHtml(projectRoot)}</code></p>
<ul><li>Operations: ${ops.length}</li><li>Warnings: ${warnings.length}</li><li>Blocked: ${blocked.length}</li><li>Backup required: ${plan && plan.backup_required ? "yes" : "no"}</li></ul>
<h2>Blocked</h2>${blocked.length ? `<ul>${blocked.map((item) => `<li>❌ ${escapeHtml(item.reason || JSON.stringify(item))}</li>`).join("")}</ul>` : "<p>None</p>"}
<h2>Warnings</h2>${warnings.length ? `<ul>${warnings.map((item) => `<li>⚠️ ${escapeHtml(item.type)} ${escapeHtml(item.table || item.plugin || item.view || item.page || item.trigger || item.role || "")}</li>`).join("")}</ul>` : "<p>None</p>"}
<h2>Operations</h2>${ops.length ? `<ul>${ops.map((op) => `<li>${op.safe ? "✅" : "⚠️"} <code>${escapeHtml(op.action)}</code> ${escapeHtml(op.table || op.plugin || op.view || op.page || op.trigger || op.role || op.field || op.from || "")}</li>`).join("")}</ul>` : "<p>None</p>"}`;
}

function deploymentsTable(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  const rows = readJsonIfExists(file, []);
  if (!rows.length) return "<p>No deployment records found.</p>";
  return `<table><thead><tr><th>Recorded</th><th>Kind</th><th>Env</th><th>Status</th><th>Commit</th><th>Ops</th><th>Warnings</th><th>Rollback of</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${row.recorded_at || ""}</td><td>${row.kind || "deployment"}</td><td>${row.env || ""}</td><td>${row.status || ""}</td><td><code>${row.commit || ""}</code></td><td>${row.operations ?? ""}</td><td>${row.warnings ?? ""}</td><td>${row.rollback_of || row.restored_from || ""}</td></tr>`
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
    console.error("[scps-api]", err.message);
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

// apiLocal: no auth check — these routes are protected by Saltcorn session auth
async function apiLocal(req, res, handler) {
  try {
    return sendJson(res, await handler());
  } catch (err) {
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

// ─── Project Setup UI Renderers ────────────────────────────

function renderProjectList(projects) {
  const rows = projects.length
    ? projects
        .map(
          (p) => `
        <tr>
          <td><a href="/project-sync/projects/${p.id}">${escapeHtml(p.name)}</a></td>
          <td><code>${escapeHtml(p.slug)}</code></td>
          <td>${escapeHtml(p.description || "")}</td>
          <td>${escapeHtml(p.root_path || "—")}</td>
          <td>${p.updated_at ? new Date(p.updated_at).toLocaleDateString() : ""}</td>
        </tr>`
        )
        .join("")
    : '<tr><td colspan="5">No projects yet. <a href="/project-sync/projects/new">Create one</a>.</td></tr>';
  return `${nav()}
<h1>Projects</h1>
<p>Define which objects from this Saltcorn tenant belong to each project.</p>
<table class="table"><thead><tr><th>Name</th><th>Slug</th><th>Description</th><th>Root path</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="/project-sync/projects/new" class="btn btn-primary">+ New project</a></p>`;
}

function renderProjectForm(project = null) {
  const isNew = !project;
  return `${nav()}
<h1>${isNew ? "New project" : "Edit project"}</h1>
<form id="project-form">
  <div class="form-group">
    <label>Name</label>
    <input type="text" id="inp-name" class="form-control" value="${escapeHtml(project?.name || "")}" required />
  </div>
  <div class="form-group">
    <label>Slug</label>
    <input type="text" id="inp-slug" class="form-control" value="${escapeHtml(project?.slug || "")}" placeholder="auto-generated from name" />
    <small class="form-text text-muted">Used as directory and git repo name.</small>
  </div>
  <div class="form-group">
    <label>Description</label>
    <textarea id="inp-description" class="form-control" rows="2">${escapeHtml(project?.description || "")}</textarea>
  </div>
  <div class="form-group">
    <label>Minimum Saltcorn version</label>
    <input type="text" id="inp-min-version" class="form-control" value="${escapeHtml(project?.min_version || "1.6.0")}" />
  </div>
  <button type="submit" class="btn btn-primary">${isNew ? "Create project" : "Save changes"}</button>
  <a href="/project-sync/projects" class="btn btn-secondary ml-2">Cancel</a>
</form>
<div id="status-msg" class="alert" style="display:none;"></div>
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
</script>`;
}

function renderProjectDetail(project, scoped) {
  const OBJECT_LABELS = {
    tables: "Tables", views: "Views", pages: "Pages",
    triggers: "Triggers", roles: "Roles", plugins: "Plugins",
    menu: "Menu",
  };

  let scopeSections = "";
  for (const [kind, label] of Object.entries(OBJECT_LABELS)) {
    const items = scoped[kind] || [];
    if (!items.length) continue;

    const rows = items.map((obj) => {
      const checked = obj.included ? "checked" : "";
      const badge = obj.auto_detected
        ? `<span class="badge badge-${obj.included ? "info" : "secondary"}">${escapeHtml(obj.auto_detected)}</span>`
        : "";
      const detail = obj.viewtemplate ? `<small class="text-muted">${escapeHtml(obj.viewtemplate)}</small>`
        : obj.field_count !== undefined ? `<small class="text-muted">${obj.field_count} fields</small>`
        : obj.item_count !== undefined ? `<small class="text-muted">${obj.item_count} items</small>`
        : obj.version ? `<small class="text-muted">v${escapeHtml(obj.version)}</small>`
        : obj.id !== undefined ? `<small class="text-muted">role #${obj.id}</small>`
        : "";
      return `<tr>
        <td><input type="checkbox" ${checked} data-kind="${kind}" data-name="${escapeHtml(obj.name)}" class="scope-toggle" /></td>
        <td>${escapeHtml(obj.name)}</td>
        <td>${detail}</td>
        <td>${badge}</td>
      </tr>`;
    }).join("");

    const included = items.filter((o) => o.included).length;
    scopeSections += `
      <h4>${label} <small class="text-muted">(${included}/${items.length} included)</small></h4>
      <table class="table table-sm"><thead><tr><th>✓</th><th>Name</th><th>Detail</th><th>Auto</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  return `${nav()}
<h1>${escapeHtml(project.name)}</h1>
<p>Slug: <code>${escapeHtml(project.slug)}</code> · Version: <code>${escapeHtml(project.min_version || "1.6.0")}</code></p>
${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}

<div class="mb-3">
  <button id="btn-download" class="btn btn-success">📦 Download ZIP</button>
  ${project.root_path ? '<button id="btn-write-disk" class="btn btn-outline-secondary ml-2">💾 Write to disk</button>' : ""}
  <button id="btn-auto-detect" class="btn btn-outline-secondary ml-2">🔄 Re-detect scope</button>
  <button id="btn-save-scope" class="btn btn-primary ml-2">✓ Save scope</button>
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
    // Save scope first, then download
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

  // Toggle all in section with Shift+click
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
</script>`;
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
              try {
                await fn.call(state, false); // noSignal=false → sends IPC to all workers
                refreshed.push(kind);
              } catch (_e) { /* best effort */ }
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
  // Download ZIP
  {
    url: "/project-sync/api/projects/:id/download",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      try {
        const ps = require("./project-setup");
        const { zipToBuffer } = require("./zip");
        const { canonicalStringify } = require("./canonical-json");

        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);

        // Write to temp dir then zip
        const os = require("node:os");
        const tmpDir = path.join(os.tmpdir(), `scps-export-${project.slug}-${Date.now()}`);
        const result = await ps.writeProjectToDir(req.params.id, tmpDir);

        // Collect all files
        const files = {};
        function walk(dir, prefix) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
            else files[rel] = fs.readFileSync(path.join(dir, entry.name));
          }
        }
        walk(tmpDir, project.slug);

        // Clean temp dir
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
  // Export to root_path on disk (for CLI-style workflow)
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
        return sendPage(res, "Projects", `${nav()}<h1>Projects</h1><p>⚠️ ${escapeHtml(err.message)}</p>`);
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
        if (!project) return sendPage(res, "Project", `${nav()}<p>Project not found.</p>`);
        const scoped = await ps.getScopedTenantObjects(project.id);
        return sendPage(res, `Project: ${project.name}`, renderProjectDetail(project, scoped));
      } catch (err) {
        return sendPage(res, "Project", `${nav()}<h1>Project</h1><p>⚠️ ${escapeHtml(err.message)}</p>`);
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
    // API routes with token auth (apply, refresh-state) — keep token auth, add session fallback
    route.callback = async (req, res) => {
      if (applyAuthorized(req)) return origCallback(req, res);
      if (requireApiAuth(req, res)) return origCallback(req, res);
    };
  } else if (isApiRoute) {
    // Other API routes — require admin session OR token
    route.callback = async (req, res) => {
      if (authorized(req)) return origCallback(req, res);
      if (requireApiAuth(req, res)) return origCallback(req, res);
    };
  } else {
    // Page routes — require admin session, redirect to login if not
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
  summarizeDiff,
  approvalMatrix,
  objectCounts,
  escapeHtml,
  sendJson,
  sendPage,
};
