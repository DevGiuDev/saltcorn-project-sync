const { escapeHtml, card, pageShell } = require("../../ui");
const { loadScript } = require("./_shared");

function renderSettingsPage({ cfg = {}, error = null } = {}) {
  const currentRoot = cfg.project_root || process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";

  const errorHtml = error
    ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
    : '';

  let rootStatus = '';
  if (currentRoot) {
    try {
      const fs = require('node:fs');
      if (fs.existsSync(currentRoot)) {
        rootStatus = '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Path exists</span>';
      } else {
        rootStatus = '<span class="badge bg-danger-lt text-danger"><i class="fas fa-times me-1"></i>Path not found</span>';
      }
    } catch { rootStatus = '<span class="badge bg-warning-lt text-warning"><i class="fas fa-question me-1"></i>Cannot check</span>'; }
  } else {
    rootStatus = '<span class="badge bg-secondary-lt">Not configured</span>';
  }

  const settingsScript = `<script>\n${loadScript("settings.js")}\n<\/script>`;

  return pageShell("Settings", "/project-sync/settings",
    card({
      title: "Plugin Settings",
      subtitle: "Saltcorn Project Sync configuration",
      icon: "fa-cog",
      iconColor: "dark",
      headerRight: '<a href="/project-sync" class="btn btn-outline-secondary btn-sm"><i class="fas fa-arrow-left me-1"></i>Back</a>',
      body: `
        ${errorHtml}
        <h6 class="mb-3"><i class="fas fa-folder-open me-1"></i>Project Root</h6>
        <div class="mb-3">
          <label class="form-label small fw-bold">Filesystem path to Git repository</label>
          <div class="input-group input-group-sm" style="max-width:500px">
            <input type="text" id="setting-project-root" class="form-control" value="${escapeHtml(currentRoot)}" placeholder="/path/to/project" />
            <button class="btn btn-outline-secondary" id="btn-browse-root" title="Verify path"><i class="fas fa-search"></i></button>
          </div>
          <div class="form-text">Where project JSON files are stored. Overrides <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> env var.</div>
          <div id="root-status" class="mt-1">${rootStatus}</div>
        </div>
        <hr />
        <div class="d-flex align-items-center" style="gap:.5rem">
          <button class="btn btn-primary" id="btn-save-settings"><i class="fas fa-save me-1"></i>Save settings</button>
          <span id="save-status" class="small text-muted"></span>
        </div>
      ` + settingsScript,
    })
  );
}

module.exports = { renderSettingsPage };
