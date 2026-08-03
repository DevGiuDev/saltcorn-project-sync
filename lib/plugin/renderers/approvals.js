const { renderFilterableTable, escapeHtml, icon, globalNav, projectNav } = require("./_shared");

function envBadge(env) {
  const colors = { local: "secondary", dev: "info", staging: "warning", prod: "danger", production: "danger" };
  return `<span class="badge bg-${colors[env] || "secondary"}">${escapeHtml(env || "")}</span>`;
}

function readyBadge(ok) {
  return ok
    ? '<span class="badge bg-success">Ready</span>'
    : '<span class="badge bg-danger">Blocked</span>';
}

function renderApprovals({ approvals = [], projectRoot = "", projectId = "", uiMode = "full", error = null } = {}) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "approvals", mode: uiMode });
  const missingRootError = error === "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" || error === "Project has no root_path";

  if (!projectRoot) {
    const msg = error && !missingRootError
      ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      : `<div class="alert alert-info">${projectId
          ? 'This project has no <code>root_path</code> yet. Open the project and set the folder first, then come back to Approval Controls.'
          : 'Choose a project first. Approval Controls now live with a project because they need a selected Git root.'
        }</div>`;
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-shield-alt me-2"></i>Approval Controls</h5></div><div class="card-body">' + projectTabs + msg + '</div></div>';
  }

  if (error) {
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-shield-alt me-2"></i>Approval Controls</h5></div><div class="card-body">' + projectTabs + `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` + '</div></div>';
  }

  const table = renderFilterableTable("approvals-table", [
    { key: (row) => envBadge(row.env), label: "Environment" },
    { key: (row) => String(row.operations ?? ""), label: "Ops" },
    { key: (row) => row.warnings ? `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>${row.warnings}</span>` : '<span class="text-muted">0</span>', label: "Warnings" },
    { key: (row) => row.blocked ? `<span class="text-danger"><i class="fas fa-ban me-1"></i>${row.blocked}</span>` : '<span class="text-muted">0</span>', label: "Blocked" },
    { key: (row) => row.destructive ? `<span class="text-warning"><i class="fas fa-exclamation-triangle me-1"></i>${row.destructive}</span>` : '<span class="text-muted">0</span>', label: "Destructive" },
    { key: (row) => row.backup_required ? '<span class="text-warning"><i class="fas fa-database me-1"></i>Yes</span>' : '<span class="text-muted">No</span>', label: "Backup" },
    { key: (row) => readyBadge(row.can_apply), label: "Status" },
  ], approvals, { hover: true, class: "table-bordered" });

  const cli = approvals.map((row) => `<div class="mb-1">${envBadge(row.env)} <code class="ms-2 small">saltcorn-project-sync apply --adapter rest --env ${escapeHtml(row.env)}${row.destructive ? ' --allow-destructive' : ''}</code></div>`).join("");
  const blockers = approvals.filter((row) => row.blocked).map((row) =>
    `<div class="mb-3"><h6>${envBadge(row.env)} Blockers</h6><ul class="mb-0">${(row.plan.blocked || []).map((item) => `<li><i class="fas fa-times-circle text-danger me-1"></i>${escapeHtml(item.reason || JSON.stringify(item))}</li>`).join("")}</ul></div>`
  ).join("");

  return nav +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header"><h5 class="mb-0"><i class="fas fa-shield-alt me-2"></i>Approval Controls</h5><div class="small text-muted mt-1">Read-only previews — run deployments from CLI or CI</div></div>' +
      '<div class="card-body">' +
        projectTabs +
        '<div class="alert alert-secondary mb-4">These controls are intentionally read-only. REST apply remains guarded by token and environment policy.</div>' +
        table +
        `<h6 class="mt-4 mb-2">${icon("fa-terminal", " me-1")}CLI Commands</h6>` + cli +
        (blockers ? `<h6 class="mt-4 mb-2">Blocker Details</h6>${blockers}` : '<div class="text-muted mt-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers for the displayed plans.</div>') +
      '</div>' +
    '</div>';
}

module.exports = { renderApprovals };
