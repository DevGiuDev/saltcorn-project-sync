const {
  alert, card, envBadge, escapeHtml, filterableTable,
  pageShell, statusBadge,
} = require("../../ui");
const { approvalMatrix } = require("../helpers");

function renderApprovals({ approvals = [], projectRoot = "", error = null } = {}) {
  if (!projectRoot) {
    return pageShell("Approvals", "/project-sync/approvals",
      card({ title: "Approval Controls", icon: "fa-shield-alt", body:
        alert({ color: "info", body: 'Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable approval previews.' })
      })
    );
  }
  if (error) {
    return pageShell("Approvals", "/project-sync/approvals",
      card({ title: "Approval Controls", icon: "fa-shield-alt", body: alert({ color: "danger", icon: "fa-exclamation-triangle", body: escapeHtml(error) }) })
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

  const cliCmds = approvals.map((row) => `<div class="mb-1">
    ${envBadge(row.env)}
    <code class="ms-2 small">saltcorn-project-sync apply --adapter rest --env ${row.env}${row.destructive ? " --allow-destructive" : ""}</code>
  </div>`).join("");

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
  ${alert({
    color: "secondary",
    classExtra: "mb-4",
    body: "These controls are intentionally read-only. REST apply remains guarded by token and environment policy.",
  })}
  ${envTable}
  <h6 class="mt-4 mb-2">CLI Commands</h6>
  ${cliCmds}
  ${blockerDetails ? `<h6 class="mt-4 mb-2">Blocker Details</h6>${blockerDetails}` : '<div class="text-muted mt-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers for the displayed plans.</div>'}`,
    })
  );
}

module.exports = { renderApprovals };
