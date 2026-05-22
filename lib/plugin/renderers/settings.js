const fs = require("node:fs");
const path = require("node:path");
const {
  tags, renderFilterableTable, escapeHtml, icon, globalNav, projectNav, loadScript,
} = require("./_shared");

const { div, h5, p, code } = tags;

function healthChecks(project = {}) {
  const root = project.root_path || "";
  const logDir = path.join(process.cwd(), ".saltcorn-project-sync");
  let gitRepo = false;
  try {
    if (root) {
      const gitOps = require("../../git-ops");
      gitRepo = !!gitOps.isGitRepo(root);
    }
  } catch {
    gitRepo = false;
  }
  return [
    {
      check: "Project root configured",
      detail: root ? code(escapeHtml(root)) : '<span class="text-muted">Not set</span>',
      status: !!root ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-secondary">Missing</span>',
    },
    {
      check: "Project root exists",
      detail: root ? code(escapeHtml(root)) : '<span class="text-muted">No path to check</span>',
      status: root && fs.existsSync(root) ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-warning text-dark">Attention</span>',
    },
    {
      check: "Git repository detected",
      detail: root
        ? (gitRepo ? '<span class="text-success">Repository found</span>' : '<span class="text-muted">No .git directory detected</span>')
        : '<span class="text-muted">No path to check</span>',
      status: root && gitRepo ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-warning text-dark">Attention</span>',
    },
    {
      check: "Deployment log path",
      detail: code(escapeHtml(logDir)),
      status: fs.existsSync(logDir) ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-warning text-dark">Attention</span>',
    },
  ];
}

function renderSettingsPage({ project = null, error = null } = {}) {
  if (!project || !project.id) {
    return globalNav("projects") +
      '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-cog me-2"></i>Project settings</h5></div><div class="card-body">' +
      (error ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` : "") +
      '<div class="alert alert-info mb-0"><i class="fas fa-info-circle me-1"></i>Choose a project first to edit its settings and health checks. <a href="/project-sync/projects" class="btn btn-sm btn-primary ms-3">Open projects</a></div>' +
      '</div></div>';
  }

  const root = project.root_path || "";
  const rootStatus = !root
    ? '<span class="badge bg-secondary">Not configured</span>'
    : fs.existsSync(root)
      ? '<span class="badge bg-success">Path exists</span>'
      : '<span class="badge bg-danger">Path not found</span>';

  const healthTable = renderFilterableTable("project-health-checks", [
    { key: (row) => row.check, label: "Check" },
    { key: (row) => row.detail, label: "Detail" },
    { key: (row) => row.status, label: "Status" },
  ], healthChecks(project), { hover: false, class: "table-bordered" });

  const script = `<script>window.SCPS_SETTINGS_PROJECT_ID = ${JSON.stringify(project.id)};<\/script><script>\n${loadScript("settings.js")}\n<\/script>`;

  return globalNav("projects") +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem">' +
        `<div><h5 class="mb-0">${icon("fa-cog", " me-2")}${escapeHtml(project.name)} settings</h5><div class="small text-muted mt-1">Project-specific settings and health</div></div>` +
        `<a href="/project-sync/projects/${encodeURIComponent(project.id)}" class="btn btn-sm btn-outline-secondary"><i class="fas fa-arrow-left me-1"></i>Back to scope</a>` +
      '</div>' +
      '<div class="card-body">' +
        projectNav({ projectId: project.id, active: "settings" }) +
        (error ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` : "") +
        '<form id="project-settings-form">' +
          '<div class="mb-3"><label class="form-label">Name</label><input id="project-setting-name" class="form-control" value="' + escapeHtml(project.name || "") + '" required /></div>' +
          '<div class="mb-3"><label class="form-label">Slug</label><input id="project-setting-slug" class="form-control" value="' + escapeHtml(project.slug || "") + '" /></div>' +
          '<div class="mb-3"><label class="form-label">Description</label><textarea id="project-setting-description" class="form-control" rows="2">' + escapeHtml(project.description || "") + '</textarea></div>' +
          '<div class="mb-3"><label class="form-label">Minimum Saltcorn version</label><input id="project-setting-min-version" class="form-control" value="' + escapeHtml(project.min_version || "1.6.0") + '" /></div>' +
          '<div class="mb-3"><label class="form-label">Project root path</label><input id="project-setting-root-path" class="form-control" value="' + escapeHtml(root) + '" placeholder="/path/to/project" /><div class="form-text">Used for Git, live diff, plan, approvals and write-to-disk. <span class="ms-2">' + rootStatus + '</span></div></div>' +
          '<div class="d-flex align-items-center" style="gap:.5rem"><button type="submit" id="btn-save-project-settings" class="btn btn-primary"><i class="fas fa-save me-1"></i>Save settings</button><span id="save-status" class="small text-muted"></span></div>' +
        '</form>' +
        '<hr class="my-4" />' +
        `<h6 class="mb-3">${icon("fa-stethoscope", " me-1")}Health</h6>` +
        healthTable +
        script +
      '</div>' +
    '</div>';
}

module.exports = { renderSettingsPage };
