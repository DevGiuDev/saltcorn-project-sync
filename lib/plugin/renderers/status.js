const {
  alert, card, escapeHtml, keyValueGrid,
  pageShell, simpleTable, statCard,
} = require("../../ui");
const { objectCounts } = require("../helpers");

function renderStatus({ info = {}, exported = null, projectRoot = "", error = null } = {}) {
  if (error) {
    return pageShell("Status", "/project-sync/status",
      card({ title: "Project Status", icon: "fa-heartbeat", body: alert({ color: "danger", icon: "fa-exclamation-triangle", body: escapeHtml(error) }) })
    );
  }

  const adapter = escapeHtml(info.adapter || "native");
  const version = escapeHtml(info.saltcorn_version || "unknown");
  const rootDisplay = projectRoot ? `<code>${escapeHtml(projectRoot)}</code>` : '<span class="text-muted">not configured</span>';

  const counts = exported ? objectCounts(exported) : {};
  const statCards = exported
    ? `<div class="row mb-4">
      ${statCard("Tables", counts.tables || 0, "fa-table", "primary")}
      ${statCard("Views", counts.views || 0, "fa-eye", "info")}
      ${statCard("Pages", counts.pages || 0, "fa-file-alt", "success")}
      ${statCard("Triggers", counts.triggers || 0, "fa-bolt", "warning")}
    </div>`
    : '<div class="text-muted">Live export unavailable.</div>';

  const capabilities = info.capabilities;
  const capRows = capabilities && capabilities.resources
    ? Object.entries(capabilities.resources).map(([name, cap]) => ([
        { content: `<code>${escapeHtml(name)}</code>` },
        { content: cap.export ? '<i class="fas fa-check text-success"></i>' : '<span class="text-muted">—</span>' },
        { content: cap.apply ? '<i class="fas fa-check text-success"></i>' : '<span class="text-muted">—</span>' },
        { content: cap.destructive ? '<i class="fas fa-exclamation-triangle text-warning"></i>' : '<span class="text-muted">—</span>' },
      ]))
    : [];

  const capTable = capRows.length
    ? simpleTable([
        { label: "Resource" },
        { label: "Export" },
        { label: "Apply" },
        { label: "Destructive" },
      ], capRows)
    : '<div class="text-muted">No capability report available.</div>';

  return pageShell("Status", "/project-sync/status",
    card({
      title: "Project Status",
      subtitle: "Adapter info and live object counts",
      icon: "fa-heartbeat",
      iconColor: "danger",
      body: `
  ${keyValueGrid([
    { label: "Adapter", value: `<code>${adapter}</code>` },
    { label: "Saltcorn version", value: `<code>${version}</code>` },
    { label: "Project root", value: rootDisplay },
  ])}
  <h6 class="mb-3"><i class="fas fa-cubes me-1"></i> Live Object Counts</h6>
  ${statCards}
  <h6 class="mb-3"><i class="fas fa-puzzle-piece me-1"></i> Adapter Capabilities</h6>
  ${capTable}`,
    })
  );
}

module.exports = { renderStatus };
