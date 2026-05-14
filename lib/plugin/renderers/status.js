const { escapeHtml, card, statCard, pageShell } = require("../../ui");
const { objectCounts } = require("../helpers");

function renderStatus({ info = {}, exported = null, projectRoot = "", error = null } = {}) {
  if (error) {
    return pageShell("Status", "/project-sync/status",
      card({ title: "Project Status", icon: "fa-heartbeat", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
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

module.exports = { renderStatus };
