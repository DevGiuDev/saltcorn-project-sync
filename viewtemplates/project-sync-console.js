const { escapeHtml, renderNav, card, statCard } = require("../lib/ui");

function configuration_workflow() {
  try {
    const Workflow = require("@saltcorn/data/models/workflow");
    return new Workflow({ steps: [] });
  } catch (_e) {
    return { steps: [] };
  }
}

async function run(_tableId, _viewname, _configuration, _state, { req } = {}) {
  if (!req || !req.user || req.user.role_id !== 1) {
    return '<div class="alert alert-danger"><i class="fas fa-lock me-1"></i>Project Sync Console is available to administrators only.</div>';
  }

  let projects = [];
  try {
    const ps = require("../lib/project-setup");
    projects = await ps.listProjects();
  } catch (err) {
    return card({
      title: "Project Sync Console",
      icon: "fa-code-branch",
      body: `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-1"></i>Unable to load projects: ${escapeHtml(err.message)}</div>`,
    });
  }

  // Summary stats
  const totalProjects = projects.length;
  let totalScoped = 0, totalObjects = 0;
  for (const p of projects) {
    try {
      const ps = require("../lib/project-setup");
      const scope = await ps.getScope(p.id);
      totalObjects += scope.length;
      totalScoped += scope.filter((s) => s.included).length;
    } catch (_e) { /* best effort */ }
  }

  const statsRow = `<div class="row mb-4">
    ${statCard("Projects", totalProjects, "fa-folder-open", "primary")}
    ${statCard("Included", totalScoped, "fa-check-circle", "success")}
    ${statCard("Total objects", totalObjects, "fa-cubes", "info")}
    ${statCard("Excluded", totalObjects - totalScoped, "fa-times-circle", totalObjects - totalScoped ? "warning" : "success")}
  </div>`;

  // Project cards
  const projectCards = projects.length
    ? projects.map((p) => `
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
            ${p.description ? `<p class="small text-muted mb-0">${escapeHtml(p.description)}</p>` : ""}
          </div>
        </a>
      </div>`).join("")
    : `<div class="col-12">${emptyState("fa-folder-open", "No projects yet. Create one to start managing your Saltcorn objects.", "/project-sync/projects/new", "Create project")}</div>`;

  return card({
    title: "Project Sync Console",
    subtitle: "Manage project scopes and exports from a view-backed entry point",
    icon: "fa-code-branch",
    iconColor: "primary",
    headerRight: `
      <div class="btn-group btn-group-sm">
        <a class="btn btn-primary" href="/project-sync/projects/new"><i class="fas fa-plus me-1"></i>New project</a>
        <a class="btn btn-outline-secondary" href="/project-sync/projects"><i class="fas fa-external-link-alt me-1"></i>Full UI</a>
        <a class="btn btn-outline-dark" href="/project-sync/settings" title="Plugin settings"><i class="fas fa-cog"></i></a>
      </div>`,
    body: `${statsRow}<div class="row">${projectCards}</div>`,
  });
}

function emptyState(icon, message, actionHref, actionLabel) {
  const actionHtml = actionHref
    ? `<a href="${actionHref}" class="btn btn-primary btn-sm mt-2"><i class="fas fa-plus me-1"></i>${escapeHtml(actionLabel || "Create")}</a>`
    : "";
  return `<div class="text-center text-muted py-5">
    <i class="fas ${icon} fa-3x mb-3 opacity-25"></i>
    <p>${message}</p>
    ${actionHtml}
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
