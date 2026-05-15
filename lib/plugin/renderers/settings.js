const {
  escapeHtml, card, pageShell, alert, badge,
  button, formField, textInput, inputGroup,
} = require("../../ui");
const { loadScript } = require("./_shared");

function renderSettingsPage({ cfg = {}, error = null } = {}) {
  const currentRoot = cfg.project_root || process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";

  const errorHtml = error
    ? alert({ color: "danger", icon: "fa-exclamation-triangle", body: escapeHtml(error) })
    : '';

  let rootStatus = '';
  if (currentRoot) {
    try {
        const fs = require('node:fs');
        if (fs.existsSync(currentRoot)) {
          rootStatus = badge("Path exists", "success", { soft: true, icon: "fa-check" });
        } else {
          rootStatus = badge("Path not found", "danger", { soft: true, icon: "fa-times" });
        }
      } catch { rootStatus = badge("Cannot check", "warning", { soft: true, icon: "fa-question" }); }
    } else {
    rootStatus = badge("Not configured", "secondary", { soft: true });
  }

  const settingsScript = `<script>\n${loadScript("settings.js")}\n<\/script>`;

  return pageShell("Settings", "/project-sync/settings",
    card({
      title: "Plugin Settings",
      subtitle: "Saltcorn Project Sync configuration",
      icon: "fa-cog",
      iconColor: "dark",
      headerRight: button({ href: "/project-sync", color: "secondary", outline: true, size: "sm", icon: "fa-arrow-left", label: "Back" }),
      body: `
        ${errorHtml}
        <h6 class="mb-3"><i class="fas fa-folder-open me-1"></i>Project Root</h6>
        ${formField({
          label: "Filesystem path to Git repository",
          labelClass: "form-label small fw-bold",
          input: inputGroup([
            textInput({ id: "setting-project-root", value: currentRoot, placeholder: "/path/to/project" }),
            button({ id: "btn-browse-root", color: "secondary", outline: true, icon: "fa-search", title: "Verify path" }),
          ], { size: "sm", style: "max-width:500px" }),
          helpText: 'Where project JSON files are stored. Overrides <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> env var.',
        })}
        <div id="root-status" class="mt-1">${rootStatus}</div>
        <hr />
        <div class="d-flex align-items-center" style="gap:.5rem">
          ${button({ id: "btn-save-settings", color: "primary", icon: "fa-save", label: "Save settings" })}
          <span id="save-status" class="small text-muted"></span>
        </div>
      ` + settingsScript,
    })
  );
}

module.exports = { renderSettingsPage };
