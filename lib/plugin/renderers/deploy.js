const { globalNav, projectNav, escapeHtml, icon, loadScript } = require("./_shared");

function renderDeployPage({ project, environment = "dev", defaultRef = "HEAD", backupPolicy = "optional", backupReady = false, backupProvider = "none", error = null } = {}) {
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
    @media(max-width:767px){.scps-rail{grid-template-columns:repeat(4,1fr)}.scps-stat-grid{grid-template-columns:repeat(2,1fr)}.scps-op{grid-template-columns:1fr}}
  </style>
  <div class="card scps-deploy-shell">
    <div class="scps-deploy-head"><div class="d-flex justify-content-between align-items-start position-relative" style="z-index:1"><div><h4 class="mb-1">${icon("fa-rocket", " me-2")}Deploy ${escapeHtml(project.name)}</h4><div class="small opacity-75">Review an immutable Git revision against the live tenant</div></div><span class="badge bg-info text-dark">${escapeHtml(environment)}</span></div></div>
    <div class="card-body">
      ${projectNav({ projectId: project.id, active: "deploy" })}
      ${error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : ""}
      <div class="scps-rail" id="deploy-rail" aria-label="Deployment progress">
        ${["Source","Preflight","Plan","Backup","Apply","Verify","Receipt"].map((label, index) => `<div class="scps-rail-step${index === 0 ? " active" : ""}" data-rail="${label.toLowerCase()}">${label}</div>`).join("")}
      </div>
      <section id="deploy-source-panel">
        <div class="row g-3"><div class="col-lg-7"><label class="form-label fw-bold">Git branch, tag or commit</label><input id="deploy-source-ref" class="form-control" value="${escapeHtml(defaultRef)}" /></div><div class="col-lg-5"><label class="form-label fw-bold" for="deploy-environment">Target environment</label><div class="input-group"><input id="deploy-environment" class="form-control" value="${escapeHtml(environment)}" /><button id="btn-deploy-environment" class="btn btn-outline-secondary" type="button">Open</button></div></div></div>
        <div class="d-flex flex-wrap align-items-center mt-3" style="gap:1rem"><label class="form-check"><input id="deploy-fetch-source" class="form-check-input" type="checkbox" checked /> <span class="form-check-label">Fetch origin before preview</span></label><label class="form-check"><input id="deploy-backup" class="form-check-input" type="checkbox" ${required || backupReady ? "checked" : ""} ${required ? "disabled" : ""} /> <span class="form-check-label">Create backup (${escapeHtml(backupPolicy)}; provider: ${escapeHtml(backupProvider)})</span></label>${backupReady ? '<span class="badge bg-success">Backup ready</span>' : '<span class="badge bg-warning text-dark">No backup provider configured</span>'}</div>
        <button id="btn-deploy-preview" class="btn btn-primary mt-3">${icon("fa-search", " me-1")}Generate deployment plan</button>
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
