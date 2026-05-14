const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, pullObjectToDisk, safeFileName, writeCanonicalJson } = require("./project-io");
const { normalizePack, VERSIONED_KINDS } = require("./normalizer");
const { loadProjectState } = require("./project-state");
const { optionalRequire } = require("./tenant-adapters");
const { loadChangeIntents } = require("./change-intents");
const { ENV_POLICIES, planProject } = require("./planner");
const { diffNamedCollections, diffTables } = require("./diff");
const { loadManifest, enrichWithGitInfo, readSyncMeta, computeFileSyncStatus, stampSyncMeta } = require("./manifest");
const {
  escapeHtml, renderNav, card, statCard, emptyState, badge, statusBadge,
  countBadge, filterableTable, pageShell, diffIcon, diffRow, envBadge,
  kindIcon, kindLabel, actionIcon, fullTable,
  renderTabBar, renderTabPane, scopeStatRow,
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
              sublabel: "Filesystem path to the Git repository containing project JSON files. Overrides SALTCORN_PROJECT_SYNC_PROJECT_ROOT env var.",
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

function sendPage(res, title, body, opts = {}) {
  if (res && typeof res.setHeader === "function" && opts.noCache) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  if (res && typeof res.sendWrap === "function") return res.sendWrap(title, body);
  if (res && typeof res.send === "function") return res.send(`<!doctype html><title>${title}</title>${body}`);
  return { title, body };
}

function sendJson(res, body, status = 200) {
  if (res && typeof res.status === "function" && typeof res.json === "function") return res.status(status).json(body);
  return { json: body, status };
}

// ─── Internal helpers ──────────────────────────────────────

function getPluginConfig() {
  // Always read from the root (public) tenant — plugin settings are global,
  // not per-tenant. This ensures branch tenants share the same config.
  try {
    const stateMod = optionalRequire(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
    if (stateMod) {
      const rootState = stateMod.getRootState();
      if (rootState && rootState.plugin_cfgs) {
        return rootState.plugin_cfgs["saltcorn-project-sync"] || {};
      }
    }
  } catch { /* fallback */ }
  return {};
}

function configuredProjectRoot() {
  // 1. Plugin config (from root tenant, set via Settings UI)
  const cfg = getPluginConfig();
  if (cfg.project_root) return cfg.project_root;
  // 2. Fallback to env var
  return process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";
}

function objectCounts(project = {}) {
  return VERSIONED_KINDS.reduce((acc, kind) => {
    acc[kind] = (project[kind] || []).length;
    return acc;
  }, {});
}

/**
 * Load scope set for the configured project root.
 * Returns null if no project found or scope is empty (meaning: show everything).
 */
async function loadScopeSet() {
  const projectRoot = configuredProjectRoot();
  if (!projectRoot) return null;
  try {
    const ps = require("./project-setup");
    const projects = await ps.listProjects();
    const project = projects.find((p) => p.root_path === projectRoot);
    if (!project) return null;
    const scope = await ps.getScope(project.id);
    if (!scope || !scope.length) return null;
    const scopeSet = new Set();
    for (const e of scope) {
      if (e.included) scopeSet.add(`${e.object_type}::${e.object_name}`);
    }
    return scopeSet;
  } catch {
    return null;
  }
}

function summarizeDiff(desired = {}, actual = {}, scopeSet = null) {
  const d = scopeSet ? filterPackByScope(desired, scopeSet) : desired;
  const a = scopeSet ? filterPackByScope(actual, scopeSet) : actual;
  const summary = { tables: null, kinds: {}, plugins: null };
  summary.tables = diffTables(d.tables || [], a.tables || []);
  for (const kind of VERSIONED_KINDS.filter((k) => k !== "tables")) {
    summary.kinds[kind] = diffNamedCollections(d[kind] || [], a[kind] || []);
  }
  summary.plugins = diffNamedCollections(d.plugins || [], a.plugins || []);
  return summary;
}

function filterPackByScope(pack, scopeSet) {
  if (!scopeSet) return pack;
  const result = { ...pack };
  for (const kind of [...VERSIONED_KINDS, "plugins"]) {
    if (!Array.isArray(result[kind])) continue;
    result[kind] = result[kind].filter((obj) => scopeSet.has(`${kind}::${obj.name || obj.role}`));
  }
  return result;
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
    // Guard: verify tenant matches current git branch
    const guardErr = guardBranchForRequest(req);
    if (guardErr) return sendJson(res, { ok: false, error: guardErr }, 409);
    return sendJson(res, await handler());
  } catch (err) {
    console.error("[scps-api]", err.message);
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

/**
 * Guard: check that the request's tenant matches the active git branch's schema.
 * Returns an error string if mismatch, null if OK.
 */
function guardBranchForRequest(req) {
  const projectRoot = configuredProjectRoot();
  if (!projectRoot) return null; // no project root → no guard

  try {
    const bt = require("./branch-tenant");
    // Get current tenant from Saltcorn's AsyncLocalStorage context
    const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    const requestTenant = dbMod ? dbMod.getTenantSchema() : "";
    const guard = bt.guardBranchTenant(projectRoot, requestTenant);
    if (!guard.ok) {
      console.warn("[scps-guard]", guard.error);
      return guard.error + `. Navigate to http://${guard.expected}.localhost:3000 or switch git branch to match.`;
    }
  } catch {
    // branch-tenant not available (e.g. not multi-tenant) → skip guard
  }
  return null;
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
    { href: "/project-sync/live-diff", icon: "fa-exchange-alt", color: "warning", title: "Live Diff", desc: "Diff, plan & sync between live and files" },
    { href: "/project-sync/approvals", icon: "fa-shield-alt", color: "info", title: "Approvals", desc: "Environment policy and approval controls" },
    { href: "/project-sync/health", icon: "fa-stethoscope", color: "secondary", title: "Health", desc: "System health checks" },
    { href: "/project-sync/deployments", icon: "fa-rocket", color: "purple", title: "Deployments", desc: "Deployment history log" },
    { href: "/project-sync/projects", icon: "fa-folder-open", color: "teal", title: "Projects", desc: "Define and manage project scopes" },
    { href: "/project-sync/git", icon: "fa-code-branch", color: "dark", title: "Git", desc: "Stage, commit, push, pull and branch management" },
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

  // Branch/Tenant status banner
  let branchBanner = '';
  const projectRoot = configuredProjectRoot();
  if (projectRoot) {
    try {
      const bt = require("./branch-tenant");
      const resolved = bt.resolveActiveSchema(projectRoot);
      if (resolved.branch) {
        const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        const currentTenant = dbMod ? dbMod.getTenantSchema() : "?";
        const match = resolved.schema === currentTenant;
        const matchIcon = match ? 'fa-check-circle text-success' : 'fa-exclamation-triangle text-warning';
        const matchText = match ? 'Tenant matches' : `Mismatch! Expected "${resolved.schema}", currently on "${currentTenant}"`;
        branchBanner = `
          <div class="alert ${match ? 'alert-success' : 'alert-warning'} d-flex justify-content-between align-items-center mb-4 py-2">
            <div>
              <i class="fas ${matchIcon} me-1"></i>
              <strong>Branch:</strong> <code>${escapeHtml(resolved.branch)}</code>
              <strong class="ms-3">Schema:</strong> <code>${escapeHtml(resolved.schema)}</code>
              <span class="ms-3 small">${matchText}</span>
            </div>
            <a href="/project-sync/git" class="btn btn-sm btn-outline-dark py-0 px-2"><i class="fas fa-code-branch me-1"></i>Manage branches</a>
          </div>`;
      }
    } catch { /* no branch info */ }
  }

  return pageShell("Overview", "/project-sync",
    card({
      title: "Saltcorn Project Sync",
      subtitle: "Git-backed app versioning and safe deployment planning",
      icon: "fa-code-branch",
      iconColor: "primary",
      headerRight: '<a href="/project-sync/settings" class="btn btn-outline-dark btn-sm" title="Plugin settings"><i class="fas fa-cog"></i></a>',
      body: `
  ${branchBanner}
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

/**
 * Render a sync button for a diff item.
 * direction: "pull" (live -> files) or "push" (files -> live)
 * For updated items with multiple changes, shows per-property dropdown.
 */
function renderSyncButton(objKind, diffKind, name, changes, direction) {
  var escaped = escapeHtml(name);
  var kindEsc = escapeHtml(objKind);
  var dir = direction || "pull";
  var isToFiles = dir === "pull";
  var btnClass = isToFiles ? "btn-outline-primary" : "btn-outline-success";
  var icon = isToFiles ? "fa-file-import" : "fa-cloud-upload-alt";
  var cssAction = isToFiles ? "pull" : "push";
  var label = isToFiles ? "\u2192 Files" : "\u2192 Live";
  var title = isToFiles ? "Traer del live a files" : "Aplicar a live";

  if (diffKind === "orphaned") {
    if (!isToFiles) return '<span class="text-muted">\u2014</span>';
    return '<button class="btn ' + btnClass + ' btn-sm ' + cssAction + '-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
  }
  if (diffKind === "updated") {
    var fullBtn = '<button class="btn ' + btnClass + ' btn-sm ' + cssAction + '-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
    if (!changes) return fullBtn;
    var toFilesProps = [
      ...(changes.changed || []).map(function(c){ return c.key; }),
      ...(changes.removed || []).map(function(c){ return c.key; }),
    ];
    var toLiveProps = [
      ...(changes.changed || []).map(function(c){ return c.key; }),
      ...(changes.added || []).map(function(c){ return c.key; }),
    ];
    var props = isToFiles ? toFilesProps : toLiveProps;
    if (props.length <= 1) return fullBtn;
    var propBtns = props.map(function(p){
      return '<a class="dropdown-item ' + cssAction + '-prop-btn" href="#" data-kind="' + kindEsc + '" data-name="' + escaped + '" data-prop="' + escapeHtml(p) + '">' + escapeHtml(p) + '</a>';
    }).join("");
    return '<div class="btn-group btn-group-sm" style="flex-wrap:nowrap">' +
      fullBtn +
      '<button class="btn ' + btnClass + ' btn-sm dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false"><span class="visually-hidden">Props</span></button>' +
      '<ul class="dropdown-menu">' + propBtns + '</ul>' +
    '</div>';
  }
  if (diffKind === "created") {
    if (!isToFiles) {
      return '<button class="btn ' + btnClass + ' btn-sm push-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
    }
    return '<span class="text-muted">\u2014</span>';
  }
  return "";
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "justo ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return date.toLocaleDateString();
}

function renderProjectSyncMeta(projectRoot) {
  let manifest;
  try { manifest = loadManifest(projectRoot); } catch { return ""; }
  const sync = readSyncMeta(manifest);
  const enriched = enrichWithGitInfo(manifest, projectRoot);
  const git = enriched.git;

  const rows = [];
  rows.push([
    '<i class="fas fa-code-branch me-1"></i>Versi\u00f3n',
    '<div class="d-flex align-items-center" style="gap:4px">' +
      '<code id="version-display">' + escapeHtml(manifest.version || "?") + '</code>' +
      '<input type="text" class="form-control form-control-sm d-none" id="version-input" value="' + escapeHtml(manifest.version || "") + '" style="width:100px" />' +
      '<button class="btn btn-outline-secondary btn-sm py-0 px-1" id="version-edit-btn" title="Editar versi\u00f3n"><i class="fas fa-pen" style="font-size:10px"></i></button>' +
      '<button class="btn btn-outline-success btn-sm py-0 px-1 d-none" id="version-save-btn" title="Guardar"><i class="fas fa-check" style="font-size:10px"></i></button>' +
      '<button class="btn btn-outline-secondary btn-sm py-0 px-1 d-none" id="version-cancel-btn" title="Cancelar"><i class="fas fa-times" style="font-size:10px"></i></button>' +
    '</div>',
  ]);
  if (git) {
    let gitHtml = '<span class="badge bg-secondary">' + escapeHtml(git.branch) + '</span>';
    gitHtml += ' @ <code>' + escapeHtml(git.commit || "?") + '</code>';
    if (git.dirty) gitHtml += ' <span class="badge bg-warning text-dark">dirty</span>';
    rows.push(['Git', gitHtml]);
  }
  if (sync.last_sync) {
    const ago = timeAgo(new Date(sync.last_sync));
    let syncHtml = '<span title="' + escapeHtml(sync.last_sync) + '">' + escapeHtml(ago) + '</span>';
    if (sync.last_sync_commit) syncHtml += ' @ <code>' + escapeHtml(sync.last_sync_commit) + '</code>';
    rows.push(['\u00daltimo sync', syncHtml]);
  } else {
    rows.push(['\u00daltimo sync', '<span class="text-muted">Nunca</span>']);
  }

  const body = rows.map(function(r) {
    return '<tr><td class="text-muted ps-2" style="width:140px">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
  }).join('');
  const toFilesAll = '<button class="btn btn-outline-primary btn-sm" id="full-pull-btn" title="Export all from live to files"><i class="fas fa-file-export me-1"></i>All</button>';
  const toFilesDrift = '<button class="btn btn-outline-primary btn-sm ms-1" id="pull-drift-btn" title="Sync drifted items from live to files"><i class="fas fa-file-import me-1"></i>Drift</button>';
  const toLiveDrift = '<button class="btn btn-outline-success btn-sm ms-1" id="push-drift-btn" title="Apply drifted items from files to live"><i class="fas fa-cloud-upload-alt me-1"></i>Drift</button>';
  const stampBtn = '<button class="btn btn-outline-secondary btn-sm ms-1" id="stamp-sync-btn" title="Mark files and live as aligned"><i class="fas fa-check-double me-1"></i>Sync</button>';
  const gitHint = (git && git.dirty)
    ? '<div class="alert alert-info py-1 px-2 mt-2 mb-0 small"><i class="fas fa-info-circle me-1"></i>Haz <code>git add -A && git commit</code> para registrar los cambios. <a href="/project-sync/git" class="btn btn-outline-dark btn-sm py-0 px-1 ms-1"><i class="fas fa-code-branch me-1"></i>Git panel</a></div>'
    : (git ? '<div class="mt-2"><a href="/project-sync/git" class="btn btn-outline-dark btn-sm py-0 px-1"><i class="fas fa-code-branch me-1"></i>Git panel</a></div>' : '');
  const actions = '<div class="mt-2 d-flex align-items-center flex-wrap" style="gap:.5rem">' +
    '<span class="badge bg-primary bg-opacity-10 text-primary px-2 py-1"><i class="fas fa-file me-1"></i>→ Files</span>' + toFilesAll + toFilesDrift +
    '<span class="mx-1 text-muted">|</span>' +
    '<span class="badge bg-success bg-opacity-10 text-success px-2 py-1"><i class="fas fa-cloud me-1"></i>→ Live</span>' + toLiveDrift +
    '<span class="mx-1 text-muted">|</span>' + stampBtn +
    '</div>' + gitHint;
  return '<table class="table table-sm table-borderless mb-0"><tbody>' + body + '</tbody></table>' + actions;
}

function renderDiffList(diff = {}, label = "item", objKind = label, fileStatus = null) {
  const items = [
    ...(diff.created || []).map((i) => diffRow("", "created", i.name, "In Git, missing live")),
    ...(diff.updated || []).map((i) => diffRow("", "updated", i.key, i.changesText || "Different live shape")),
    ...(diff.orphaned || []).map((i) => diffRow("", "orphaned", i.name, "Live only; preserved by default")),
  ];
  if (!items.length) return '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No drift detected.</div>';

  const rowData = [
    ...(diff.created || []).map((i) => ({ diffKind: "created", name: i.name, meaning: "In Git, missing live", _tag: "created", changes: null })),
    ...(diff.updated || []).map((i) => {
      let direction = "pull";
      if (fileStatus) {
        const safeKey = `${objKind}::${safeFileName(i.key)}`;
        const info = fileStatus.get(safeKey);
        if (info && info.modified_after_sync) direction = "push";
      }
      return { diffKind: "updated", name: i.key, meaning: i.changesText || "Different live shape", _tag: "updated", changes: i.changes || null, direction };
    }),
    ...(diff.orphaned || []).map((i) => ({ diffKind: "orphaned", name: i.name, meaning: "Live only; preserved by default", _tag: "orphaned", changes: null, direction: "pull" })),
  ];

  return filterableTable(`diff-${label}`, [
    { key: "kind", label: "Kind" },
    { key: "name", label: "Name" },
    { key: "meaning", label: "Detail" },
    { key: "action", label: "" },
  ], rowData.map((r) => ({
    kind: `${diffIcon(r._tag)}${escapeHtml(r.diffKind)}`,
    name: `<code>${escapeHtml(r.name)}</code>`,
    meaning: `<small class="text-muted">${escapeHtml(r.meaning)}</small>`,
    action: renderSyncButton(objKind, r.diffKind, r.name, r.changes, r.direction),
    _tag: r._tag,
    status: r.diffKind,
  })), { tags: [{ key: "status", label: "Status" }], emptyMsg: `No ${label} drift.` });
}

function renderLiveDiff({ diff = null, projectRoot = "", error = null, untracked = [] } = {}) {
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
    for (const field of fieldDiff.fields.updated || []) fieldRows.push({ table: fieldDiff.table, kind: "Updated", field: field.key, meaning: field.changesText || "Different live shape", status: "Updated" });
    for (const field of fieldDiff.fields.orphaned || []) fieldRows.push({ table: fieldDiff.table, kind: "Orphaned", field: field.name, meaning: "Live only; preserved by default", status: "Orphaned" });
  }

  const totals = {
    tables: diffCount((tableDiff && tableDiff.tables) || {}),
    fields: fieldRows.length,
    plugins: diffCount((diff && diff.plugins) || {}),
  };
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) totals[kind] = diffCount(kindDiff);

  const metaSection = card({
    title: "Proyecto",
    icon: "fa-info-circle",
    classExtra: "mb-4",
    body: renderProjectSyncMeta(projectRoot),
  });

  // Compute per-file sync status to determine push vs pull direction
  let fileStatus = null;
  try {
    const manifest = loadManifest(projectRoot);
    const sync = readSyncMeta(manifest);
    if (sync.last_sync_epoch) fileStatus = computeFileSyncStatus(projectRoot, sync.last_sync_epoch);
  } catch { /* no manifest = no direction info */ }

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
    body: renderDiffList((tableDiff && tableDiff.tables) || {}, "table", "table", fileStatus),
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
      body: renderDiffList(kindDiff, kind, kind, fileStatus),
    })
  ).join("");

  // Plugins section
  const pluginsSection = card({
    title: "Plugins",
    icon: kindIcon("plugins"),
    body: renderDiffList((diff && diff.plugins) || {}, "plugin", "plugins", fileStatus),
  });

  // Untracked: objects on disk but not in project scope
  const addAllBtn = '<button class="btn btn-primary btn-sm" id="add-all-untracked"><i class="fas fa-plus-circle me-1"></i>Add all to project</button>';
  const untrackedSection = untracked.length
    ? card({
        title: "Untracked",
        icon: "fa-question-circle",
        classExtra: "mb-4",
        headerRight: addAllBtn,
        body: '<div class="alert alert-info py-1 px-2 small mb-2"><i class="fas fa-info-circle me-1"></i>Objects on disk but not included in project scope. Add them to the project to enable sync.</div>' +
          filterableTable("untracked-objects", [
            { key: "kind", label: "Kind" },
            { key: "name", label: "Name" },
            { key: "action", label: "" },
          ], untracked.map((u) => ({
            kind: '<span class="badge bg-secondary">' + escapeHtml(u.kind) + '</span>',
            name: '<code>' + escapeHtml(u.name) + '</code>',
            action: '<button class="btn btn-outline-primary btn-sm add-to-scope-btn" data-kind="' + escapeHtml(u.kind) + '" data-name="' + escapeHtml(u.name) + '"><i class="fas fa-plus-circle me-1"></i>Add to project</button>',
          })))
      })
    : '';

  const syncScript = `
  <script>
  (function(){
    function flash(btn, msg, cls){
      var orig = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check me-1"></i>' + (msg || 'OK');
      btn.className = 'btn btn-sm btn-' + (cls || 'success');
      setTimeout(function(){ btn.innerHTML = orig; btn.className = btn.dataset.origClass; }, 2000);
    }
    function doPull(kind, name, properties){
      return fetch('/project-sync/api/pull', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({kind: kind, name: name, properties: properties})
      }).then(function(r){ return r.json(); });
    }
    document.addEventListener('click', function(e){
      var btn = e.target.closest('.pull-btn');
      if(btn){
        e.preventDefault();
        var kind = btn.dataset.kind, name = btn.dataset.name;
        btn.dataset.origClass = btn.className;
        btn.disabled = true;
        doPull(kind, name).then(function(res){
          btn.disabled = false;
          if(res.ok){ flash(btn, 'OK'); setTimeout(function(){ location.reload(); }, 500); }
          else { flash(btn, 'Error', 'danger'); console.error(res.error); }
        }).catch(function(err){
          btn.disabled = false;
          flash(btn, 'Error', 'danger');
          console.error(err);
        });
      }
      var propBtn = e.target.closest('.pull-prop-btn');
      if(propBtn){
        e.preventDefault();
        var kind = propBtn.dataset.kind, name = propBtn.dataset.name, prop = propBtn.dataset.prop;
        doPull(kind, name, [prop]).then(function(res){
          if(res.ok){
            var dd = propBtn.closest('.btn-group');
            if(dd){ var ts = dd.querySelector('.dropdown-toggle'); if(ts) ts.click(); }
            setTimeout(function(){ location.reload(); }, 300);
          } else {
            alert('Error: ' + (res.error || 'unknown'));
          }
        }).catch(function(err){ alert('Error: ' + err.message); });
      }
      var pushBtn = e.target.closest('.push-btn');
      if(pushBtn){
        e.preventDefault();
        alert('→ Live individual: próximamente. Usa el botón → Live (drift) para aplicar cambios.');
      }
      // Add to scope button
      var addScopeBtn = e.target.closest('.add-to-scope-btn');
      if(addScopeBtn){
        e.preventDefault();
        addScopeBtn.disabled = true;
        var scopeKind = addScopeBtn.dataset.kind, scopeName = addScopeBtn.dataset.name;
        fetch('/project-sync/api/add-to-scope', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({kind: scopeKind, name: scopeName})
        })
        .then(function(r){ return r.json(); })
        .then(function(r){
          if(r.ok){
            addScopeBtn.innerHTML = '<i class="fas fa-check me-1"></i>Added';
            addScopeBtn.className = 'btn btn-success btn-sm';
            setTimeout(function(){ location.reload(); }, 800);
          } else {
            addScopeBtn.innerHTML = '<i class="fas fa-times me-1"></i>' + (r.error || 'Error');
            addScopeBtn.className = 'btn btn-danger btn-sm';
            addScopeBtn.disabled = false;
          }
        })
        .catch(function(err){
          addScopeBtn.disabled = false;
          alert('Error: ' + err.message);
        });
      }
      // Add all untracked to scope
      var addAllBtn = e.target.closest('#add-all-untracked');
      if(addAllBtn){
        e.preventDefault();
        addAllBtn.disabled = true;
        var rows = document.querySelectorAll('.add-to-scope-btn');
        var total = rows.length, done = 0, errors = 0;
        addAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>0/' + total;
        var chain = Promise.resolve();
        rows.forEach(function(btn){
          chain = chain.then(function(){
            return fetch('/project-sync/api/add-to-scope', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({kind: btn.dataset.kind, name: btn.dataset.name})
            })
            .then(function(r){ return r.json(); })
            .then(function(r){
              done++;
              if(!r.ok) errors++;
              btn.innerHTML = r.ok ? '<i class="fas fa-check me-1"></i>Added' : '<i class="fas fa-times me-1"></i>' + (r.error || 'Error');
              btn.className = r.ok ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';
              btn.disabled = true;
              addAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>' + done + '/' + total;
            });
          });
        });
        chain.then(function(){
          addAllBtn.innerHTML = errors
            ? '<i class="fas fa-check me-1"></i>' + done + ' added, ' + errors + ' errors'
            : '<i class="fas fa-check me-1"></i>' + done + ' added';
          addAllBtn.className = errors ? 'btn btn-warning btn-sm' : 'btn btn-success btn-sm';
          setTimeout(function(){ location.reload(); }, 1000);
        });
      }
      // Stamp sync button
      var stampBtn = e.target.closest('#stamp-sync-btn');
      if(stampBtn){
        e.preventDefault();
        stampBtn.disabled = true;
        stampBtn.dataset.origClass = stampBtn.className;
        fetch('/project-sync/api/stamp-sync', {method:'POST'})
          .then(function(r){ return r.json(); })
          .then(function(res){
            stampBtn.disabled = false;
            if(res.ok){
              stampBtn.innerHTML = '<i class="fas fa-check me-1"></i>Sincronizado';
              stampBtn.className = 'btn btn-success btn-sm';
              setTimeout(function(){ location.reload(); }, 800);
            } else {
              stampBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
              stampBtn.className = 'btn btn-danger btn-sm';
              setTimeout(function(){ stampBtn.innerHTML = '<i class="fas fa-check-double me-1"></i>Marcar sync'; stampBtn.className = stampBtn.dataset.origClass; }, 2000);
            }
          })
          .catch(function(err){
            stampBtn.disabled = false;
            alert('Error: ' + err.message);
          });
      }
      // Full pull button (export all live → disk)
      // Version edit
      var versionEditBtn = e.target.closest('#version-edit-btn');
      if(versionEditBtn){
        e.preventDefault();
        document.getElementById('version-display').classList.add('d-none');
        document.getElementById('version-input').classList.remove('d-none');
        document.getElementById('version-edit-btn').classList.add('d-none');
        document.getElementById('version-save-btn').classList.remove('d-none');
        document.getElementById('version-cancel-btn').classList.remove('d-none');
        document.getElementById('version-input').focus();
        document.getElementById('version-input').select();
      }
      var versionSaveBtn = e.target.closest('#version-save-btn');
      if(versionSaveBtn){
        e.preventDefault();
        var newVer = document.getElementById('version-input').value.trim();
        if(!newVer) return;
        fetch('/project-sync/api/set-version', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:newVer})})
          .then(function(r){ return r.json(); })
          .then(function(res){
            if(res.ok){
              document.getElementById('version-display').textContent = res.version;
              document.getElementById('version-display').classList.remove('d-none');
              document.getElementById('version-input').classList.add('d-none');
              document.getElementById('version-edit-btn').classList.remove('d-none');
              document.getElementById('version-save-btn').classList.add('d-none');
              document.getElementById('version-cancel-btn').classList.add('d-none');
            } else { alert('Error: ' + (res.error||'')); }
          })
          .catch(function(err){ alert('Error: ' + err.message); });
      }
      var versionCancelBtn = e.target.closest('#version-cancel-btn');
      if(versionCancelBtn){
        e.preventDefault();
        document.getElementById('version-display').classList.remove('d-none');
        document.getElementById('version-input').classList.add('d-none');
        document.getElementById('version-edit-btn').classList.remove('d-none');
        document.getElementById('version-save-btn').classList.add('d-none');
        document.getElementById('version-cancel-btn').classList.add('d-none');
      }
      // → Files drift button
      var pullDriftBtn = e.target.closest('#pull-drift-btn');
      if(pullDriftBtn){
        e.preventDefault();
        pullDriftBtn.disabled = true;
        pullDriftBtn.dataset.origClass = pullDriftBtn.className;
        pullDriftBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sincronizando...';
        fetch('/project-sync/api/pull-drift', {method:'POST'})
          .then(function(r){ return r.json(); })
          .then(function(res){
            pullDriftBtn.disabled = false;
            if(res.ok){
              var n = res.count || 0;
              pullDriftBtn.innerHTML = '<i class="fas fa-check me-1"></i>' + n + ' pulled';
              pullDriftBtn.className = 'btn btn-success btn-sm ms-2';
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              pullDriftBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
              pullDriftBtn.className = 'btn btn-danger btn-sm ms-2';
              setTimeout(function(){ pullDriftBtn.innerHTML = '<i class="fas fa-file-import me-1"></i>\u2192 Files (drift)'; pullDriftBtn.className = pullDriftBtn.dataset.origClass; }, 3000);
            }
          })
          .catch(function(err){
            pullDriftBtn.disabled = false;
            alert('Error: ' + err.message);
          });
      }
      // → Live drift button
      var pushDriftBtn = e.target.closest('#push-drift-btn');
      if(pushDriftBtn){
        e.preventDefault();
        pushDriftBtn.disabled = true;
        pushDriftBtn.dataset.origClass = pushDriftBtn.className;
        pushDriftBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Aplicando...';
        fetch('/project-sync/api/push-drift', {method:'POST'})
          .then(function(r){ return r.json(); })
          .then(function(res){
            pushDriftBtn.disabled = false;
            if(res.ok){
              var n = res.applied ? res.applied.length : (res.count || 0);
              var msg = n + ' applied';
              if(res.skipped && res.skipped.length) msg += ' (' + res.skipped.length + ' skipped)';
              if(n === 0 && res.message) msg = res.message;
              pushDriftBtn.innerHTML = '<i class="fas fa-' + (n > 0 ? 'check' : 'info-circle') + ' me-1"></i>' + msg;
              pushDriftBtn.className = 'btn btn-' + (n > 0 ? 'success' : 'warning') + ' btn-sm ms-2';
              if(res.debug) console.warn('[push-drift] debug:', res.debug);
              if(res.skipped && res.skipped.length) console.warn('[push-drift] skipped:', res.skipped);
              setTimeout(function(){ location.reload(); }, n > 0 ? 1500 : 3000);
            } else {
              pushDriftBtn.innerHTML = '<i class="fas fa-times me-1"></i>' + (res.error || 'Error');
              pushDriftBtn.className = 'btn btn-danger btn-sm ms-2';
              pushDriftBtn.disabled = false;
              setTimeout(function(){ pushDriftBtn.innerHTML = '<i class="fas fa-cloud-upload-alt me-1"></i>Drift'; pushDriftBtn.className = pushDriftBtn.dataset.origClass; }, 4000);
            }
          })
          .catch(function(err){
            pushDriftBtn.disabled = false;
            alert('Error: ' + err.message);
          });
      }
      var fullPullBtn = e.target.closest('#full-pull-btn');
      if(fullPullBtn){
        e.preventDefault();
        if(!confirm('Exportar TODO el live al disco? Los archivos actuales se reemplazar\u00e1n.')) return;
        fullPullBtn.disabled = true;
        fullPullBtn.dataset.origClass = fullPullBtn.className;
        fullPullBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exportando...';
        fetch('/project-sync/api/full-pull', {method:'POST'})
          .then(function(r){ return r.json(); })
          .then(function(res){
            fullPullBtn.disabled = false;
            if(res.ok){
              fullPullBtn.innerHTML = '<i class="fas fa-check me-1"></i>' + Object.values(res.counts).reduce(function(a,b){return a+b;},0) + ' objetos';
              fullPullBtn.className = 'btn btn-success btn-sm';
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              fullPullBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
              fullPullBtn.className = 'btn btn-danger btn-sm';
              setTimeout(function(){ fullPullBtn.innerHTML = '<i class="fas fa-file-export me-1"></i>All'; fullPullBtn.className = fullPullBtn.dataset.origClass; }, 3000);
            }
          })
          .catch(function(err){
            fullPullBtn.disabled = false;
            alert('Error: ' + err.message);
          });
      }
    });
  })();
  <\/script>`;

  const tabNav = subTabBar("diff");
  return pageShell("Live Diff", "/project-sync/live-diff",
    card({
      title: "Live Diff",
      subtitle: `Comparing Git state vs. live tenant at <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-exchange-alt",
      iconColor: "warning",
      body: tabNav + `${metaSection}${summaryCards}${tablesSection}${fieldsSection}${kindSections}${pluginsSection}${untrackedSection}${syncScript}`,
    })
  );
}

