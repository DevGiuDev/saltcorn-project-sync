const { escapeHtml, card, filterableTable, pageShell, badge, statusBadge, emptyState } = require("../../ui");
const { readJsonIfExists } = require("../../project-io");
const path = require("node:path");

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
    env: (() => {
      const colors = { local: "secondary", dev: "info", staging: "warning", prod: "danger", production: "danger" };
      return badge(row.env || "", colors[row.env] || "secondary");
    })(),
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

module.exports = { deploymentsTable };
