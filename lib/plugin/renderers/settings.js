const {
  tags, renderFilterableTable, escapeHtml, icon, globalNav, projectNav, loadScript,
} = require("./_shared");

const { code } = tags;

function selected(value, expected) {
  return value === expected ? " selected" : "";
}

function input(id, label, value = "", help = "", placeholder = "") {
  return `<div class="mb-3"><label class="form-label" for="${id}">${escapeHtml(label)}</label><input id="${id}" class="form-control" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" />${help ? `<div class="form-text">${help}</div>` : ""}</div>`;
}

function healthRows(health = {}) {
  return (health.checks || []).map((check) => ({
    check: escapeHtml(check.label),
    detail: escapeHtml(check.detail),
    source: check.source ? code(escapeHtml(check.source)) : '<span class="text-muted">runtime</span>',
    status: check.ready ? '<span class="badge bg-success">Ready</span>' : '<span class="badge bg-danger">Not ready</span>',
  }));
}

function tokenRows(tokens = []) {
  return tokens.map((token) => ({
    name: escapeHtml(token.name),
    prefix: code(`${escapeHtml(token.token_prefix)}…`),
    created: escapeHtml(token.created_at ? new Date(token.created_at).toISOString() : ""),
    status: token.revoked_at ? '<span class="badge bg-secondary">Revoked</span>' : '<span class="badge bg-success">Active</span>',
    action: token.revoked_at ? "" : `<button type="button" class="btn btn-sm btn-outline-danger token-revoke" data-token-id="${Number(token.id)}">Revoke</button>`,
  }));
}