function subTabBar(activeTab) {
  const tabs = [
    { id: "diff", label: '<i class="fas fa-exchange-alt me-1"></i>Diff', href: "/project-sync/live-diff" },
    { id: "plan", label: '<i class="fas fa-tasks me-1"></i>Plan', href: "/project-sync/plan-preview" },
  ];
  const items = tabs.map((t) => {
    const cls = t.id === activeTab ? "btn-primary" : "btn-outline-secondary";
    return '<a href="' + t.href + '" class="btn btn-sm ' + cls + '">' + t.label + '</a>';
  }).join('');
  return '<div class="btn-group btn-group-sm mb-3">' + items + '</div>';
}

function renderPlanPreview({ plan = null, projectRoot = "", error = null } = {}) {
  const tabNav = subTabBar("plan");
  if (!projectRoot) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Plan", icon: "fa-tasks", body: tabNav +
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable plan previews.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Plan", icon: "fa-tasks", body: tabNav +
        `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
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

  return pageShell("Live Diff", "/project-sync/live-diff",
    card({
      title: "Plan",
      subtitle: `Project root: <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-tasks",
      iconColor: "success",
      body: tabNav + `${summaryCards}${blockedSection}<h6 class="mb-3">Warnings</h6>${warningsSection}<h6 class="mb-3">Operations</h6>${opsSection}`,
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

function requireRootTenant(req, res) {
  try {
    const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    if (dbMod) {
      const tenant = dbMod.getTenantSchema();
      if (tenant && tenant !== "public" && tenant !== dbMod.connectObj?.default_schema) {
        sendPage(res, "Settings",
          '<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-1"></i>' +
          'Plugin settings can only be changed from the <strong>default tenant</strong> (public). ' +
          'You are on tenant <code>' + tenant + '</code>.</div>' +
          '<a href="/project-sync" class="btn btn-secondary">Back to overview</a>'
        );
        return false;
      }
    }
  } catch { /* can't check — allow */ }
  return true;
}

function renderSettingsPage({ cfg = {}, error = null } = {}) {
  const currentRoot = cfg.project_root || process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";

  const errorHtml = error
    ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
    : '';

  let rootStatus = '';
  if (currentRoot) {
    try {
      const fs = require('node:fs');
      if (fs.existsSync(currentRoot)) {
        rootStatus = '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Path exists</span>';
      } else {
        rootStatus = '<span class="badge bg-danger-lt text-danger"><i class="fas fa-times me-1"></i>Path not found</span>';
      }
    } catch { rootStatus = '<span class="badge bg-warning-lt text-warning"><i class="fas fa-question me-1"></i>Cannot check</span>'; }
  } else {
    rootStatus = '<span class="badge bg-secondary-lt">Not configured</span>';
  }

  return pageShell("Settings", "/project-sync/settings",
    card({
      title: "Plugin Settings",
      subtitle: "Saltcorn Project Sync configuration",
      icon: "fa-cog",
      iconColor: "dark",
      headerRight: '<a href="/project-sync" class="btn btn-outline-secondary btn-sm"><i class="fas fa-arrow-left me-1"></i>Back</a>',
      body: `
        ${errorHtml}
        <h6 class="mb-3"><i class="fas fa-folder-open me-1"></i>Project Root</h6>
        <div class="mb-3">
          <label class="form-label small fw-bold">Filesystem path to Git repository</label>
          <div class="input-group input-group-sm" style="max-width:500px">
            <input type="text" id="setting-project-root" class="form-control" value="${escapeHtml(currentRoot)}" placeholder="/path/to/project" />
            <button class="btn btn-outline-secondary" id="btn-browse-root" title="Verify path"><i class="fas fa-search"></i></button>
          </div>
          <div class="form-text">Where project JSON files are stored. Overrides <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> env var.</div>
          <div id="root-status" class="mt-1">${rootStatus}</div>
        </div>
        <hr />
        <div class="d-flex align-items-center" style="gap:.5rem">
          <button class="btn btn-primary" id="btn-save-settings"><i class="fas fa-save me-1"></i>Save settings</button>
          <span id="save-status" class="small text-muted"></span>
        </div>
      ` + settingsScript,
    })
  );
}

const settingsScript = `
<script>
(function(){
  document.getElementById('btn-save-settings').addEventListener('click', function(){
    var btn = this;
    var status = document.getElementById('save-status');
    btn.disabled = true;
    status.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
    fetch('/project-sync/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        project_root: document.getElementById('setting-project-root').value
      })
    }).then(function(r){ return r.json(); })
    .then(function(j){
      btn.disabled = false;
      if (j.ok) {
        status.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Saved. Reload to take effect.</span>';
      } else {
        status.innerHTML = '<span class="text-danger"><i class="fas fa-times me-1"></i>' + (j.error || 'Error') + '</span>';
      }
    }).catch(function(e){
      btn.disabled = false;
      status.innerHTML = '<span class="text-danger">' + e.message + '</span>';
    });
  });

  // Verify path on save
  document.getElementById('btn-browse-root').addEventListener('click', function(){
    var status = document.getElementById('root-status');
    var path = document.getElementById('setting-project-root').value;
    if (!path) { status.innerHTML = '<span class="text-muted">Enter a path first</span>'; return; }
    status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    fetch('/project-sync/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ project_root: path })
    }).then(function(r){ return r.json(); })
    .then(function(j){
      if (j.ok) {
        status.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Saved. Reloading...</span>';
        setTimeout(function(){ location.reload(); }, 1000);
      }
    });
  });
})();
<\/script>`;

function renderGitPage({ projectRoot, status, branches, log, remoteUrl, branchMap, error }) {
  if (!projectRoot) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable Git operations.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      })
    );
  }

  // Branch info
  const aheadBehindHtml = status && (status.ahead > 0 || status.behind > 0)
    ? '<div class="d-flex align-items-center flex-wrap" style="gap:.3rem">' +
      (status.ahead > 0
        ? `<span class="badge bg-info-lt text-info"><i class="fas fa-arrow-up me-1"></i>${status.ahead} ahead</span>` +
          `<span class="text-muted small">(${status.ahead} commit${status.ahead > 1 ? 's' : ''} not pushed)</span>`
        : '') +
      (status.behind > 0
        ? `<span class="badge bg-orange-lt text-orange"><i class="fas fa-arrow-down me-1"></i>${status.behind} behind</span>` +
          `<span class="text-muted small">(${status.behind} commit${status.behind > 1 ? 's' : ''} not pulled)</span>`
        : '') +
      '</div>'
    : (status && remoteUrl && remoteUrl.ok
      ? '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Up to date</span>'
      : '');

  // Tenant mismatch warning
  let tenantWarningHtml = '';
  const currentBranch = (branches && branches.current) || (status && status.branch) || '';
  if (projectRoot && currentBranch) {
    try {
      const bt = require("./branch-tenant");
      const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
      if (dbMod) {
        const currentTenant = dbMod.getTenantSchema();
        const guard = bt.guardBranchTenant(projectRoot, currentTenant);
        if (!guard.ok) {
          const expectedUrl = guard.expected === 'public'
            ? 'http://localhost:3000'
            : `http://${guard.expected}.localhost:3000`;
          tenantWarningHtml = `
            <div class="alert alert-warning d-flex justify-content-between align-items-center mb-3">
              <div>
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Branch/tenant mismatch!</strong><br/>
                <span class="small">Git branch <code>${escapeHtml(currentBranch)}</code> expects tenant <code>${escapeHtml(guard.expected)}</code>, but you\'re on tenant <code>${escapeHtml(guard.actual)}</code>.</span>
              </div>
              <a href="${expectedUrl}/project-sync/git" class="btn btn-warning btn-sm" target="_blank">
                <i class="fas fa-external-link-alt me-1"></i>Open on ${escapeHtml(guard.expected)}
              </a>
            </div>`;
        } else if (guard.expected && guard.expected !== 'public') {
          // Correct tenant — show confirmation
          tenantWarningHtml = `
            <div class="alert alert-success py-2 mb-3">
              <i class="fas fa-check-circle me-1"></i>
              Tenant <code>${escapeHtml(guard.actual)}</code> matches branch <code>${escapeHtml(currentBranch)}</code>
            </div>`;
        }
      }
    } catch { /* no branch-tenant */ }
  }

  const branchHtml = status
    ? `<div class="mb-3">` +
      `<div class="d-flex align-items-center flex-wrap" style="gap:.5rem">` +
      `<span class="badge bg-secondary"><i class="fas fa-code-branch me-1"></i>${escapeHtml(status.branch)}</span>` +
      (remoteUrl && remoteUrl.ok
        ? `<span class="text-muted small"><i class="fas fa-cloud me-1"></i><code>${escapeHtml(remoteUrl.stdout)}</code></span>`
        : '') +
      (status.clean
        ? '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Clean</span>'
        : '<span class="badge bg-warning text-dark"><i class="fas fa-pen me-1"></i>Dirty</span>') +
      `</div>` +
      (aheadBehindHtml ? `<div class="mt-1">${aheadBehindHtml}</div>` : '') +
      `</div>`
    : '';

  // File lists
  const staged = (status && status.staged) || [];
  const unstaged = (status && status.unstaged) || [];
  const untracked = (status && status.untracked) || [];
  const conflicted = (status && status.conflicted) || [];

  const statusIcon = (s) => {
    switch (s) {
      case 'M': return '<span class="text-warning" title="Modified">M</span>';
      case 'A': return '<span class="text-success" title="Added">A</span>';
      case 'D': return '<span class="text-danger" title="Deleted">D</span>';
      case 'R': return '<span class="text-info" title="Renamed">R</span>';
      default: return '<span class="text-muted" title="' + escapeHtml(s) + '">' + escapeHtml(s) + '</span>';
    }
  };

  // Conflicted
  const conflictedSection = conflicted.length
    ? `<div class="alert alert-danger mb-3"><strong><i class="fas fa-exclamation-triangle me-1"></i>Conflicts:</strong><ul class="mb-0 mt-1">${conflicted.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")} </ul></div>`
    : '';

  // Staged files
  const stagedSection = staged.length
    ? card({
        title: `Staged (${staged.length})`,
        icon: 'fa-plus-circle',
        iconColor: 'success',
        classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-secondary btn-sm" id="btn-unstage-all"><i class="fas fa-minus-circle me-1"></i>Unstage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th style="width:30px">X</th><th>File</th></tr></thead><tbody>${staged.map((f) =>
          `<tr><td>${statusIcon(f.status)}</td><td><code>${escapeHtml(f.path)}</code></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  // Unstaged files
  const unstagedSection = unstaged.length
    ? card({
        title: `Modified (${unstaged.length})`,
        icon: 'fa-pen',
        iconColor: 'warning',
        classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-primary btn-sm" id="btn-stage-modified"><i class="fas fa-plus me-1"></i>Stage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th style="width:30px">X</th><th>File</th><th style="width:80px"></th></tr></thead><tbody>${unstaged.map((f) =>
          `<tr><td>${statusIcon(f.status)}</td><td><code>${escapeHtml(f.path)}</code></td><td><button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(f.path)}"><i class="fas fa-plus me-1"></i>Stage</button></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  // Untracked files
  const untrackedSection = untracked.length
    ? card({
        title: `Untracked (${untracked.length})`,
        icon: 'fa-question-circle',
        iconColor: 'secondary',
        classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-primary btn-sm" id="btn-stage-untracked"><i class="fas fa-plus me-1"></i>Stage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th>File</th><th style="width:80px"></th></tr></thead><tbody>${untracked.map((f) =>
          `<tr><td><code>${escapeHtml(f)}</code></td><td><button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(f)}"><i class="fas fa-plus me-1"></i>Stage</button></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  // Nothing to commit
  const cleanMsg = (!staged.length && !unstaged.length && !untracked.length && !conflicted.length)
    ? '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>Nothing to commit, working tree clean.</div>'
    : '';

  // Commit section
  const commitSection = card({
    title: 'Commit',
    icon: 'fa-save',
    iconColor: 'primary',
    classExtra: 'mb-3',
    body: `
      <div class="input-group input-group-sm mb-2">
        <input type="text" id="git-commit-msg" class="form-control" placeholder="Commit message..." />
        <button class="btn btn-primary" id="btn-git-commit"><i class="fas fa-save me-1"></i>Commit</button>
      </div>` +
      (staged.length ? `<div class="text-muted small">${staged.length} file(s) staged and ready to commit.</div>` :
        '<div class="text-muted small">Stage files first, then commit.</div>'),
  });

  // Remote operations
  const remoteSection = card({
    title: 'Remote',
    icon: 'fa-cloud',
    iconColor: 'info',
    classExtra: 'mb-3',
    body: `
      <div class="d-flex flex-wrap align-items-center" style="gap:.5rem">
        <button class="btn ${status && status.behind > 0 ? 'btn-info' : 'btn-outline-info'} btn-sm" id="btn-git-pull"><i class="fas fa-download me-1"></i>Pull${status && status.behind > 0 ? ' (' + status.behind + ')' : ''}</button>
        <button class="btn ${status && status.ahead > 0 ? 'btn-success' : 'btn-outline-success'} btn-sm" id="btn-git-push"><i class="fas fa-upload me-1"></i>Push${status && status.ahead > 0 ? ' (' + status.ahead + ')' : ''}</button>
        <button class="btn btn-outline-secondary btn-sm" id="btn-git-fetch"><i class="fas fa-sync me-1"></i>Fetch</button>
        <span class="vr"></span>
        <button class="btn btn-outline-warning btn-sm" id="btn-git-stash"><i class="fas fa-archive me-1"></i>Stash</button>
        <button class="btn btn-outline-warning btn-sm" id="btn-git-stash-pop"><i class="fas fa-archive me-1"></i>Stash pop</button>
      </div>`,
  });

  // Branch switcher
  const allBranches = (branches && branches.local) || [];
  // currentBranch already defined above for tenant warning
  const otherBranches = allBranches.filter((b) => b !== currentBranch);

  // Build branch list with tenant info from branchMap parameter
  const bMap = branchMap || {};

  const branchRows = allBranches.map((b) => {
    const mapping = bMap[b] || null;
    const isCurrent = b === currentBranch;
    const tenant = mapping ? mapping.tenant : null;
    let url = '';
    if (tenant) {
      const base = (remoteUrl && remoteUrl.ok) ? '' : 'http://localhost:3000';
      url = `${tenant}.localhost` + (base.includes(':') ? ':' + base.split(':').pop() : ':3000');
    }
    return {
      name: isCurrent
        ? `<span class="badge bg-primary">${escapeHtml(b)}</span> <span class=\"badge bg-success-lt\">current</span>`
        : `<span class=\"badge bg-secondary\">${escapeHtml(b)}</span>`,
      tenant: tenant
        ? `<span class=\"badge bg-info-lt text-info\">${escapeHtml(tenant)}</span>`
        : '<span class="text-muted">—</span>',
      url: url ? `<a href="http://${url}" target="_blank" class=\"small\">${escapeHtml(url)} <i class=\"fas fa-external-link-alt fa-xs\"></i></a>` : '<span class="text-muted">—</span>',
      actions: (isCurrent ? '<span class="text-muted small">current</span>' :
        `<div class="d-flex flex-wrap" style=\"gap:.25rem\">
          <button class=\"btn btn-outline-secondary btn-sm py-0 px-2 checkout-btn\" data-branch=\"${escapeHtml(b)}\" title=\"Switch to this branch\"><i class=\"fas fa-code-branch me-1\"></i>Switch</button>` +
        (mapping ? `<button class=\"btn btn-outline-danger btn-sm py-0 px-2 delete-branch-btn\" data-branch=\"${escapeHtml(b)}\" title=\"Delete branch and tenant\"><i class=\"fas fa-trash me-1\"></i>Delete</button>` : '') +
        `</div>`),
      _has_tenant: !!tenant,
    };
  });

  const branchSection = card({
    title: 'Branches',
    icon: 'fa-code-branch',
    iconColor: 'secondary',
    classExtra: 'mb-3',
    headerRight: '<button class="btn btn-primary btn-sm" id="btn-create-branch"><i class="fas fa-plus me-1"></i>New branch</button>',
    body: `
      <div id="create-branch-form" class="card card-body bg-light mb-3" style="display:none">
        <div class="d-flex align-items-center flex-wrap" style="gap:.5rem">
          <input type="text" id="new-branch-name" class="form-control form-control-sm" placeholder="Branch name (e.g. feature/new-views)" style="max-width:280px" />
          <button class="btn btn-primary btn-sm" id="btn-do-create-branch"><i class="fas fa-code-branch me-1"></i>Create branch + tenant</button>
          <button class="btn btn-outline-secondary btn-sm" id="btn-cancel-branch">Cancel</button>
        </div>
        <div class="small text-muted mt-1">Creates a git branch, clones the current tenant to a new schema with all data. You\'ll be able to login with the same credentials on the new subdomain.</div>
        <div id="create-branch-status" class="mt-2" style="display:none"></div>
      </div>` +
      filterableTable('git-branches', [
        { key: 'name', label: 'Branch' },
        { key: 'tenant', label: 'Tenant' },
        { key: 'url', label: 'URL' },
        { key: 'actions', label: '' },
      ], branchRows, {
        tags: [{ key: '_has_tenant', label: 'Has tenant' }],
        emptyMsg: 'No branches.',
      }),
  });

  // Log
  const commits = (log && log.commits) || [];
  const logRows = commits.map((c) => ({
    hash: `<code>${escapeHtml(c.hash)}</code>`,
    message: escapeHtml(c.message),
    author: `<span class="text-muted">${escapeHtml(c.author)}</span>`,
    date: `<span class="text-muted">${escapeHtml(c.date)}</span>`,
  }));

  const logSection = card({
    title: 'Recent commits',
    icon: 'fa-history',
    iconColor: 'dark',
    body: commits.length
      ? filterableTable('git-log', [
          { key: 'hash', label: 'Hash' },
          { key: 'message', label: 'Message' },
          { key: 'author', label: 'Author' },
          { key: 'date', label: 'Date' },
        ], logRows, { searchable: false, emptyMsg: 'No commits.' })
      : '<div class="text-muted">No commits found.</div>',
  });

  // Script for all interactions
  const gitScript = `
  <script>
  (function(){
    function flash(btn, msg, cls, duration) {
      var orig = btn.innerHTML;
      btn.innerHTML = msg;
      btn.className = 'btn btn-sm btn-' + (cls || 'success');
      setTimeout(function(){ btn.innerHTML = orig; btn.className = btn.dataset.origClass; }, duration || 2000);
    }
    function saveOrig(btn) { if (!btn.dataset.origClass) btn.dataset.origClass = btn.className; }

    // Stage single file
    document.addEventListener('click', function(e){
      var stageBtn = e.target.closest('.stage-btn');
      if (stageBtn) {
        e.preventDefault();
        saveOrig(stageBtn);
        stageBtn.disabled = true;
        fetch('/project-sync/api/git/add', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:[stageBtn.dataset.path]})})
          .then(function(r){return r.json();})
          .then(function(j){
            stageBtn.disabled = false;
            if (j.ok) setTimeout(function(){ location.reload(); }, 300);
            else { flash(stageBtn, 'Error: ' + (j.error||''), 'danger', 3000); }
          });
      }

      // Stage all modified
      var stageMod = e.target.closest('#btn-stage-modified');
      if (stageMod) {
        e.preventDefault();
        saveOrig(stageMod);
        stageMod.disabled = true;
        var paths = [];
        document.querySelectorAll('.stage-btn').forEach(function(b){ if(b.dataset.path) paths.push(b.dataset.path); });
        fetch('/project-sync/api/git/add', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:paths})})
          .then(function(r){return r.json();})
          .then(function(j){
            stageMod.disabled = false;
            if (j.ok) setTimeout(function(){ location.reload(); }, 300);
            else { flash(stageMod, 'Error', 'danger', 3000); }
          });
      }

      // Stage all untracked
      var stageUn = e.target.closest('#btn-stage-untracked');
      if (stageUn) {
        e.preventDefault();
        saveOrig(stageUn);
        stageUn.disabled = true;
        fetch('/project-sync/api/git/add', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:null})})
          .then(function(r){return r.json();})
          .then(function(j){
            stageUn.disabled = false;
            if (j.ok) setTimeout(function(){ location.reload(); }, 300);
            else { flash(stageUn, 'Error', 'danger', 3000); }
          });
      }

      // Unstage all
      var unstageAll = e.target.closest('#btn-unstage-all');
      if (unstageAll) {
        e.preventDefault();
        saveOrig(unstageAll);
        unstageAll.disabled = true;
        fetch('/project-sync/api/git/reset', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({})})
          .then(function(r){return r.json();})
          .then(function(j){
            unstageAll.disabled = false;
            if (j.ok) setTimeout(function(){ location.reload(); }, 300);
            else { flash(unstageAll, 'Error', 'danger', 3000); }
          });
      }

      // Commit
      var commitBtn = e.target.closest('#btn-git-commit');
      if (commitBtn) {
        e.preventDefault();
        var msg = document.getElementById('git-commit-msg').value.trim();
        if (!msg) { alert('Write a commit message first.'); return; }
        saveOrig(commitBtn);
        commitBtn.disabled = true;
        fetch('/project-sync/api/git/commit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg})})
          .then(function(r){return r.json();})
          .then(function(j){
            commitBtn.disabled = false;
            if (j.ok) {
              document.getElementById('git-commit-msg').value = '';
              flash(commitBtn, '<i class="fas fa-check me-1"></i>Committed ' + (j.hash||''), 'success', 3000);
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              flash(commitBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }

      // Pull
      var pullBtn = e.target.closest('#btn-git-pull');
      if (pullBtn) {
        e.preventDefault();
        saveOrig(pullBtn);
        pullBtn.disabled = true;
        pullBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Pulling...';
        fetch('/project-sync/api/git/pull', {method:'POST', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            pullBtn.disabled = false;
            if (j.ok) {
              flash(pullBtn, '<i class="fas fa-check me-1"></i>Pulled', 'success', 3000);
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              flash(pullBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }

      // Push
      var pushBtn = e.target.closest('#btn-git-push');
      if (pushBtn) {
        e.preventDefault();
        saveOrig(pushBtn);
        pushBtn.disabled = true;
        pushBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Pushing...';
        fetch('/project-sync/api/git/push', {method:'POST', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            pushBtn.disabled = false;
            if (j.ok) {
              flash(pushBtn, '<i class="fas fa-check me-1"></i>Pushed', 'success', 3000);
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              flash(pushBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }

      // Fetch
      var fetchBtn = e.target.closest('#btn-git-fetch');
      if (fetchBtn) {
        e.preventDefault();
        saveOrig(fetchBtn);
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Fetching...';
        fetch('/project-sync/api/git/fetch', {method:'POST', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            fetchBtn.disabled = false;
            if (j.ok) {
              flash(fetchBtn, '<i class="fas fa-check me-1"></i>Fetched', 'success', 3000);
              setTimeout(function(){ location.reload(); }, 1000);
            } else {
              flash(fetchBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }

      // Stash
      var stashBtn = e.target.closest('#btn-git-stash');
      if (stashBtn) {
        e.preventDefault();
        saveOrig(stashBtn);
        stashBtn.disabled = true;
        fetch('/project-sync/api/git/stash', {method:'POST', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            stashBtn.disabled = false;
            if (j.ok) { flash(stashBtn, '<i class="fas fa-check me-1"></i>Stashed', 'success'); setTimeout(function(){ location.reload(); }, 1000); }
            else flash(stashBtn, '<i class="fas fa-times me-1"></i>' + (j.error||''), 'danger', 4000);
          });
      }

      // Stash pop
      var stashPopBtn = e.target.closest('#btn-git-stash-pop');
      if (stashPopBtn) {
        e.preventDefault();
        saveOrig(stashPopBtn);
        stashPopBtn.disabled = true;
        fetch('/project-sync/api/git/stash-pop', {method:'POST', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            stashPopBtn.disabled = false;
            if (j.ok) { flash(stashPopBtn, '<i class="fas fa-check me-1"></i>Popped', 'success'); setTimeout(function(){ location.reload(); }, 1000); }
            else flash(stashPopBtn, '<i class="fas fa-times me-1"></i>' + (j.error||''), 'danger', 4000);
          });
      }

      // Checkout branch
      var checkoutBtn = e.target.closest('.checkout-btn');
      if (checkoutBtn) {
        e.preventDefault();
        var branch = checkoutBtn.dataset.branch;
        if (!confirm('Switch to branch "' + branch + '"?')) return;
        saveOrig(checkoutBtn);
        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>';
        fetch('/project-sync/api/branches/switch', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({branch:branch})})
          .then(function(r){return r.json();})
          .then(function(j){
            checkoutBtn.disabled = false;
            if (j.ok) {
              flash(checkoutBtn, '<i class="fas fa-check me-1"></i>Switched', 'success');
              if (j.url) {
                setTimeout(function(){ window.location.href = j.url + '/project-sync/git'; }, 1000);
              } else {
                setTimeout(function(){ location.reload(); }, 1000);
              }
            } else {
              flash(checkoutBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }

      // Create branch button (toggle form)
      var createBranchBtn = e.target.closest('#btn-create-branch');
      if (createBranchBtn) {
        e.preventDefault();
        var form = document.getElementById('create-branch-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (form.style.display === 'block') document.getElementById('new-branch-name').focus();
      }
      var cancelBranchBtn = e.target.closest('#btn-cancel-branch');
      if (cancelBranchBtn) {
        e.preventDefault();
        document.getElementById('create-branch-form').style.display = 'none';
      }

      // Do create branch
      var doCreateBtn = e.target.closest('#btn-do-create-branch');
      if (doCreateBtn) {
        e.preventDefault();
        var name = document.getElementById('new-branch-name').value.trim();
        if (!name) { alert('Enter a branch name.'); return; }
        doCreateBtn.disabled = true;
        var statusEl = document.getElementById('create-branch-status');
        statusEl.style.display = 'block';
        statusEl.className = 'mt-2 alert alert-info';
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Creating branch and cloning tenant...';
        fetch('/project-sync/api/branches/create', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({branch:name})})
          .then(function(r){return r.json();})
          .then(function(j){
            doCreateBtn.disabled = false;
            if (j.ok) {
              statusEl.className = 'mt-2 alert alert-success';
              statusEl.innerHTML = '<i class="fas fa-check me-1"></i>Branch <strong>' + name + '</strong> created! Tenant: <code>' + (j.schema||'') + '</code>' +
                (j.url ? ' — <a href="http://' + j.url + '" target="_blank">Open ' + j.url + ' <i class="fas fa-external-link-alt fa-xs"></i></a>' : '');
              setTimeout(function(){ location.reload(); }, 3000);
            } else {
              statusEl.className = 'mt-2 alert alert-danger';
              statusEl.innerHTML = '<i class="fas fa-times me-1"></i>' + (j.error || 'Unknown error');
            }
          })
          .catch(function(err){
            doCreateBtn.disabled = false;
            statusEl.className = 'mt-2 alert alert-danger';
            statusEl.innerHTML = '<i class="fas fa-times me-1"></i>' + err.message;
          });
      }

      // Delete branch
      var deleteBranchBtn = e.target.closest('.delete-branch-btn');
      if (deleteBranchBtn) {
        e.preventDefault();
        var branch = deleteBranchBtn.dataset.branch;
        if (!confirm('Delete branch "' + branch + '" and its tenant (schema)? This drops all data in that tenant.')) return;
        saveOrig(deleteBranchBtn);
        deleteBranchBtn.disabled = true;
        fetch('/project-sync/api/branches/' + encodeURIComponent(branch), {method:'DELETE', headers:{'Content-Type':'application/json'}})
          .then(function(r){return r.json();})
          .then(function(j){
            deleteBranchBtn.disabled = false;
            if (j.ok) {
              flash(deleteBranchBtn, '<i class="fas fa-check me-1"></i>Deleted', 'success');
              setTimeout(function(){ location.reload(); }, 1500);
            } else {
              flash(deleteBranchBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
            }
          });
      }
    });
  })();
  <\/script>`;

  return pageShell("Git", "/project-sync/git",
    card({
      title: "Git",
      subtitle: `<code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-code-branch",
      iconColor: "dark",
      body:
        branchHtml +
        tenantWarningHtml +
        conflictedSection +
        // ─── Block 1: Files + Commit/Remote ───────────
        `<div class="row">
          <div class="col-lg-6">
            ${stagedSection}
            ${unstagedSection}
            ${untrackedSection}
            ${(!staged.length && !unstaged.length && !untracked.length && !conflicted.length)
              ? '<div class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i>Nothing to commit, working tree clean.</div>'
              : ''}
          </div>
          <div class="col-lg-6">
            ${commitSection}
            ${remoteSection}
          </div>
        </div>` +
        // ─── Block 2: Branches + Commits ─────────────
        `<div class="row">
          <div class="col-lg-6">
            ${branchSection}
          </div>
          <div class="col-lg-6">
            ${logSection}
          </div>
        </div>` +
        gitScript,
    })
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

  // ── Build per-type tab data ────────────────────────────
  const tabData = [];
  for (const [kind, label] of Object.entries(OBJECT_LABELS)) {
    const items = scoped[kind] || [];
    const included = items.filter((o) => o.included).length;
    tabData.push({ kind, label, items, included, total: items.length });
  }

  // Only show tabs that have items
  const visibleTabs = tabData.filter((t) => t.total > 0);
  const activeTab = visibleTabs.length ? visibleTabs[0].kind : "";

  // ── Overall summary stats ─────────────────────────────
  let totalIncluded = 0, totalItems = 0;
  for (const t of tabData) {
    totalItems += t.total;
    totalIncluded += t.included;
  }

  const summaryStats = `
  <div class="row mb-4">
    ${statCard("Included", totalIncluded, "fa-check-circle", "success")}
    ${statCard("Excluded", totalItems - totalIncluded, "fa-times-circle", totalItems - totalIncluded ? "warning" : "success")}
    ${statCard("Version", project.min_version || "1.6.0", "fa-code-branch", "info")}
    ${statCard("Root", project.root_path ? "Set" : "Not set", "fa-hdd", project.root_path ? "primary" : "secondary")}
  </div>`;

  // ── Per-type tag definitions ──────────────────────────
  function typeTags(kind, items) {
    const tags = [{ key: "_included", label: "Status" }];
    switch (kind) {
      case "tables": {
        const hasSystem = items.some((o) => o.is_system);
        if (hasSystem) tags.push({ key: "_is_system", label: "System" });
        break;
      }
      case "views": {
        const vts = [...new Set(items.map((o) => o.viewtemplate || "—"))].filter((v) => v && v !== "—");
        if (vts.length > 1) tags.push({ key: "_viewtemplate", label: "Viewtemplate" });
        const tbls = [...new Set(items.map((o) => o.table_name || "—"))].filter((v) => v && v !== "—");
        if (tbls.length > 1) tags.push({ key: "_table_name", label: "Table" });
        break;
      }
      case "triggers": {
        const acts = [...new Set(items.map((o) => o.action || "—"))].filter((v) => v && v !== "—");
        if (acts.length > 1) tags.push({ key: "_action", label: "Action" });
        const tbls = [...new Set(items.map((o) => o.table_name || "—"))].filter((v) => v && v !== "—");
        if (tbls.length > 1) tags.push({ key: "_table_name", label: "Table" });
        break;
      }
      case "plugins": {
        const srcs = [...new Set(items.map((o) => o.source || "—"))].filter((v) => v && v !== "—");
        if (srcs.length > 1) tags.push({ key: "_source", label: "Source" });
        break;
      }
    }
    // Auto-detected tags (only if >1 distinct value)
    const autoVals = obj_auto_tags(items);
    if (autoVals.length > 1) tags.push({ key: "_auto", label: "Detection" });
    // Saltcorn instance tags (Etiquetas)
    const saltcornTags = collectSaltcornTags(items);
    if (saltcornTags.length >= 1) tags.push({ key: "_sc_tag", label: "Tags", multi_match: true });
    return tags;
  }

  // Collect all unique Saltcorn tag names across items of a kind
  function collectSaltcornTags(items) {
    const set = new Set();
    for (const obj of items) {
      if (Array.isArray(obj.tags)) {
        for (const t of obj.tags) set.add(t);
      }
    }
    return [...set];
  }

  // ── Per-type table columns ────────────────────────────
  function typeColumns(kind, items) {
    const base = [
      { key: "toggle", label: "✓" },
      { key: "name", label: "Name" },
    ];
    // Check if any item has Saltcorn tags
    const hasScTags = items && items.some((o) => Array.isArray(o.tags) && o.tags.length > 0);
    const tagsCol = hasScTags ? [{ key: "sc_tags", label: "Tags" }] : [];
    switch (kind) {
      case "tables":
        return [...base, { key: "detail", label: "Fields" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "views":
        return [...base, { key: "viewtemplate", label: "Template" }, { key: "table_col", label: "Table" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "triggers":
        return [...base, { key: "action_col", label: "Action" }, { key: "table_col", label: "Table" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "plugins":
        return [...base, { key: "detail", label: "Version" }, { key: "source_col", label: "Source" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "roles":
        return [...base, { key: "detail", label: "Detail" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "pages":
        return [...base, { key: "detail", label: "Title" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "menu":
        return [...base, { key: "detail", label: "Items" }, ...tagsCol, { key: "auto", label: "Auto" }];
      default:
        return [...base, { key: "detail", label: "Detail" }, ...tagsCol, { key: "auto", label: "Auto" }];
    }
  }

  // ── Build table rows per type ─────────────────────────
  function typeRows(kind, items) {
    return items.map((obj) => {
      const checked = obj.included ? "checked" : "";
      const autoTag = obj.auto_detected
        ? `<span class="badge bg-${obj.included ? "info" : "secondary"}-lt">${escapeHtml(obj.auto_detected)}</span>`
        : '<span class="badge bg-light text-muted">—</span>';

      // Type-specific detail column
      let detail = '<span class="text-muted">—</span>';
      switch (kind) {
        case "tables":
          detail = obj.field_count !== undefined ? `<small class="text-muted">${obj.field_count} fields</small>` : '<span class="text-muted">—</span>';
          break;
        case "views":
          detail = obj.viewtemplate ? `<span class="badge bg-info-lt text-info">${escapeHtml(obj.viewtemplate)}</span>` : '<span class="text-muted">—</span>';
          break;
        case "triggers":
          detail = obj.action ? `<code class="small">${escapeHtml(obj.action)}</code>` : '<span class="text-muted">—</span>';
          break;
        case "plugins":
          detail = obj.version ? `<small class="text-muted">v${escapeHtml(obj.version)}</small>` : '<span class="text-muted">—</span>';
          break;
        case "roles":
          detail = obj.id !== undefined ? `<small class="text-muted">role #${obj.id}</small>` : '<span class="text-muted">—</span>';
          break;
        case "pages":
          detail = obj.title ? `<small class="text-muted">${escapeHtml(obj.title)}</small>` : '<span class="text-muted">—</span>';
          break;
        case "menu":
          detail = obj.item_count !== undefined ? `<small class="text-muted">${obj.item_count} items</small>` : '<span class="text-muted">—</span>';
          break;
      }

      const row = {
        toggle: `<input type="checkbox" ${checked} data-kind="${kind}" data-name="${escapeHtml(obj.name)}" class="scope-toggle form-check-input" />`,
        name: `<code>${escapeHtml(obj.name)}</code>`,
        detail,
        auto: autoTag,
        _included: obj.included ? "included" : "excluded",
        _auto: obj.auto_detected || "none",
        // Saltcorn tags
        sc_tags: Array.isArray(obj.tags) && obj.tags.length
          ? obj.tags.map((t) => `<span class="badge bg-purple-lt text-purple me-1">${escapeHtml(t)}</span>`).join("")
          : '<span class="text-muted">—</span>',
        _sc_tag: Array.isArray(obj.tags) && obj.tags.length ? obj.tags.join("|") : "—",
      };

      // Add type-specific filter columns + data attributes
      switch (kind) {
        case "tables":
          row._is_system = obj.is_system ? "system" : "user";
          break;
        case "views":
          row.viewtemplate = obj.viewtemplate ? `<span class="badge bg-info-lt text-info">${escapeHtml(obj.viewtemplate)}</span>` : '<span class="text-muted">—</span>';
          row.table_col = obj.table_name ? `<code class="small">${escapeHtml(obj.table_name)}</code>` : '<span class="text-muted">—</span>';
          row._viewtemplate = obj.viewtemplate || "—";
          row._table_name = obj.table_name || "—";
          break;
        case "triggers":
          row.action_col = obj.action ? `<code class="small">${escapeHtml(obj.action)}</code>` : '<span class="text-muted">—</span>';
          row.table_col = obj.table_name ? `<code class="small">${escapeHtml(obj.table_name)}</code>` : '<span class="text-muted">—</span>';
          row._action = obj.action || "—";
          row._table_name = obj.table_name || "—";
          break;
        case "plugins":
          row.source_col = obj.source ? `<small class="text-muted">${escapeHtml(obj.source)}</small>` : '<span class="text-muted">—</span>';
          row._source = obj.source || "—";
          break;
      }

      return row;
    });
  }

  // ── Render each tab pane ──────────────────────────────
  const tabPanes = visibleTabs.map((t) => {
    const tags = typeTags(t.kind, t.items);
    const columns = typeColumns(t.kind, t.items);
    const rows = typeRows(t.kind, t.items);

    const isActive = t.kind === activeTab;
    const table = filterableTable(`scope-${t.kind}`, columns, rows, {
      tags,
      compact: true,
      searchable: true,
      emptyMsg: `No ${t.label.toLowerCase()}.`,
    });

    const body = `
      <div class="d-flex justify-content-between align-items-center mb-3 pt-2">
        <h6 class="mb-0"><i class="fas ${kindIcon(t.kind)} me-1"></i>${escapeHtml(t.label)} <span class="badge bg-primary-lt ms-1">${t.included}/${t.total}</span></h6>
        <button class="btn btn-outline-secondary btn-sm toggle-all-btn" data-kind="${t.kind}"><i class="fas fa-check-double me-1"></i>Toggle all</button>
      </div>
      ${table}`;

    return renderTabPane(t.kind, body, isActive);
  }).join("");

  // ── Tab bar ───────────────────────────────────────────
  const tabBar = renderTabBar(
    visibleTabs.map((t) => ({
      id: t.kind,
      label: t.label,
      icon: kindIcon(t.kind).replace("fa ", ""), // strip 'fa ' prefix
      badge: t.included < t.total ? `${t.included}/${t.total}` : t.total,
      badgeColor: t.included < t.total ? "warning" : "success",
    })),
    activeTab
  );

  // ── Full page ─────────────────────────────────────────
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
  ${summaryStats}
  <div id="status-msg" class="alert" style="display:none;"></div>
  ${tabBar}
  <div class="tab-content border border-top-0 rounded-bottom p-3 bg-white">${tabPanes}</div>
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

    // Toggle all per section (within active tab)
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
      if (!projectRoot) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot }), { noCache: true });
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, error: adapter.error }), { noCache: true });
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const scopeSet = await loadScopeSet();
        // Compute untracked: objects on disk not in scope
        let untracked = [];
        if (scopeSet) {
          const KINDS = [...VERSIONED_KINDS, "plugins"];
          for (const kind of KINDS) {
            for (const obj of (desired[kind] || [])) {
              const key = `${kind}::${obj.name || obj.role}`;
              if (!scopeSet.has(key)) untracked.push({ kind, name: obj.name || obj.role });
            }
          }
        }
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, diff: summarizeDiff(desired, actual, scopeSet), untracked }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Project Sync Live Diff", renderLiveDiff({ projectRoot, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/plan-preview",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      if (!projectRoot) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot }), { noCache: true });
      const adapter = await nativeAdapterOrError();
      if (adapter.error) return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, error: adapter.error }), { noCache: true });
      try {
        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const intents = loadChangeIntents(projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        const plan = planProject({ desired, actual, intents, env, backup: false });
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, plan }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Project Sync Plan Preview", renderPlanPreview({ projectRoot, error: err.message }), { noCache: true });
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
        const scopeSet = await loadScopeSet();
        return { ok: true, diff: summarizeDiff(desired, actual, scopeSet) };
      }),
  },
  {
    url: "/project-sync/api/pull",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const body = req.body || {};
        const kind = body.kind;
        const name = body.name;
        const properties = body.properties; // undefined = full pull
        if (!kind || !name) return { ok: false, error: "kind and name are required" };
        if (!VERSIONED_KINDS.includes(kind) && kind !== "plugins") return { ok: false, error: `invalid kind: ${kind}` };

        // Export live state and find the target object
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        const livePack = normalizePack(await adapter.exportProject());
        const collection = kind === "plugins" ? (livePack.plugins || []) : (livePack[kind] || []);
        const liveObj = collection.find((o) => (o.name || o.role) === name);
        if (!liveObj) return { ok: false, error: `${kind}/${name} not found in live export` };

        const result = pullObjectToDisk(projectRoot, kind, liveObj, properties);
        return { ok: true, ...result };
      }),
  },
  {
    url: "/project-sync/api/set-version",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const version = (req.body || {}).version;
        if (!version || typeof version !== "string") return { ok: false, error: "version is required" };
        const manifestPath = path.join(projectRoot, "saltcorn.project.json");
        const manifest = readJsonIfExists(manifestPath);
        if (!manifest) return { ok: false, error: "saltcorn.project.json not found" };
        manifest.version = version.trim();
        writeCanonicalJson(manifestPath, manifest);
        return { ok: true, version: manifest.version };
      }),
  },
  {
    url: "/project-sync/api/stamp-sync",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const manifestPath = path.join(projectRoot, "saltcorn.project.json");
        const manifest = readJsonIfExists(manifestPath);
        if (!manifest) return { ok: false, error: "saltcorn.project.json not found" };
        stampSyncMeta(manifest, projectRoot);
        writeCanonicalJson(manifestPath, manifest);
        return { ok: true, sync: manifest.sync };
      }),
  },
  {
    url: "/project-sync/api/full-pull",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };

        // Find project scope to filter what gets written
        const ps = require("./project-setup");
        const scopeSet = await loadScopeSet();

        // Export live state
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        const livePack = normalizePack(await adapter.exportProject());

        // Write scoped objects to disk
        const { ensureProjectDirs, safeFileName: sfName, stripObjectNoise: stripNoise } = require("./project-io");
        ensureProjectDirs(projectRoot);

        const KINDS = VERSIONED_KINDS;
        const counts = {};
        for (const kind of KINDS) {
          const allObjects = livePack[kind] || [];
          // Filter by scope if available
          const objects = scopeSet
            ? allObjects.filter((obj) => scopeSet.has(`${kind}::${obj.name || obj.role}`))
            : allObjects;
          const objDir = path.join(projectRoot, "objects", kind);
          if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
          // Remove stale files
          for (const f of fs.readdirSync(objDir).filter((f) => f.endsWith(".json"))) {
            fs.unlinkSync(path.join(objDir, f));
          }
          for (const obj of objects) {
            writeCanonicalJson(path.join(objDir, sfName(obj.name || obj.role) + ".json"), stripNoise({ ...obj }, kind));
          }
          counts[kind] = objects.length;
        }

        // Plugin lock — filter by scope too
        const allPlugins = livePack.plugins || [];
        const plugins = scopeSet
          ? allPlugins.filter((p) => scopeSet.has(`plugins::${p.name}`))
          : allPlugins;
        if (plugins.length > 0) {
          writeCanonicalJson(path.join(projectRoot, "plugins.lock.json"), { plugins });
          counts.plugins = plugins.length;
        }

        // Update manifest — preserve name/slug/description, stamp sync
        const manifestPath = path.join(projectRoot, "saltcorn.project.json");
        const existing = readJsonIfExists(manifestPath) || {};
        const manifest = {
          ...existing,
          object_types: Object.keys(counts).filter((k) => counts[k] > 0),
        };
        stampSyncMeta(manifest, projectRoot);
        writeCanonicalJson(manifestPath, manifest);

        return { ok: true, counts, sync: manifest.sync };
      }),
  },
  {
    url: "/project-sync/api/pull-drift",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };

        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const scopeSet = await loadScopeSet();
        const diff = summarizeDiff(desired, actual, scopeSet);

        const { safeFileName: sfName, stripObjectNoise: stripNoise } = require("./project-io");
        const pulled = [];

        // Collect all names to pull from each diff section
        const pullTargets = []; // { kind, name }

        // Tables
        for (const item of (diff.tables?.tables?.orphaned || [])) pullTargets.push({ kind: "tables", name: item.name });
        for (const item of (diff.tables?.tables?.updated || [])) pullTargets.push({ kind: "tables", name: item.key });
        // Other kinds
        for (const [kind, kindDiff] of Object.entries(diff.kinds || {})) {
          for (const item of (kindDiff?.orphaned || [])) pullTargets.push({ kind, name: item.name });
          for (const item of (kindDiff?.updated || [])) pullTargets.push({ kind, name: item.key });
        }
        // Plugins
        for (const item of (diff.plugins?.orphaned || [])) pullTargets.push({ kind: "plugins", name: item.name });
        for (const item of (diff.plugins?.updated || [])) pullTargets.push({ kind: "plugins", name: item.key });

        if (!pullTargets.length) return { ok: true, pulled: [], message: "No drift to pull" };

        // Build lookup from actual pack
        for (const { kind, name } of pullTargets) {
          const collection = kind === "plugins" ? (actual.plugins || []) : (actual[kind] || []);
          const liveObj = collection.find((o) => (o.name || o.role) === name);
          if (!liveObj) continue;

          if (kind === "plugins") {
            // Update plugins.lock.json
            const lockPath = path.join(projectRoot, "plugins.lock.json");
            const lock = readJsonIfExists(lockPath, { plugins: [] });
            const idx = (lock.plugins || []).findIndex((p) => p.name === name);
            if (idx >= 0) lock.plugins[idx] = liveObj;
            else (lock.plugins = lock.plugins || []).push(liveObj);
            writeCanonicalJson(lockPath, lock);
          } else {
            const objDir = path.join(projectRoot, "objects", kind);
            if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
            writeCanonicalJson(path.join(objDir, sfName(name) + ".json"), stripNoise({ ...liveObj }, kind));
          }
          pulled.push(`${kind}/${name}`);
        }

        return { ok: true, pulled, count: pulled.length };
      }),
  },
  {
    url: "/project-sync/api/push-drift",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };

        const desired = loadProjectState(projectRoot);
        const actual = normalizePack(await adapter.exportProject());
        const scopeSet = await loadScopeSet();
        const diff = summarizeDiff(desired, actual, scopeSet);

        // Collect push targets: created (disk-only) + updated where direction is push
        const pushTargets = [];

        const fileStatus = (() => {
          try {
            const manifest = loadManifest(projectRoot);
            const sync = readSyncMeta(manifest);
            if (sync.last_sync_epoch) return computeFileSyncStatus(projectRoot, sync.last_sync_epoch);
          } catch { /* ok */ }
          return null;
        })();

        // Tables
        for (const item of (diff.tables?.tables?.created || [])) pushTargets.push({ kind: "tables", name: item.name });
        for (const item of (diff.tables?.tables?.updated || [])) {
          const safeKey = `tables::${safeFileName(item.key)}`;
          if (fileStatus && fileStatus.get(safeKey)?.modified_after_sync) pushTargets.push({ kind: "tables", name: item.key });
        }
        // Other kinds
        for (const [kind, kindDiff] of Object.entries(diff.kinds || {})) {
          for (const item of (kindDiff?.created || [])) pushTargets.push({ kind, name: item.name });
          for (const item of (kindDiff?.updated || [])) {
            const safeKey = `${kind}::${safeFileName(item.key)}`;
            if (fileStatus && fileStatus.get(safeKey)?.modified_after_sync) pushTargets.push({ kind, name: item.key });
          }
        }
        // Plugins
        for (const item of (diff.plugins?.created || [])) pushTargets.push({ kind: "plugins", name: item.name });
        for (const item of (diff.plugins?.updated || [])) {
          // Plugins: if disk has changes, push
          pushTargets.push({ kind: "plugins", name: item.key });
        }

        if (!pushTargets.length) {
          const dbg = {};
          for (const [k, v] of Object.entries(diff.kinds || {})) dbg[k] = { created: (v?.created || []).map(i => i.name), updated: (v?.updated || []).map(i => i.key), orphaned: (v?.orphaned || []).map(i => i.name) };
          return { ok: true, pushed: [], applied: [], skipped: [], message: "No drift to push", debug: dbg };
        }

        // Use the planner to generate ops for just these objects
        const intents = loadChangeIntents(projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        const fullPlan = planProject({ desired, actual, intents, env, backup: false });

        // Filter plan ops to only our push targets
        const filteredOps = (fullPlan.operations || []).filter((op) => {
          const opName = op.table || op.view || op.page || op.trigger || op.role || op.name;
          if (!opName) return false;
          for (const t of pushTargets) {
            if (opName === t.name) return true;
          }
          return false;
        });

        if (!filteredOps.length) {
          const desiredSummary = {};
          const actualSummary = {};
          for (const k of [...VERSIONED_KINDS, 'plugins']) {
            desiredSummary[k] = (desired[k] || []).length;
            actualSummary[k] = (actual[k] || []).length;
          }
          return { ok: true, pushed: pushTargets.map(t => t.kind + '/' + t.name), applied: [], skipped: [], message: "No matching plan ops",
            debug: { pushTargets: pushTargets.map(t => t.kind + '::' + t.name), totalPlanOps: (fullPlan.operations || []).length, planWarnings: (fullPlan.warnings || []).length, planBlocked: (fullPlan.blocked || []).length, desiredViews: (desired.views || []).length, actualViews: (actual.views || []).length, desiredTables: (desired.tables || []).length, actualTables: (actual.tables || []).length, desiredKeys: Object.keys(desired).join(','), actualKeys: Object.keys(actual).join(',') } };
        }

        // Apply via adapter
        let applyResult;
        try {
          applyResult = await adapter.applyPlan({ desired, plan: { ...fullPlan, operations: filteredOps } });
        } catch (applyErr) {
          return { ok: false, error: applyErr.message, pushed: pushTargets.map(t => t.kind + '/' + t.name) };
        }
        const pushed = pushTargets.map((t) => `${t.kind}/${t.name}`);
        const appliedNames = (applyResult.applied || []).map((op) => op.view || op.page || op.trigger || op.role || op.table || op.name || JSON.stringify(op.action));
        const skippedNames = (applyResult.skipped || []).map((s) => `${s.op?.action}: ${s.reason}`);
        return { ok: true, pushed, count: pushed.length, applied: appliedNames, skipped: skippedNames };
      }),
  },
  {
    url: "/project-sync/api/add-to-scope",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const { kind, name } = req.body || {};
        if (!kind || !name) return { ok: false, error: "kind and name required" };
        const ps = require("./project-setup");
        const projects = await ps.listProjects();
        if (!projects.length) return { ok: false, error: "No project exists. Create one first." };
        // Use the first (or only) project
        const projectId = projects[0].id;
        await ps.updateScopeEntry(projectId, kind, name, true);
        return { ok: true, project_id: projectId };
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
  // ─── Git API ──────────────────────────────────────────
  {
    url: "/project-sync/api/git/status",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        if (!gitOps.isGitRepo(projectRoot)) return { ok: false, error: "Not a git repository" };
        return gitOps.gitStatus(projectRoot);
      }),
  },
  {
    url: "/project-sync/api/git/add",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { paths } = req.body || {};
        const gitOps = require("./git-ops");
        return gitOps.gitAdd(projectRoot, paths);
      }),
  },
  {
    url: "/project-sync/api/git/reset",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        return gitOps.git(["reset", "HEAD"], projectRoot);
      }),
  },
  {
    url: "/project-sync/api/git/commit",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { message } = req.body || {};
        const gitOps = require("./git-ops");
        return gitOps.gitCommit(projectRoot, message);
      }),
  },
  {
    url: "/project-sync/api/git/push",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { remote, branch } = req.body || {};
        const gitOps = require("./git-ops");
        return gitOps.gitPush(projectRoot, remote, branch);
      }),
  },
  {
    url: "/project-sync/api/git/pull",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { remote, branch } = req.body || {};
        const gitOps = require("./git-ops");
        return gitOps.gitPull(projectRoot, remote, branch);
      }),
  },
  {
    url: "/project-sync/api/git/fetch",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        return gitOps.git(["fetch", "--all"], projectRoot, { timeout: 60_000 });
      }),
  },
  {
    url: "/project-sync/api/git/branches",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        return gitOps.gitBranches(projectRoot);
      }),
  },
  {
    url: "/project-sync/api/git/checkout",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { branch, force } = req.body || {};
        if (!branch) return { ok: false, error: "branch is required" };
        const gitOps = require("./git-ops");
        return gitOps.gitCheckout(projectRoot, branch, force);
      }),
  },
  {
    url: "/project-sync/api/git/log",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const count = parseInt(req.query?.count, 10) || 10;
        const gitOps = require("./git-ops");
        return gitOps.gitLog(projectRoot, count);
      }),
  },
  {
    url: "/project-sync/api/git/stash",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        return gitOps.gitStash(projectRoot);
      }),
  },
  {
    url: "/project-sync/api/git/stash-pop",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const gitOps = require("./git-ops");
        return gitOps.gitStashPop(projectRoot);
      }),
  },
  // ─── Settings UI ─────────────────────────────────────
  {
    url: "/project-sync/settings",
    method: "get",
    callback: async (req, res) => {
      if (!requirePageAuth(req, res)) return;
      if (!requireRootTenant(req, res)) return;
      try {
        const cfg = getPluginConfig();
        return sendPage(res, "Settings", renderSettingsPage({ cfg }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Settings", renderSettingsPage({ cfg: {}, error: err.message }), { noCache: true });
      }
    },
  },
  {
    url: "/project-sync/api/settings",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!requirePageAuth(req, res)) return;
      if (!requireRootTenant(req, res)) return;
      return apiLocal(req, res, async () => {
        const { project_root } = req.body || {};
        try {
          const stateMod = optionalRequire(["@saltcorn/data/db/state", "@saltcorn/data/dist/db/state"]);
          if (!stateMod) return { ok: false, error: "State module not available" };
          const rootState = stateMod.getRootState();
          if (!rootState) return { ok: false, error: "Root state not available" };
          const cfg = rootState.plugin_cfgs["saltcorn-project-sync"] || {};
          cfg.project_root = project_root || "";
          if (rootState.processSend) {
            rootState.processSend({
              provide_plugin_config: "saltcorn-project-sync",
              configuration: cfg,
            });
          }
          rootState.plugin_cfgs["saltcorn-project-sync"] = cfg;
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      });
    },
  },
  // ─── Git UI ───────────────────────────────────────────
  {
    url: "/project-sync/git",
    method: "get",
    callback: async (_req, res) => {
      const projectRoot = configuredProjectRoot();
      if (!projectRoot) return sendPage(res, "Git", renderGitPage({ projectRoot }), { noCache: true });
      try {
        const gitOps = require("./git-ops");
        if (!gitOps.isGitRepo(projectRoot)) return sendPage(res, "Git", renderGitPage({ projectRoot, error: "Not a git repository" }), { noCache: true });
        const status = gitOps.gitStatus(projectRoot);
        const branches = gitOps.gitBranches(projectRoot);
        const log = gitOps.gitLog(projectRoot, 15);
        const remoteUrl = gitOps.gitRemoteUrl(projectRoot);
        let branchMap = {};
        try {
          const bt = require("./branch-tenant");
          const bm = await bt.loadBranchMap(projectRoot);
          branchMap = bm.branches || {};
        } catch { /* no branch map file yet */ }
        return sendPage(res, "Git", renderGitPage({ projectRoot, status, branches, log, remoteUrl, branchMap }), { noCache: true });
      } catch (err) {
        return sendPage(res, "Git", renderGitPage({ projectRoot, error: err.message }), { noCache: true });
      }
    },
  },
  // ─── Branch API ──────────────────────────────────────
  // Branch guard — lightweight endpoint for the global toast
  // No auth required so it works on any page (including public ones)
  {
    url: "/project-sync/api/branch-guard",
    method: "get",
    callback: async (req, res) => {
      try {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return sendJson(res, { ok: true });
        const bt = require("./branch-tenant");
        const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        if (!dbMod) return sendJson(res, { ok: true });
        const currentTenant = dbMod.getTenantSchema();
        const guard = bt.guardBranchTenant(projectRoot, currentTenant);
        if (guard.ok) return sendJson(res, { ok: true });
        // Build URL to the correct tenant
        const host = (req && req.headers && req.headers.host) || 'localhost:3000';
        const parts = host.split(':');
        const baseHost = parts[0].split('.').pop(); // e.g. 'localhost'
        const port = parts[1] ? ':' + parts[1] : '';
        const targetUrl = guard.expected === 'public'
          ? `http://${baseHost}${port}`
          : `http://${guard.expected}.${baseHost}${port}`;
        return sendJson(res, {
          ok: false,
          branch: guard.branch,
          expected: guard.expected,
          actual: guard.actual,
          target_url: targetUrl,
          suggested_branch: guard.suggested_branch || null,
        });
      } catch {
        return sendJson(res, { ok: true }); // fail open
      }
    },
  },
  {
    url: "/project-sync/api/branches",
    method: "get",
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const bt = require("./branch-tenant");
        return bt.listBranchTenants(projectRoot);
      }),
  },
  {
    url: "/project-sync/api/branches/create",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { branch, source } = req.body || {};
        if (!branch) return { ok: false, error: "branch name is required" };
        const bt = require("./branch-tenant");
        try {
          const result = await bt.createBranchTenant({
            branchName: branch,
            projectRoot,
            sourceSchema: source || undefined,
          });
          return result;
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
  {
    url: "/project-sync/api/branches/switch",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { branch } = req.body || {};
        if (!branch) return { ok: false, error: "branch name is required" };
        const bt = require("./branch-tenant");
        try {
          return await bt.switchBranch({ branchName: branch, projectRoot });
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },
  {
    url: "/project-sync/api/branches/:name",
    method: "delete",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" };
        const { force } = req.body || {};
        const bt = require("./branch-tenant");
        try {
          return await bt.deleteBranchTenant({
            branchName: req.params.name,
            projectRoot,
            force: force || false,
          });
        } catch (err) {
          return { ok: false, error: err.message };
        }
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
