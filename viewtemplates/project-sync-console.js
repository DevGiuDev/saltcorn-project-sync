function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function configuration_workflow() {
  try {
    const Workflow = require("@saltcorn/data/models/workflow");
    return new Workflow({ steps: [] });
  } catch (_e) {
    // Test/runtime fallback when Saltcorn modules are unavailable.
    return { steps: [] };
  }
}

async function run(_tableId, _viewname, _configuration, _state, { req } = {}) {
  if (!req || !req.user || req.user.role_id !== 1) {
    return '<div class="alert alert-danger">Project Sync Console is available to administrators only.</div>';
  }

  let projects = [];
  try {
    const ps = require("../lib/project-setup");
    projects = await ps.listProjects();
  } catch (err) {
    return `<div class="alert alert-warning">Unable to load Project Sync projects: ${escapeHtml(err.message)}</div>`;
  }

  const rows = projects.length
    ? projects
        .map(
          (p) => `<tr>
<td><a href="/project-sync/projects/${p.id}">${escapeHtml(p.name)}</a></td>
<td><code>${escapeHtml(p.slug || "")}</code></td>
<td>${escapeHtml(p.description || "")}</td>
<td>${escapeHtml(p.root_path || "—")}</td>
</tr>`
        )
        .join("")
    : '<tr><td colspan="4">No projects yet. <a href="/project-sync/projects/new">Create one</a>.</td></tr>';

  return `<div class="card mt-0 card-max-full-screen">
  <div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem;">
    <div>
      <h5 class="mb-0"><i class="fas fa-code-branch me-2"></i>Project Sync Console</h5>
      <div class="small text-muted">Manage project scopes and exports from a view-backed entry point.</div>
    </div>
    <div class="btn-group btn-group-sm">
      <a class="btn btn-primary" href="/project-sync/projects/new"><i class="fas fa-plus me-1"></i>New project</a>
      <a class="btn btn-outline-secondary" href="/project-sync/projects"><i class="fas fa-external-link-alt me-1"></i>Open full UI</a>
    </div>
  </div>
  <div class="card-body">
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle mb-0">
        <thead><tr><th>Name</th><th>Slug</th><th>Description</th><th>Root path</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</div>`;
}

module.exports = {
  name: "ProjectSyncConsole",
  display_name: "Project Sync Console",
  description: "View template entry point for Saltcorn Project Sync.",
  tableless: true,
  configuration_workflow,
  run,
};
