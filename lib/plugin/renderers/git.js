const { optionalRequire } = require("../../tenant-adapters");
const { escapeHtml, globalNav, projectNav, loadScript } = require("./_shared");

function badge(text, cls = "secondary") {
  return `<span class="badge bg-${cls}">${escapeHtml(text)}</span>`;
}

function statusMark(status) {
  const colors = { M: "warning", A: "success", D: "danger", R: "info", "?": "secondary" };
  return `<span class="scps-git-state text-${colors[status] || "secondary"}">${escapeHtml(status || "·")}</span>`;
}

function fileRow(file, group) {
  const path = typeof file === "string" ? file : file.path;
  const state = typeof file === "string" ? "?" : file.status;
  const staged = group === "staged";
  return `<div class="scps-git-file"><div class="d-flex align-items-center min-w-0">${statusMark(state)}<code title="${escapeHtml(path)}">${escapeHtml(path)}</code></div><button class="btn btn-sm ${staged ? "btn-outline-secondary unstage-btn" : "btn-outline-primary stage-btn"}" data-group="${group}" data-path="${escapeHtml(path)}" title="${staged ? "Unstage" : "Stage"}"><i class="fas ${staged ? "fa-minus" : "fa-plus"}"></i></button></div>`;
}

function branchRows(branches, currentBranch, branchMap, aheadBehind) {
  return branches.map((branch) => {
    const current = branch === currentBranch;
    const tenant = branchMap[branch]?.tenant || "";
    const sync = aheadBehind[branch] || { ahead: 0, behind: 0 };
    return `<div class="scps-branch${current ? " current" : ""}"><div class="min-w-0"><div class="fw-bold text-truncate"><i class="fas fa-code-branch me-2"></i>${escapeHtml(branch)}</div><div class="small text-muted mt-1">${tenant ? `tenant ${escapeHtml(tenant)}` : "no tenant mapping"}${sync.ahead ? ` · ↑${sync.ahead}` : ""}${sync.behind ? ` · ↓${sync.behind}` : ""}</div></div>${current ? '<span class="scps-current-dot" title="Current branch"></span>' : `<div class="dropdown"><button class="btn btn-sm btn-link text-secondary px-1" data-bs-toggle="dropdown" aria-label="Branch actions"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu dropdown-menu-end"><button class="dropdown-item checkout-btn" data-branch="${escapeHtml(branch)}">Switch to branch</button><button class="dropdown-item merge-btn" data-branch="${escapeHtml(branch)}">Merge into ${escapeHtml(currentBranch)}</button>${tenant ? `<button class="dropdown-item text-danger delete-branch-btn" data-branch="${escapeHtml(branch)}">Delete branch and tenant</button>` : ""}</div></div>`}</div>`;
  }).join("");
}

function commitRows(log) {
  if (!log?.commits?.length) return '<div class="scps-empty">No recent commits.</div>';
  return log.commits.map((commit, index) => `<div class="scps-commit-row"><div class="scps-commit-graph"><span></span>${index < log.commits.length - 1 ? "<i></i>" : ""}</div><code>${escapeHtml((commit.hash || "").slice(0, 7))}</code><div class="min-w-0"><div class="text-truncate fw-semibold">${escapeHtml(commit.message || "")}</div><div class="small text-muted">${escapeHtml(commit.author || "")} · ${escapeHtml(commit.date || "")}</div></div></div>`).join("");
}

