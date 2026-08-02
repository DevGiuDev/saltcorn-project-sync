const path = require("node:path");
const { readJsonIfExists } = require("../../project-io");
const { renderFilterableTable, escapeHtml, icon, globalNav } = require("./_shared");

function statusBadge(status) {
  if (["success", "applied", "applied-live", "verified", "restored-live"].includes(status)) {
    return `<span class="badge bg-success">${escapeHtml(status)}</span>`;
  }
  if (status === "failed") return '<span class="badge bg-danger">Failed</span>';
  if (["applying", "planned"].includes(status)) return `<span class="badge bg-info">${escapeHtml(status)}</span>`;
  return `<span class="badge bg-secondary">${escapeHtml(status || "unknown")}</span>`;
}

function envBadge(env) {
  const colors = { local: "secondary", dev: "info", test: "warning", staging: "warning", prod: "danger", production: "danger" };
  return `<span class="badge bg-${colors[env] || "secondary"}">${escapeHtml(env || "")}</span>`;
}

function kindBadge(kind) {
  return `<span class="badge bg-${kind === "rollback" ? "warning text-dark" : "secondary"}">${escapeHtml(kind || "deployment")}</span>`;
}

function convergenceBadge(value) {
  if (!value) return '<span class="text-muted">—</span>';
  if (value.ok === true) return '<span class="badge bg-success">Converged</span>';
  return `<span class="badge bg-danger">Drift ${Number(value.drift_count || 0)}</span>`;
}

function backupText(value) {
  if (!value) return '<span class="text-muted">—</span>';
  const id = escapeHtml(value.id || "backup");
  const hash = value.sha256 ? `<br><code title="${escapeHtml(value.sha256)}">${escapeHtml(value.sha256.slice(0, 10))}…</code>` : "";
  return `<span class="small">${id}${hash}</span>`;
}

function resolveRows(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.records)) return input.records;
  const projectRoot = typeof input === "string" ? input : process.cwd();
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  return readJsonIfExists(file, []);
}

function deploymentsTable(input = process.cwd(), options = {}) {
  const rows = resolveRows(input);
  const source = options.source || (Array.isArray(input) ? "target" : "local");
  const error = options.error || "";
  const sourceNotice = source === "target"
    ? '<div class="alert alert-info py-2"><i class="fas fa-database me-1"></i>Authoritative target-side deployment ledger.</div>'
    : '<div class="alert alert-warning py-2"><i class="fas fa-file me-1"></i>Showing the local deployment cache because the target ledger is unavailable.</div>';
  const errorNotice = error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : "";

  if (!rows.length) {
    return globalNav("deployments") +
      '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-rocket me-2"></i>Deployments</h5></div><div class="card-body">' +
      sourceNotice + errorNotice +
      `<div class="text-center text-muted py-5"><div class="mb-3">${icon("fa-rocket", " fa-3x opacity-25")}</div><p>No deployment records found.</p></div>` +
      '</div></div>';
  }

  const table = renderFilterableTable("deployments-table", [
    { key: (row) => `<code>${escapeHtml(row.deployment_id || row.id || "")}</code>`, label: "Deployment" },
    { key: (row) => row.recorded_at ? escapeHtml(new Date(row.recorded_at).toLocaleString()) : "", label: "Date" },
    { key: (row) => escapeHtml(row.project || ""), label: "Project" },
    { key: (row) => kindBadge(row.kind), label: "Kind" },
    { key: (row) => envBadge(row.environment || row.env), label: "Env" },
    { key: (row) => statusBadge(row.status), label: "Status" },
    { key: (row) => `<code>${escapeHtml((row.commit_sha || row.commit || "").substring(0, 8))}</code>`, label: "Commit" },
    { key: (row) => String(row.operation_count ?? row.operations ?? ""), label: "Ops" },
    { key: (row) => String(row.warning_count ?? row.warnings ?? ""), label: "Warns" },
    { key: (row) => backupText(row.backup), label: "Backup" },
    { key: (row) => convergenceBadge(row.convergence), label: "Verify" },
    { key: (row) => escapeHtml(row.rollback_of || row.restored_from || ""), label: "Rollback" },
    { key: (row) => row.error ? `<span class="text-danger small">${escapeHtml(row.error)}</span>` : "", label: "Error" },
  ], rows, { hover: true, class: "table-bordered" });

  return globalNav("deployments") +
    '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-rocket me-2"></i>Deployment History</h5></div><div class="card-body">' +
    sourceNotice + errorNotice + table +
    '</div></div>';
}

module.exports = { deploymentsTable };
