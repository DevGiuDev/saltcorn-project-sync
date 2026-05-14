/**
 * Minimal viewtemplate that redirects to the plugin's route-based UI.
 * Create a View of type "ProjectSyncConsole" and add it to a menu item
 * to get a link in the Saltcorn admin navigation.
 */
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
  return '<script>window.location.href = "/project-sync";</script>' +
    '<div class="text-center py-5"><i class="fas fa-spinner fa-spin me-2"></i>Redirecting to Project Sync…</div>';
}

module.exports = {
  name: "ProjectSyncConsole",
  display_name: "Project Sync Console",
  description: "Entry point for Saltcorn Project Sync. Redirects to the full UI.",
  tableless: true,
  configuration_workflow,
  run,
};