function renderSettingsPage({ project = null, error = null, environment = "dev", environmentConfig = {}, resolved = {}, health = {}, tokens = [] } = {}) {
  if (!project || !project.id) {
    return globalNav("projects") +
      '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-cog me-2"></i>Project settings</h5></div><div class="card-body">' +
      (error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : "") +
      '<div class="alert alert-info mb-0">Choose a project first to edit its settings and health checks. <a href="/project-sync/projects" class="btn btn-sm btn-primary ms-3">Open projects</a></div></div></div>';
  }

  const cfg = environmentConfig || {};
  const effective = resolved.config || {};
  const sources = resolved.sources || {};
  const readyBadge = health.ready
    ? '<span class="badge bg-success fs-6"><i class="fas fa-check me-1"></i>Ready</span>'
    : '<span class="badge bg-danger fs-6"><i class="fas fa-times me-1"></i>Not ready</span>';
  const healthTable = renderFilterableTable("project-health-checks", [
    { key: (row) => row.check, label: "Check" },
    { key: (row) => row.detail, label: "Detail" },
    { key: (row) => row.source, label: "Effective source" },
    { key: (row) => row.status, label: "Status" },
  ], healthRows(health), { hover: false, class: "table-bordered" });
  const tokensTable = renderFilterableTable("project-api-tokens", [
    { key: (row) => row.name, label: "Name" },
    { key: (row) => row.prefix, label: "Prefix" },
    { key: (row) => row.created, label: "Created" },
    { key: (row) => row.status, label: "Status" },
    { key: (row) => row.action, label: "" },
  ], tokenRows(tokens), { hover: false, class: "table-bordered" });
  const sourceRows = Object.keys(effective).filter((key) => key !== "environment").map((key) =>
    `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(String(effective[key] ?? ""))}</td><td><span class="badge bg-light text-dark">${escapeHtml(sources[key] || "default")}</span></td></tr>`
  ).join("");
  const script = `<script>window.SCPS_SETTINGS_PROJECT_ID = ${JSON.stringify(project.id)};window.SCPS_SETTINGS = ${JSON.stringify({ projectId: project.id, environment })};<\/script><script>\n${loadScript("settings.js")}\n<\/script>`;
  const setupStyle = `<style>
    .scps-setup-map{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.35rem;margin:0 0 1.5rem;padding:0;list-style:none}
    .scps-setup-map li{border-top:3px solid #b8c2cc;padding:.45rem .25rem 0;color:#6c757d;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .scps-setup-map li:first-child,.scps-setup-map li:last-child{border-color:#0d6efd;color:#243b53}
    #project-settings-form h6{border:0!important;border-left:4px solid #0d6efd;background:#f4f7fa;padding:.7rem .85rem!important;margin-left:-.85rem;letter-spacing:.02em}
    #ssh-transport-fields{background:repeating-linear-gradient(135deg,#f8fafc,#f8fafc 12px,#f3f6f9 12px,#f3f6f9 24px);border:1px solid #d9e2ec;border-radius:.4rem;padding:1rem 1rem 0;margin-bottom:1rem}
    #one-time-token{word-break:break-all;user-select:all}
    @media(max-width:767px){.scps-setup-map{grid-template-columns:repeat(3,minmax(0,1fr))}}
  </style>`;

  return globalNav("projects") +
    '<div class="card card-max-full-screen"><div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem">' +
      `<div><h5 class="mb-0">${icon("fa-magic", " me-2")}${escapeHtml(project.name)} settings &amp; setup</h5><div class="small text-muted mt-1">Project, environment, transport, backup and access</div></div>${readyBadge}` +
      `<a href="/project-sync/projects/${encodeURIComponent(project.id)}" class="btn btn-sm btn-outline-secondary">Back to scope</a></div>` +
    setupStyle + '<div class="card-body">' + projectNav({ projectId: project.id, active: "settings", mode: effective.ui_mode || "full" }) +
      (error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : "") +
      '<ol class="scps-setup-map" aria-label="Setup progress"><li>Repository</li><li>Tenant</li><li>Transport</li><li>Safety</li><li>Health</li><li>Access</li></ol>' +
      '<div class="alert alert-info"><strong>Precedence:</strong> process environment → <code>environments/&lt;env&gt;.json</code> → project UI → defaults. The first available value wins. Secrets are only read through environment-variable references.</div>' +
      '<div class="d-flex align-items-end mb-4" style="gap:.5rem"><div><label class="form-label">Environment</label><input id="project-setting-environment" class="form-control" value="' + escapeHtml(environment) + '" /></div><button type="button" id="btn-open-environment" class="btn btn-outline-primary">Open</button></div>' +
      '<form id="project-settings-form">' +
        '<h6 class="border-bottom pb-2">1. Project and repository</h6>' +
        '<div class="mb-3"><label class="form-label" for="project-setting-ui-mode">Interface role</label><select id="project-setting-ui-mode" class="form-select"><option value="full"' + selected(effective.ui_mode || "full", "full") + '>Full — development and deployment</option><option value="workspace"' + selected(effective.ui_mode, "workspace") + '>Workspace — scope, Git and drift</option><option value="deployment"' + selected(effective.ui_mode, "deployment") + '>Deployment server — deploy, history and settings</option></select><div class="form-text">Controls project navigation for this server/environment; it does not change deployment permissions.</div></div>' +
        input("project-setting-name", "Name", project.name) + input("project-setting-slug", "Slug", project.slug) +
        input("project-setting-description", "Description", project.description) + input("project-setting-min-version", "Minimum Saltcorn version", project.min_version || "1.6.0") +
        input("project-setting-root-path", "Project root path", project.root_path, "Must be an existing readable and writable Git checkout.", "/path/to/project") +
        input("project-setting-repository", "Repository URL", cfg.repository, "Non-secret origin URL; SSH keys remain outside this configuration.", "https://github.com/org/project.git") +
        '<h6 class="border-bottom pb-2 mt-4">2. Environment and tenant</h6>' +
        '<div class="row"><div class="col-md-4"><div class="mb-3"><label class="form-label">Adapter</label><select id="project-setting-adapter" class="form-select"><option value="native"' + selected(cfg.adapter || "native", "native") + '>Native</option><option value="rest"' + selected(cfg.adapter, "rest") + '>REST</option><option value="command"' + selected(cfg.adapter, "command") + '>Command</option></select></div></div>' +
        '<div class="col-md-8">' + input("project-setting-base-url", "Base URL", cfg.base_url, "HTTPS is required outside localhost.", "https://tenant.example.com") + '</div></div>' +
        '<div class="row"><div class="col-md-6">' + input("project-setting-branch", "Git branch", cfg.branch, "Maps this environment to a branch.", "main") + '</div><div class="col-md-6">' + input("project-setting-tenant", "Saltcorn tenant", cfg.tenant, "Tenant/schema identifier for this branch.", "public") + '</div></div>' +
        '<h6 class="border-bottom pb-2 mt-4">3. Transport</h6>' +
        '<div class="mb-3"><label class="form-label">Transport</label><select id="project-setting-transport" class="form-select"><option value="direct"' + selected(cfg.transport || "direct", "direct") + '>Direct HTTPS</option><option value="ssh"' + selected(cfg.transport, "ssh") + '>Managed SSH tunnel</option></select></div>' +
        '<div id="ssh-transport-fields"><div class="row"><div class="col-md-4">' + input("project-setting-ssh-host", "SSH host", cfg.ssh_host) + '</div><div class="col-md-4">' + input("project-setting-ssh-user", "SSH user", cfg.ssh_user) + '</div><div class="col-md-4">' + input("project-setting-ssh-port", "SSH port", cfg.ssh_port || "22") + '</div></div>' +
        '<div class="row"><div class="col-md-4">' + input("project-setting-ssh-local-port", "Local port", cfg.ssh_local_port || "3000") + '</div><div class="col-md-4">' + input("project-setting-ssh-remote-host", "Remote host", cfg.ssh_remote_host || "127.0.0.1") + '</div><div class="col-md-4">' + input("project-setting-ssh-remote-port", "Remote port", cfg.ssh_remote_port || "3000") + '</div></div>' +
        input("project-setting-ssh-identity-file", "SSH identity file", cfg.ssh_identity_file, "Path/reference only; private key contents are never stored.") + '</div>' +
        '<h6 class="border-bottom pb-2 mt-4">4. Backup and secret references</h6>' +
        '<div class="row"><div class="col-md-4"><div class="mb-3"><label class="form-label" for="project-setting-backup-policy">Backup policy</label><select id="project-setting-backup-policy" class="form-select"><option value="optional"' + selected(cfg.backup_policy || "optional", "optional") + '>Optional</option><option value="required"' + selected(cfg.backup_policy, "required") + '>Required</option></select><div class="form-text">Test and prod always require a verifiable backup, regardless of this value.</div></div></div><div class="col-md-4">' + input("project-setting-backup-hook-env", "Backup hook variable", cfg.backup_hook_env, "Name of a variable in the VPS process environment; never put the command itself here.", "SCPS_DEV_BACKUP_CMD") + '</div><div class="col-md-4">' + input("project-setting-restore-hook-env", "Restore hook variable", cfg.restore_hook_env, "Name of a variable in the VPS process environment.", "SCPS_DEV_RESTORE_CMD") + '</div></div>' +
        input("project-setting-token-env", "API token variable", cfg.token_env || "SALTCORN_PROJECT_SYNC_API_TOKEN", "Name of a variable in the VPS process environment; never the token value.") +
        '<div class="d-flex align-items-center" style="gap:.5rem"><button type="submit" id="btn-save-project-settings" class="btn btn-primary">Save setup</button><span id="save-status" class="small text-muted"></span></div>' +
      '</form>' +
      '<hr class="my-4" /><div class="d-flex justify-content-between"><h6>5. Health checks</h6><button id="btn-run-health" class="btn btn-sm btn-outline-primary">Run checks</button></div>' + healthTable +
      '<details class="mt-3"><summary>Effective configuration and sources</summary><div class="table-responsive mt-2"><table class="table table-sm"><thead><tr><th>Setting</th><th>Effective value</th><th>Source</th></tr></thead><tbody>' + sourceRows + '</tbody></table></div></details>' +
      '<hr class="my-4" /><h6>6. API tokens</h6><p class="text-muted small">Stored as salted hashes. A new token is displayed once and cannot be recovered later.</p>' +
      '<div class="input-group mb-3"><input id="new-token-name" class="form-control" placeholder="CI production" /><button id="btn-generate-token" type="button" class="btn btn-outline-primary">Generate token</button></div>' +
      '<div id="one-time-token-box" class="alert alert-warning d-none"><strong>Copy this token now:</strong> <code id="one-time-token"></code></div>' + tokensTable + script +
    '</div></div>';
}

module.exports = { renderSettingsPage };
