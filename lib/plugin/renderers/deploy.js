const { globalNav, projectNav, escapeHtml, icon, loadScript } = require("./_shared");

function sourceOptionsHtml(options = [], selectedRef = "HEAD") {
  const groups = { configured: [], branch: [], tag: [], commit: [] };
  for (const option of options) (groups[option.kind] || groups.commit).push(option);
  const labels = { configured: "Recommended", branch: "Remote branches", tag: "Tags", commit: "Recent commits" };
  return Object.entries(groups).filter(([, entries]) => entries.length).map(([kind, entries]) =>
    `<optgroup label="${labels[kind]}">${entries.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selectedRef ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</optgroup>`
  ).join("");
}

function renderDeployPage({ project, environment = "dev", environments = [], defaultRef = "HEAD", sourceOptions = [], tenant = null, uiMode = "full", backupPolicy = "optional", backupReady = false, backupProvider = "none", error = null } = {}) {
  if (!project) return globalNav("projects") + '<div class="alert alert-danger">Project not found.</div>';
  const required = backupPolicy === "required";
  const boot = { projectId: project.id, environment, backupPolicy, backupReady };
  return globalNav("projects") + `
  <style>
    :root{--scps-ink:#152536;--scps-steel:#d9e2ec;--scps-blue:#1167b1;--scps-cyan:#13b5c8;--scps-amber:#d97706;--scps-red:#b42318;--scps-green:#147d64}
    .scps-deploy-shell{background:linear-gradient(145deg,#f8fafc 0%,#eef4f8 100%);border:1px solid var(--scps-steel);box-shadow:0 18px 45px rgba(21,37,54,.08)}
    .scps-deploy-head{background:var(--scps-ink);color:#fff;padding:1.2rem 1.35rem;position:relative;overflow:hidden}
    .scps-deploy-head:after{content:"";position:absolute;right:-35px;top:-55px;width:190px;height:190px;border:26px solid rgba(19,181,200,.18);transform:rotate(22deg)}
    .scps-rail{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;background:#bdc9d5;border-radius:.35rem;overflow:hidden;margin:1.25rem 0}
    .scps-rail-step{background:#fff;padding:.7rem .35rem;text-align:center;font-size:.7rem;font-weight:800;letter-spacing:.05em;color:#657786;text-transform:uppercase;border-bottom:4px solid transparent;transition:all .25s ease}
    .scps-rail-step.active{color:var(--scps-blue);border-color:var(--scps-cyan);background:#edfafd}.scps-rail-step.done{color:var(--scps-green);border-color:var(--scps-green)}.scps-rail-step.failed{color:var(--scps-red);border-color:var(--scps-red)}
    .scps-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;margin:1rem 0}.scps-stat{background:#fff;border:1px solid var(--scps-steel);border-left:5px solid var(--scps-blue);padding:.7rem .8rem}.scps-stat.warn{border-left-color:var(--scps-amber)}.scps-stat.danger{border-left-color:var(--scps-red)}.scps-stat strong{font-size:1.35rem;display:block;color:var(--scps-ink)}
    .scps-op{display:grid;grid-template-columns:8rem 1fr auto;gap:.7rem;align-items:center;padding:.55rem .7rem;border-bottom:1px solid #e6edf3;background:#fff}.scps-op:last-child{border-bottom:0}.scps-op code{color:var(--scps-ink)}
    .scps-digest{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;word-break:break-all;color:#52667a}
    .scps-console{background:#0d1b29;color:#b8e3ea;border-radius:.4rem;padding:.8rem;min-height:5rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem}
    .scps-launch-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(16rem,.65fr);gap:1rem}.scps-launch-card{background:#fff;border:1px solid var(--scps-steel);border-radius:.55rem;padding:1rem;position:relative}.scps-launch-kicker{color:#60758a;font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.scps-launch-value{color:var(--scps-ink);font-size:1.05rem;font-weight:800}.scps-launch-meta{color:#60758a;font-size:.78rem}.scps-advanced{border-top:1px solid #e6edf3;margin-top:.85rem;padding-top:.7rem}.scps-advanced summary{color:var(--scps-blue);cursor:pointer;font-size:.82rem;font-weight:700}
    @media(max-width:767px){.scps-rail{grid-template-columns:repeat(4,1fr)}.scps-stat-grid{grid-template-columns:repeat(2,1fr)}.scps-op{grid-template-columns:1fr}}
    @media(max-width:900px){.scps-launch-grid{grid-template-columns:1fr}}
  </style>
  <div class="card scps-deploy-shell">
    <div class="scps-deploy-head"><div class="d-flex justify-content-between align-items-start position-relative" style="z-index:1"><div><h4 class="mb-1">${icon("fa-rocket", " me-2")}Deploy ${escapeHtml(project.name)}</h4><div class="small opacity-75">Review an immutable Git revision against the live tenant</div></div><span class="badge bg-info text-dark">${escapeHtml(environment)}</span></div></div>
    <div class="card-body">
      ${projectNav({ projectId: project.id, active: "deploy", mode: uiMode })}
      ${error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : ""}
      <div class="scps-rail" id="deploy-rail" aria-label="Deployment progress">
        ${["Source","Preflight","Plan","Backup","Apply","Verify","Receipt"].map((label, index) => `<div class="scps-rail-step${index === 0 ? " active" : ""}" data-rail="${label.toLowerCase()}">${label}</div>`).join("")}
      </div>
      <section id="deploy-source-panel">
        <div class="scps-launch-grid">
          <div class="scps-launch-card"><div class="scps-launch-kicker">Source</div><div class="d-flex justify-content-between align-items-start mt-1" style="gap:1rem"><div><div class="scps-launch-value"><i class="fas fa-code-branch me-2 text-info"></i>${escapeHtml(defaultRef)}</div><div class="scps-launch-meta mt-1">Configured branch. Origin is fetched and the clean checkout is fast-forwarded before planning.</div></div><span class="badge bg-info text-dark">automatic</span></div><details class="scps-advanced"><summary>Choose another branch, tag or exact commit</summary><label class="form-label small mt-2" for="deploy-source-ref">Immutable Git source</label><select id="deploy-source-ref" class="form-select">${sourceOptionsHtml(sourceOptions.length ? sourceOptions : [{ value: defaultRef, label: defaultRef, kind: "configured" }], defaultRef)}</select><div class="form-text">Use the configured branch for normal deployments. Tags and commits are for controlled rollouts or recovery.</div></details></div>
          <div class="scps-launch-card"><div class="scps-launch-kicker">Target</div><div class="scps-launch-value mt-1"><i class="fas fa-server me-2 text-info"></i>${escapeHtml(environment)}</div><div class="scps-launch-meta mt-1">${tenant ? `Tenant <code>${escapeHtml(tenant)}</code>. ` : ""}This profile selects tenant, safety policy and backup provider; it does not select Git content.</div>${environments.length > 1 ? `<label class="form-label small mt-3" for="deploy-environment">Configured target</label><select id="deploy-environment" class="form-select form-select-sm">${environments.map((env) => `<option value="${escapeHtml(env)}"${env === environment ? " selected" : ""}>${escapeHtml(env)}</option>`).join("")}</select>` : `<input id="deploy-environment" type="hidden" value="${escapeHtml(environment)}" />`}<a class="btn btn-link btn-sm px-0 mt-2" href="/project-sync/settings?project_id=${encodeURIComponent(project.id)}&environment=${encodeURIComponent(environment)}">Review target configuration</a></div>
        </div>
        <div class="d-flex flex-wrap align-items-center mt-3" style="gap:1rem"><label class="form-check mb-0"><input id="deploy-backup" class="form-check-input" type="checkbox" ${required || backupReady ? "checked" : ""} ${required ? "disabled" : ""} /> <span class="form-check-label">Create backup <span class="text-muted">(${escapeHtml(backupPolicy)}; ${escapeHtml(backupProvider)})</span></span></label>${backupReady ? '<span class="badge bg-success">Backup ready</span>' : '<span class="badge bg-warning text-dark">No backup provider configured</span>'}</div>
        <button id="btn-deploy-preview" class="btn btn-primary btn-lg mt-3">${icon("fa-search", " me-2")}Review changes from ${escapeHtml(defaultRef)}</button>
      </section>
      <section id="deploy-plan-panel" class="d-none mt-4">
        <div id="deploy-alerts"></div><div class="scps-stat-grid" id="deploy-stats"></div>
        <div class="d-flex justify-content-between align-items-center"><h6 class="mb-2">Operations</h6><span id="deploy-commit" class="badge bg-dark"></span></div>
        <div id="deploy-operations" class="border rounded overflow-hidden"></div>
        <div id="deploy-scope-changes" class="mt-3"></div>
        <details class="mt-3"><summary>Plan identity</summary><div class="scps-digest mt-2" id="deploy-digests"></div></details>
        <div id="deploy-destructive-confirm" class="alert alert-danger d-none mt-3"><label class="form-label">Type <code>${escapeHtml(environment)}</code> to confirm destructive operations</label><input id="deploy-typed-env" class="form-control" autocomplete="off" /></div>
        <div class="d-flex flex-wrap mt-3" style="gap:.5rem"><button id="btn-deploy-confirm" class="btn btn-danger" disabled>${icon("fa-play", " me-1")}Confirm and deploy</button><button id="btn-deploy-cancel" class="btn btn-outline-secondary">Cancel preview</button></div>
      </section>
      <section id="deploy-progress-panel" class="d-none mt-4"><h6>Execution</h6><div id="deploy-console" class="scps-console" aria-live="polite"></div></section>
      <section id="deploy-receipt-panel" class="d-none mt-4"></section>
    </div>
  </div>
  <script>window.SCPS_DEPLOY = ${JSON.stringify(boot)};<\/script><script>${loadScript("deploy.js")}<\/script>`;
}

module.exports = { renderDeployPage };
