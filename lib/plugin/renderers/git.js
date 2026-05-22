const { optionalRequire } = require("../../tenant-adapters");
const { renderFilterableTable, escapeHtml, globalNav, projectNav, loadScript } = require("./_shared");

function badge(text, cls = "secondary") {
  return `<span class="badge bg-${cls}">${escapeHtml(text)}</span>`;
}

function sectionCard(title, icon, body, headerRight = "") {
  return '<div class="card mb-3"><div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem"><h6 class="mb-0"><i class="fas ' + icon + ' me-2"></i>' + escapeHtml(title) + '</h6>' + headerRight + '</div><div class="card-body">' + body + '</div></div>';
}

function statusIcon(s) {
  switch (s) {
    case "M": return '<span class="text-warning" title="Modified">M</span>';
    case "A": return '<span class="text-success" title="Added">A</span>';
    case "D": return '<span class="text-danger" title="Deleted">D</span>';
    case "R": return '<span class="text-info" title="Renamed">R</span>';
    default: return '<span class="text-muted">' + escapeHtml(s) + '</span>';
  }
}

function renderGitPage({ projectRoot, projectId, status, branches, log, remoteUrl, branchMap, error }) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "git" });
  const missingRootConfigured = error === "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" || error === "Project has no root_path";

  if (error && !missingRootConfigured) {
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-code-branch me-2"></i>Git</h5></div><div class="card-body">' + projectTabs + `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` + '</div></div>';
  }
  if (!projectRoot) {
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-code-branch me-2"></i>Git</h5></div><div class="card-body">' + projectTabs +
      `<div class="alert alert-info">${projectId ? 'This project has no <code>root_path</code> yet. Set the folder on the project first, then open Git again.' : 'Open Git from a project with a configured folder, or configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable Git operations.'}</div>` +
      '</div></div>';
  }

  const currentBranch = (branches && branches.current) || (status && status.branch) || "";
  const projectQuery = projectId !== undefined && projectId !== null && String(projectId) !== "" ? `?project_id=${encodeURIComponent(projectId)}` : "";
  let tenantWarningHtml = "";
  if (projectRoot && currentBranch) {
    try {
      const bt = require("../../branch-tenant");
      const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
      if (dbMod) {
        const currentTenant = dbMod.getTenantSchema();
        const guard = bt.guardBranchTenant(projectRoot, currentTenant);
        if (!guard.ok) {
          const expectedUrl = guard.expected === "public" ? "http://localhost:3000" : `http://${guard.expected}.localhost:3000`;
          tenantWarningHtml = `<div class="alert alert-warning"><strong>Branch/tenant mismatch!</strong><br><span class="small">Git branch <code>${escapeHtml(currentBranch)}</code> expects tenant <code>${escapeHtml(guard.expected)}</code>, but you're on tenant <code>${escapeHtml(guard.actual)}</code>.</span><div class="mt-2"><a href="${expectedUrl}/project-sync/git${projectQuery}" target="_blank" class="btn btn-warning btn-sm"><i class="fas fa-external-link-alt me-1"></i>Open on ${escapeHtml(guard.expected)}</a></div></div>`;
        }
      }
    } catch {
    }
  }

  const staged = (status && status.staged) || [];
  const unstaged = (status && status.unstaged) || [];
  const untracked = (status && status.untracked) || [];
  const conflicted = (status && status.conflicted) || [];
  const allBranches = (branches && branches.local) || [];
  const bMap = branchMap || {};

  let aheadBehind = {};
  try {
    const gitOps = require("../../git-ops");
    aheadBehind = gitOps.gitAheadBehind(projectRoot, allBranches);
  } catch {
  }

  const summary = sectionCard("Repository", "fa-folder-open", `
    ${tenantWarningHtml}
    <div class="d-flex flex-wrap align-items-center" style="gap:.5rem">
      ${status ? badge(status.branch || "unknown", "secondary") : ""}
      ${remoteUrl && remoteUrl.ok ? `<span class="text-muted small"><i class="fas fa-cloud me-1"></i><code>${escapeHtml(remoteUrl.stdout)}</code></span>` : ""}
      ${status && status.clean ? '<span class="badge bg-success">Clean</span>' : '<span class="badge bg-warning text-dark">Dirty</span>'}
      ${status && status.ahead > 0 ? `<span class="badge bg-info">${status.ahead} ahead</span>` : ""}
      ${status && status.behind > 0 ? `<span class="badge bg-warning text-dark">${status.behind} behind</span>` : ""}
    </div>
    <div class="small text-muted mt-2">Project root: <code>${escapeHtml(projectRoot)}</code></div>
  `);

  const conflictSection = conflicted.length ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>Conflicts: ${conflicted.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}</div>` : "";

  const stagedTable = staged.length ? renderFilterableTable("git-staged-table", [
    { key: (row) => statusIcon(row.status), label: "X", filter: false },
    { key: (row) => `<code>${escapeHtml(row.path)}</code>`, label: "File" },
  ], staged, { hover: true, class: "table-bordered" }) : '<div class="text-muted">No staged files.</div>';

  const unstagedTable = unstaged.length ? renderFilterableTable("git-unstaged-table", [
    { key: (row) => statusIcon(row.status), label: "X", filter: false },
    { key: (row) => `<code>${escapeHtml(row.path)}</code>`, label: "File" },
    { key: (row) => `<button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(row.path)}"><i class="fas fa-plus me-1"></i>Stage</button>`, label: "", filter: false },
  ], unstaged, { hover: true, class: "table-bordered" }) : '<div class="text-muted">No modified files.</div>';

  const untrackedTable = untracked.length ? renderFilterableTable("git-untracked-table", [
    { key: (row) => `<code>${escapeHtml(row)}</code>`, label: "File" },
    { key: (row) => `<button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(row)}"><i class="fas fa-plus me-1"></i>Stage</button>`, label: "", filter: false },
  ], untracked, { hover: true, class: "table-bordered" }) : '<div class="text-muted">No untracked files.</div>';

  const branchRows = allBranches.map((branch) => {
    const mapping = bMap[branch] || null;
    const isCurrent = branch === currentBranch;
    const tenant = mapping ? mapping.tenant : "";
    const ab = aheadBehind[branch] || { ahead: 0, behind: 0 };
    return {
      branch,
      current: isCurrent,
      tenant,
      sync: ab,
    };
  });

  const branchTable = renderFilterableTable("git-branches-table", [
    { key: (row) => row.current ? `${badge(row.branch, "primary")} <span class="badge bg-success">current</span>` : badge(row.branch, "secondary"), label: "Branch" },
    { key: (row) => row.tenant ? `<span class="badge bg-info">${escapeHtml(row.tenant)}</span>` : '<span class="text-muted">—</span>', label: "Tenant" },
    { key: (row) => (row.sync.ahead || row.sync.behind) ? `${row.sync.ahead ? `<span class="badge bg-info me-1">↑ ${row.sync.ahead}</span>` : ""}${row.sync.behind ? `<span class="badge bg-warning text-dark">↓ ${row.sync.behind}</span>` : ""}` : '<span class="text-muted">Synced</span>', label: "Sync" },
    { key: (row) => row.current ? '<span class="text-muted small">current</span>' : `<div class="d-flex flex-wrap" style="gap:.25rem"><button class="btn btn-outline-secondary btn-sm py-0 px-2 checkout-btn" data-branch="${escapeHtml(row.branch)}"><i class="fas fa-code-branch me-1"></i>Switch</button><button class="btn btn-outline-primary btn-sm py-0 px-2 merge-btn" data-branch="${escapeHtml(row.branch)}"><i class="fas fa-code-merge me-1"></i>Merge into ${escapeHtml(currentBranch)}</button>${row.tenant ? `<button class="btn btn-outline-danger btn-sm py-0 px-2 delete-branch-btn" data-branch="${escapeHtml(row.branch)}"><i class="fas fa-trash me-1"></i>Delete</button>` : ""}</div>`, label: "Actions", filter: false },
  ], branchRows, { hover: true, class: "table-bordered" });

  const logTable = log && Array.isArray(log.commits) && log.commits.length ? renderFilterableTable("git-log-table", [
    { key: (row) => `<code>${escapeHtml((row.hash || "").substring(0, 7))}</code>`, label: "Commit" },
    { key: (row) => escapeHtml(row.message || ""), label: "Message" },
    { key: (row) => escapeHtml(row.author || ""), label: "Author" },
    { key: (row) => escapeHtml(row.date || ""), label: "Date" },
  ], log.commits, { hover: true, class: "table-bordered" }) : '<div class="text-muted">No recent commits.</div>';

  const script = `<script>window.SCPS_GIT_PROJECT_ID = ${projectId == null ? "null" : JSON.stringify(projectId)};<\/script><script>\n${loadScript("git-interactions.js")}\n<\/script>`;

  return nav +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header"><h5 class="mb-0"><i class="fas fa-code-branch me-2"></i>Git</h5></div>' +
      '<div class="card-body">' +
        projectTabs +
        conflictSection +
        summary +
        sectionCard("Staged", "fa-plus-circle", stagedTable, '<button id="btn-unstage-all" class="btn btn-outline-secondary btn-sm"><i class="fas fa-minus-circle me-1"></i>Unstage all</button>') +
        sectionCard("Modified", "fa-pen", unstagedTable, '<button id="btn-stage-modified" class="btn btn-outline-primary btn-sm"><i class="fas fa-plus me-1"></i>Stage all</button>') +
        sectionCard("Untracked", "fa-question-circle", untrackedTable, '<button id="btn-stage-untracked" class="btn btn-outline-primary btn-sm"><i class="fas fa-plus me-1"></i>Stage all</button>') +
        sectionCard("Commit", "fa-save", '<div class="input-group input-group-sm mb-2"><input type="text" id="git-commit-msg" class="form-control" placeholder="Commit message..."><button id="btn-git-commit" class="btn btn-primary"><i class="fas fa-save me-1"></i>Commit</button></div><div class="small text-muted">' + (staged.length ? `${staged.length} file(s) staged and ready to commit.` : 'Stage files first, then commit.') + '</div>') +
        sectionCard("Remote", "fa-cloud", '<div class="d-flex flex-wrap align-items-center" style="gap:.5rem"><button id="btn-git-pull" class="btn btn-sm btn-outline-info"><i class="fas fa-download me-1"></i>Pull' + (status && status.behind > 0 ? ` (${status.behind})` : '') + '</button><button id="btn-git-push" class="btn btn-sm btn-outline-success"><i class="fas fa-upload me-1"></i>Push' + (status && status.ahead > 0 ? ` (${status.ahead})` : '') + '</button><button id="btn-git-fetch" class="btn btn-sm btn-outline-secondary"><i class="fas fa-sync me-1"></i>Fetch</button><button id="btn-git-stash" class="btn btn-sm btn-outline-warning"><i class="fas fa-archive me-1"></i>Stash</button><button id="btn-git-stash-pop" class="btn btn-sm btn-outline-warning"><i class="fas fa-archive me-1"></i>Stash pop</button></div>') +
        sectionCard("Branches", "fa-code-branch", '<div id="create-branch-form" class="card card-body bg-light mb-3" style="display:none"><div class="d-flex align-items-center flex-wrap" style="gap:.5rem"><input type="text" id="new-branch-name" class="form-control form-control-sm" placeholder="Branch name (e.g. feature/new-views)" style="max-width:280px" /><button id="btn-do-create-branch" class="btn btn-primary btn-sm"><i class="fas fa-code-branch me-1"></i>Create branch + tenant</button><button id="btn-cancel-branch" class="btn btn-outline-secondary btn-sm">Cancel</button></div><div class="small text-muted mt-1">Creates a git branch, clones the current tenant to a new schema with all data.</div><div id="create-branch-status" class="mt-2" style="display:none"></div></div>' + branchTable, '<button id="btn-create-branch" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New branch</button>') +
        sectionCard("Recent commits", "fa-history", logTable) +
        script +
      '</div>' +
    '</div>';
}

module.exports = { renderGitPage };
