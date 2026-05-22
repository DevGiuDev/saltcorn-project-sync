const path = require("node:path");
const { readJsonIfExists } = require("../../project-io");
const { renderFilterableTable, escapeHtml, icon, globalNav } = require("./_shared");

function statusBadge(status) {
  if (status === "success") return '<span class="badge bg-success">Success</span>';
  if (status === "failed") return '<span class="badge bg-danger">Failed</span>';
  return `<span class="badge bg-secondary">${escapeHtml(status || "unknown")}</span>`;
}

function envBadge(env) {
  const colors = { local: "secondary", dev: "info", staging: "warning", prod: "danger", production: "danger" };
  return `<span class="badge bg-${colors[env] || "secondary"}">${escapeHtml(env || "")}</span>`;
}

function kindBadge(kind) {
  return `<span class="badge bg-${kind === "rollback" ? "warning text-dark" : "secondary"}">${escapeHtml(kind || "deployment")}</span>`;
}

function deploymentsTable(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  const rows = readJsonIfExists(file, []);
  if (!rows.length) {
    return globalNav("deployments") +
      '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-rocket me-2"></i>Deployments</h5></div><div class="card-body text-center text-muted py-5">' +
      `<div class="mb-3">${icon("fa-rocket", " fa-3x opacity-25")}</div><p>No deployment records found.</p>` +
      '</div></div>';
  }

  const table = renderFilterableTable("deployments-table", [
    { key: (row) => row.recorded_at ? new Date(row.recorded_at).toLocaleDateString() : "", label: "Date" },
    { key: (row) => kindBadge(row.kind), label: "Kind" },
    { key: (row) => envBadge(row.env), label: "Env" },
    { key: (row) => statusBadge(row.status), label: "Status" },
    { key: (row) => `<code>${escapeHtml((row.commit || "").substring(0, 8))}</code>`, label: "Commit" },
    { key: (row) => String(row.operations ?? ""), label: "Ops" },
    { key: (row) => String(row.warnings ?? ""), label: "Warns" },
    { key: (row) => escapeHtml(row.rollback_of || row.restored_from || ""), label: "Rollback" },
  ], rows, { hover: true, class: "table-bordered" });

  return globalNav("deployments") +
    '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-rocket me-2"></i>Deployment History</h5></div><div class="card-body">' +
    table +
    '</div></div>';
}

module.exports = { deploymentsTable };