function renderGitPage({ projectRoot, projectId, status, branches, log, remoteUrl, branchMap, uiMode = "full", error }) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "git", mode: uiMode });
  const missingRoot = error === "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" || error === "Project has no root_path";
  if (error && !missingRoot) return nav + `<div class="card card-max-full-screen"><div class="card-body">${projectTabs}<div class="alert alert-danger">${escapeHtml(error)}</div></div></div>`;
  if (!projectRoot) return nav + `<div class="card card-max-full-screen"><div class="card-body">${projectTabs}<div class="alert alert-info">${projectId ? "Configure this project's root path before opening Git." : "Choose a project with a configured Git checkout."}</div></div></div>`;

  const currentBranch = branches?.current || status?.branch || "unknown";
  const staged = status?.staged || [];
  const unstaged = status?.unstaged || [];
  const untracked = status?.untracked || [];
  const conflicts = status?.conflicted || [];
  const localBranches = branches?.local || [];
  const mappings = branchMap || {};
  let aheadBehind = {};
  try { aheadBehind = require("../../git-ops").gitAheadBehind(projectRoot, localBranches); } catch (_err) { /* display without sync counts */ }

  let tenantWarning = "";
  try {
    const db = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
    if (db) {
      const guard = require("../../branch-tenant").guardBranchTenant(projectRoot, db.getTenantSchema());
      if (!guard.ok) tenantWarning = `<div class="alert alert-warning mb-3"><strong>Branch/tenant mismatch.</strong> Branch <code>${escapeHtml(currentBranch)}</code> expects <code>${escapeHtml(guard.expected)}</code>, current tenant is <code>${escapeHtml(guard.actual)}</code>.</div>`;
    }
  } catch (_err) { /* tenant mapping is optional */ }

  const changeCount = staged.length + unstaged.length + untracked.length;
  const scopeCandidate = staged.some((file) => /^(objects\/(tables|views|pages|triggers|roles|menu|settings)\/|plugins\.lock\.json$)/.test(typeof file === "string" ? file : file.path));
  const script = `<script>window.SCPS_GIT_PROJECT_ID = ${projectId == null ? "null" : JSON.stringify(projectId)};<\/script><script>${loadScript("git-interactions.js")}<\/script>`;
  const styles = `<style>
    :root{--git-ink:var(--scps-ink,#152536);--git-panel:var(--scps-paper,#f7f9fb);--git-line:var(--scps-steel,#d8e0e8);--git-cyan:var(--scps-cyan,#0b7285);--git-amber:#d97706}
    .scps-git-shell{border:1px solid var(--git-line);border-radius:.65rem;overflow:hidden;background:#fff;box-shadow:0 18px 45px rgba(21,32,43,.08)}
    .scps-git-bar{background:var(--git-ink);color:#f8fafc;padding:.8rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}.scps-git-bar code{color:#b6edf2}.scps-git-bar .btn{border-color:rgba(255,255,255,.28);color:#fff}.scps-git-bar .btn:hover{background:#fff;color:var(--git-ink)}
    .scps-git-layout{display:grid;grid-template-columns:15rem minmax(25rem,1fr) 19rem;min-height:38rem}.scps-git-pane{min-width:0;border-right:1px solid var(--git-line);background:var(--git-panel)}.scps-git-pane:last-child{border-right:0}.scps-git-main{background:#fff}.scps-pane-head{height:3rem;padding:.65rem .8rem;border-bottom:1px solid var(--git-line);display:flex;align-items:center;justify-content:space-between;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#52606d}
    .scps-branch,.scps-git-file{display:flex;align-items:center;justify-content:space-between;gap:.65rem;padding:.65rem .75rem;border-bottom:1px solid #e8edf2}.scps-branch.current{background:#e7f5f7;color:#075b67}.scps-current-dot{width:.55rem;height:.55rem;border-radius:50%;background:#13b5c8;box-shadow:0 0 0 4px rgba(19,181,200,.14)}
    .scps-git-file code{display:block;color:#263746;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.scps-git-file:hover{background:#f4fafb}.scps-git-state{display:inline-block;width:1.7rem;font-family:ui-monospace,monospace;font-weight:900}.scps-group-title{padding:.55rem .75rem;background:#f2f5f8;border-bottom:1px solid var(--git-line);display:flex;justify-content:space-between;align-items:center;font-size:.76rem;font-weight:800;color:#455a64}
    .scps-commit-box{padding:.9rem}.scps-commit-box textarea{min-height:7rem;resize:vertical}.scps-empty{padding:1rem;color:#7b8794;font-size:.85rem}.scps-history{border-top:1px solid var(--git-line)}.scps-commit-row{display:grid;grid-template-columns:1.2rem 4.8rem minmax(0,1fr);gap:.55rem;padding:.55rem .8rem}.scps-commit-graph{position:relative}.scps-commit-graph span{position:absolute;top:.35rem;left:.25rem;width:.55rem;height:.55rem;border:2px solid var(--git-cyan);border-radius:50%;background:#fff}.scps-commit-graph i{position:absolute;top:.9rem;bottom:-.7rem;left:.49rem;border-left:1px solid #91a4b4}.scps-repo-path{font-size:.7rem;color:#8ca0b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38vw}
    #create-branch-form{border-bottom:1px solid var(--git-line);padding:.75rem;background:#eef7f8}
    @media(max-width:1100px){.scps-git-layout{grid-template-columns:13rem 1fr}.scps-git-commit{grid-column:1/-1;border-top:1px solid var(--git-line)}}@media(max-width:720px){.scps-git-layout{display:block}.scps-git-pane{border-right:0;border-bottom:1px solid var(--git-line)}.scps-git-bar{align-items:flex-start;flex-direction:column}.scps-repo-path{max-width:90vw}}
  </style>`;

  return nav + styles + `<div class="scps-git-shell">
    <header class="scps-git-bar"><div class="min-w-0"><div class="fw-bold"><i class="fas fa-code-branch me-2"></i>${escapeHtml(currentBranch)} ${status?.clean ? '<span class="badge bg-success ms-2">clean</span>' : `<span class="badge bg-warning text-dark ms-2">${changeCount} changes</span>`}</div><div class="scps-repo-path mt-1">${escapeHtml(projectRoot)}${remoteUrl?.ok ? ` · ${escapeHtml(remoteUrl.stdout)}` : ""}</div></div><div class="d-flex flex-wrap" style="gap:.35rem"><button id="btn-git-fetch" class="btn btn-sm"><i class="fas fa-sync me-1"></i>Fetch</button><button id="btn-git-pull" class="btn btn-sm"><i class="fas fa-download me-1"></i>Pull${status?.behind ? ` ${status.behind}` : ""}</button><button id="btn-git-push" class="btn btn-sm${status?.ahead ? " btn-warning text-dark" : ""}"${status?.ahead ? ' title="Push pending"' : ""}><i class="fas fa-upload me-1"></i>Push${status?.ahead ? ` ${status.ahead}` : ""}</button></div></header>
    <div class="p-3 pb-0">${projectTabs}${tenantWarning}${conflicts.length ? `<div class="alert alert-danger">Resolve conflicts before continuing: ${conflicts.map((item) => `<code>${escapeHtml(item)}</code>`).join(", ")}</div>` : ""}</div>
    <div class="scps-git-layout">
      <aside class="scps-git-pane"><div class="scps-pane-head"><span>Branches</span><button id="btn-create-branch" class="btn btn-sm btn-link p-0" title="New branch"><i class="fas fa-plus"></i></button></div><div id="create-branch-form" style="display:none"><input id="new-branch-name" class="form-control form-control-sm mb-2" placeholder="feature/name"><div class="d-flex" style="gap:.35rem"><button id="btn-do-create-branch" class="btn btn-primary btn-sm">Create + tenant</button><button id="btn-cancel-branch" class="btn btn-light btn-sm">Cancel</button></div><div id="create-branch-status" class="mt-2" style="display:none"></div></div>${branchRows(localBranches, currentBranch, mappings, aheadBehind)}</aside>
      <main class="scps-git-pane scps-git-main"><div class="scps-pane-head"><span>Working tree</span><span>${changeCount}</span></div><div class="scps-group-title"><span>Staged · ${staged.length}</span><button id="btn-unstage-all" class="btn btn-link btn-sm p-0"${staged.length ? "" : " disabled"}>Unstage all</button></div>${staged.length ? staged.map((file) => fileRow(file, "staged")).join("") : '<div class="scps-empty">Stage a change to prepare the next commit.</div>'}<div class="scps-group-title"><span>Modified · ${unstaged.length}</span><button id="btn-stage-modified" class="btn btn-link btn-sm p-0"${unstaged.length ? "" : " disabled"}>Stage all</button></div>${unstaged.length ? unstaged.map((file) => fileRow(file, "modified")).join("") : '<div class="scps-empty">No modified files.</div>'}<div class="scps-group-title"><span>Untracked · ${untracked.length}</span><button id="btn-stage-untracked" class="btn btn-link btn-sm p-0"${untracked.length ? "" : " disabled"}>Stage all</button></div>${untracked.length ? untracked.map((file) => fileRow(file, "untracked")).join("") : '<div class="scps-empty">No untracked files.</div>'}<section class="scps-history"><div class="scps-pane-head"><span>Recent history</span><span>${log?.commits?.length || 0}</span></div>${commitRows(log)}</section></main>
      <aside class="scps-git-pane scps-git-commit"><div class="scps-pane-head"><span>Commit</span><span>${staged.length} staged</span></div><div class="scps-commit-box"><label class="form-label small fw-bold" for="git-commit-msg">Message</label><textarea id="git-commit-msg" class="form-control" placeholder="Describe why this change is needed"></textarea><button id="btn-git-commit" class="btn btn-primary w-100 mt-2"${staged.length ? "" : " disabled"}><i class="fas fa-check me-1"></i>Commit ${staged.length || ""}</button><div class="mt-3 small"><label class="d-flex align-items-start gap-2"><input id="git-commit-push" type="checkbox" class="form-check-input mt-0"><span><strong>Push after commit</strong><br><span class="text-muted">Send this branch to origin immediately.</span></span></label><label class="d-flex align-items-start gap-2 mt-2"><input id="git-commit-sync-scope" type="checkbox" class="form-check-input mt-0"${scopeCandidate ? " checked" : ""}><span><strong>Record object scope</strong><br><span class="text-muted">Include staged object files in the portable deployment manifest.</span></span></label></div><hr><div class="small text-muted mb-2">Temporary work</div><div class="d-grid gap-2"><button id="btn-git-stash" class="btn btn-outline-warning btn-sm">Stash changes</button><button id="btn-git-stash-pop" class="btn btn-outline-secondary btn-sm">Restore stash</button></div></div></aside>
    </div>${script}</div>`;
}

module.exports = { renderGitPage };
