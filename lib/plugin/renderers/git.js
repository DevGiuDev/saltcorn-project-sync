/**
 * Git page renderer.
 */
const {
  escapeHtml, card, statCard, filterableTable, pageShell,
  badge, statusBadge, emptyState, kindIcon,
  renderTabBar, renderTabPane,
} = require("../../ui");
const { optionalRequire } = require("../../tenant-adapters");
const { loadScript } = require("./_shared");

function renderGitPage({ projectRoot, status, branches, log, remoteUrl, branchMap, error }) {
  if (!projectRoot) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable Git operations.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      })
    );
  }

  // Branch info
  const aheadBehindHtml = status && (status.ahead > 0 || status.behind > 0)
    ? '<div class="d-flex align-items-center flex-wrap" style="gap:.3rem">' +
      (status.ahead > 0
        ? `<span class="badge bg-info-lt text-info"><i class="fas fa-arrow-up me-1"></i>${status.ahead} ahead</span>` +
          `<span class="text-muted small">(${status.ahead} commit${status.ahead > 1 ? 's' : ''} not pushed)</span>`
        : '') +
      (status.behind > 0
        ? `<span class="badge bg-orange-lt text-orange"><i class="fas fa-arrow-down me-1"></i>${status.behind} behind</span>` +
          `<span class="text-muted small">(${status.behind} commit${status.behind > 1 ? 's' : ''} not pulled)</span>`
        : '') +
      '</div>'
    : (status && remoteUrl && remoteUrl.ok
      ? '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Up to date</span>'
      : '');

  // Tenant mismatch warning
  let tenantWarningHtml = '';
  const currentBranch = (branches && branches.current) || (status && status.branch) || '';
  if (projectRoot && currentBranch) {
    try {
      const bt = require("../../branch-tenant");
      const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
      if (dbMod) {
        const currentTenant = dbMod.getTenantSchema();
        const guard = bt.guardBranchTenant(projectRoot, currentTenant);
        if (!guard.ok) {
          const expectedUrl = guard.expected === 'public'
            ? 'http://localhost:3000'
            : `http://${guard.expected}.localhost:3000`;
          tenantWarningHtml = `
            <div class="alert alert-warning d-flex justify-content-between align-items-center mb-3">
              <div>
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Branch/tenant mismatch!</strong><br/>
                <span class="small">Git branch <code>${escapeHtml(currentBranch)}</code> expects tenant <code>${escapeHtml(guard.expected)}</code>, but you're on tenant <code>${escapeHtml(guard.actual)}</code>.</span>
              </div>
              <a href="${expectedUrl}/project-sync/git" class="btn btn-warning btn-sm" target="_blank">
                <i class="fas fa-external-link-alt me-1"></i>Open on ${escapeHtml(guard.expected)}
              </a>
            </div>`;
        } else if (guard.expected && guard.expected !== 'public') {
          tenantWarningHtml = `
            <div class="alert alert-success py-2 mb-3">
              <i class="fas fa-check-circle me-1"></i>
              Tenant <code>${escapeHtml(guard.actual)}</code> matches branch <code>${escapeHtml(currentBranch)}</code>
            </div>`;
        }
      }
    } catch { /* no branch-tenant */ }
  }

  const branchHtml = status
    ? `<div class="mb-3">` +
      `<div class="d-flex align-items-center flex-wrap" style="gap:.5rem">` +
      `<span class="badge bg-secondary"><i class="fas fa-code-branch me-1"></i>${escapeHtml(status.branch)}</span>` +
      (remoteUrl && remoteUrl.ok
        ? `<span class="text-muted small"><i class="fas fa-cloud me-1"></i><code>${escapeHtml(remoteUrl.stdout)}</code></span>`
        : '') +
      (status.clean
        ? '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Clean</span>'
        : '<span class="badge bg-warning text-dark"><i class="fas fa-pen me-1"></i>Dirty</span>') +
      `</div>` +
      (aheadBehindHtml ? `<div class="mt-1">${aheadBehindHtml}</div>` : '') +
      `</div>`
    : '';

  // File lists
  const staged = (status && status.staged) || [];
  const unstaged = (status && status.unstaged) || [];
  const untracked = (status && status.untracked) || [];
  const conflicted = (status && status.conflicted) || [];

  const statusIcon = (s) => {
    switch (s) {
      case 'M': return '<span class="text-warning" title="Modified">M</span>';
      case 'A': return '<span class="text-success" title="Added">A</span>';
      case 'D': return '<span class="text-danger" title="Deleted">D</span>';
      case 'R': return '<span class="text-info" title="Renamed">R</span>';
      default: return '<span class="text-muted" title="' + escapeHtml(s) + '">' + escapeHtml(s) + '</span>';
    }
  };

  const conflictedSection = conflicted.length
    ? `<div class="alert alert-danger mb-3"><strong><i class="fas fa-exclamation-triangle me-1"></i>Conflicts:</strong><ul class="mb-0 mt-1">${conflicted.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")} </ul></div>`
    : '';

  const stagedSection = staged.length
    ? card({
        title: `Staged (${staged.length})`,
        icon: 'fa-plus-circle', iconColor: 'success', classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-secondary btn-sm" id="btn-unstage-all"><i class="fas fa-minus-circle me-1"></i>Unstage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th style="width:30px">X</th><th>File</th></tr></thead><tbody>${staged.map((f) =>
          `<tr><td>${statusIcon(f.status)}</td><td><code>${escapeHtml(f.path)}</code></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  const unstagedSection = unstaged.length
    ? card({
        title: `Modified (${unstaged.length})`,
        icon: 'fa-pen', iconColor: 'warning', classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-primary btn-sm" id="btn-stage-modified"><i class="fas fa-plus me-1"></i>Stage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th style="width:30px">X</th><th>File</th><th style="width:80px"></th></tr></thead><tbody>${unstaged.map((f) =>
          `<tr><td>${statusIcon(f.status)}</td><td><code>${escapeHtml(f.path)}</code></td><td><button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(f.path)}"><i class="fas fa-plus me-1"></i>Stage</button></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  const untrackedSection = untracked.length
    ? card({
        title: `Untracked (${untracked.length})`,
        icon: 'fa-question-circle', iconColor: 'secondary', classExtra: 'mb-3',
        headerRight: '<button class="btn btn-outline-primary btn-sm" id="btn-stage-untracked"><i class="fas fa-plus me-1"></i>Stage all</button>',
        body: `<table class="table table-sm table-hover mb-0"><thead><tr><th>File</th><th style="width:80px"></th></tr></thead><tbody>${untracked.map((f) =>
          `<tr><td><code>${escapeHtml(f)}</code></td><td><button class="btn btn-outline-primary btn-sm py-0 px-1 stage-btn" data-path="${escapeHtml(f)}"><i class="fas fa-plus me-1"></i>Stage</button></td></tr>`
        ).join("")} </tbody></table>`,
      })
    : '';

  // Commit section
  const commitSection = card({
    title: 'Commit', icon: 'fa-save', iconColor: 'primary', classExtra: 'mb-3',
    body: `
      <div class="input-group input-group-sm mb-2">
        <input type="text" id="git-commit-msg" class="form-control" placeholder="Commit message..." />
        <button class="btn btn-primary" id="btn-git-commit"><i class="fas fa-save me-1"></i>Commit</button>
      </div>` +
      (staged.length ? `<div class="text-muted small">${staged.length} file(s) staged and ready to commit.</div>` :
        '<div class="text-muted small">Stage files first, then commit.</div>'),
  });

  // Remote operations
  const remoteSection = card({
    title: 'Remote', icon: 'fa-cloud', iconColor: 'info', classExtra: 'mb-3',
    body: `
      <div class="d-flex flex-wrap align-items-center" style="gap:.5rem">
        <button class="btn ${status && status.behind > 0 ? 'btn-info' : 'btn-outline-info'} btn-sm" id="btn-git-pull"><i class="fas fa-download me-1"></i>Pull${status && status.behind > 0 ? ' (' + status.behind + ')' : ''}</button>
        <button class="btn ${status && status.ahead > 0 ? 'btn-success' : 'btn-outline-success'} btn-sm" id="btn-git-push"><i class="fas fa-upload me-1"></i>Push${status && status.ahead > 0 ? ' (' + status.ahead + ')' : ''}</button>
        <button class="btn btn-outline-secondary btn-sm" id="btn-git-fetch"><i class="fas fa-sync me-1"></i>Fetch</button>
        <span class="vr"></span>
        <button class="btn btn-outline-warning btn-sm" id="btn-git-stash"><i class="fas fa-archive me-1"></i>Stash</button>
        <button class="btn btn-outline-warning btn-sm" id="btn-git-stash-pop"><i class="fas fa-archive me-1"></i>Stash pop</button>
      </div>`,
  });

  // Branch switcher
  const allBranches = (branches && branches.local) || [];
  const bMap = branchMap || {};

  let aheadBehind = {};
  try {
    const gitOps = require("../../git-ops");
    aheadBehind = gitOps.gitAheadBehind(projectRoot, allBranches);
  } catch { /* ignore */ }

  const branchRows = allBranches.map((b) => {
    const mapping = bMap[b] || null;
    const isCurrent = b === currentBranch;
    const tenant = mapping ? mapping.tenant : null;
    let url = '';
    if (tenant) {
      const base = (remoteUrl && remoteUrl.ok) ? '' : 'http://localhost:3000';
      url = `${tenant}.localhost` + (base.includes(':') ? ':' + base.split(':').pop() : ':3000');
    }
    return {
      name: isCurrent
        ? `<span class="badge bg-primary">${escapeHtml(b)}</span> <span class="badge bg-success-lt">current</span>`
        : `<span class="badge bg-secondary">${escapeHtml(b)}</span>`,
      tenant: tenant
        ? `<span class="badge bg-info-lt text-info">${escapeHtml(tenant)}</span>`
        : '<span class="text-muted">—</span>',
      sync: (() => { var ab = aheadBehind[b]; if (!ab) return '<span class="text-muted small">—</span>'; if (ab.ahead === 0 && ab.behind === 0) return '<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>Synced</span>'; var p = []; if (ab.ahead > 0) p.push('<span class="badge bg-primary-lt"><i class="fas fa-arrow-up me-1"></i>' + ab.ahead + '</span>'); if (ab.behind > 0) p.push('<span class="badge bg-warning-lt"><i class="fas fa-arrow-down me-1"></i>' + ab.behind + '</span>'); return p.join(' '); })(),
      url: url ? `<a href="http://${url}" target="_blank" class="small">${escapeHtml(url)} <i class="fas fa-external-link-alt fa-xs"></i></a>` : '<span class="text-muted">—</span>',
      actions: (isCurrent ? '<span class="text-muted small">current</span>' :
        `<div class="d-flex flex-wrap" style="gap:.25rem">
          <button class="btn btn-outline-secondary btn-sm py-0 px-2 checkout-btn" data-branch="${escapeHtml(b)}" title="Switch to this branch"><i class="fas fa-code-branch me-1"></i>Switch</button>` +
        `<button class="btn btn-outline-primary btn-sm py-0 px-2 merge-btn" data-branch="${escapeHtml(b)}" title="Merge ${escapeHtml(b)} into ${escapeHtml(currentBranch)}"><i class="fas fa-code-merge me-1"></i>Merge into ${escapeHtml(currentBranch)}</button>` +
        (mapping ? `<button class="btn btn-outline-danger btn-sm py-0 px-2 delete-branch-btn" data-branch="${escapeHtml(b)}" title="Delete branch and tenant"><i class="fas fa-trash me-1"></i>Delete</button>` : '') +
        `</div>`),
      _has_tenant: !!tenant,
    };
  });

  const branchSection = card({
    title: 'Branches', icon: 'fa-code-branch', iconColor: 'secondary', classExtra: 'mb-3',
    headerRight: '<button class="btn btn-primary btn-sm" id="btn-create-branch"><i class="fas fa-plus me-1"></i>New branch</button>',
    body: `
      <div id="create-branch-form" class="card card-body bg-light mb-3" style="display:none">
        <div class="d-flex align-items-center flex-wrap" style="gap:.5rem">
          <input type="text" id="new-branch-name" class="form-control form-control-sm" placeholder="Branch name (e.g. feature/new-views)" style="max-width:280px" />
          <button class="btn btn-primary btn-sm" id="btn-do-create-branch"><i class="fas fa-code-branch me-1"></i>Create branch + tenant</button>
          <button class="btn btn-outline-secondary btn-sm" id="btn-cancel-branch">Cancel</button>
        </div>
        <div class="small text-muted mt-1">Creates a git branch, clones the current tenant to a new schema with all data. You'll be able to login with the same credentials on the new subdomain.</div>
        <div id="create-branch-status" class="mt-2" style="display:none"></div>
      </div>` +
      filterableTable('git-branches', [
        { key: 'name', label: 'Branch' },
        { key: 'tenant', label: 'Tenant' },
        { key: 'sync', label: 'Sync' },
        { key: 'url', label: 'URL' },
        { key: 'actions', label: '' },
      ], branchRows, {
        tags: [{ key: '_has_tenant', label: 'Has tenant' }],
        emptyMsg: 'No branches.',
      }),
  });

  // Log
  const commits = (log && log.commits) || [];
  const logRows = commits.map((c) => ({
    hash: `<code>${escapeHtml(c.hash)}</code>`,
    message: escapeHtml(c.message),
    author: `<span class="text-muted">${escapeHtml(c.author)}</span>`,
    date: `<span class="text-muted">${escapeHtml(c.date)}</span>`,
  }));

  const logSection = card({
    title: 'Recent commits', icon: 'fa-history', iconColor: 'dark',
    body: commits.length
      ? filterableTable('git-log', [
          { key: 'hash', label: 'Hash' },
          { key: 'message', label: 'Message' },
          { key: 'author', label: 'Author' },
          { key: 'date', label: 'Date' },
        ], logRows, { searchable: false, emptyMsg: 'No commits.' })
      : '<div class="text-muted">No commits found.</div>',
  });

  // ─── Tab: Working Tree ──────────────────────────────
  const workingTreePane = renderTabPane('working-tree',
    conflictedSection +
    stagedSection +
    unstagedSection +
    untrackedSection +
    (!staged.length && !unstaged.length && !untracked.length && !conflicted.length
      ? '<div class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i>Nothing to commit, working tree clean.</div>'
      : ''),
    true
  );

  // ─── Tab: Commit & Remote ────────────────────────────
  const commitRemotePane = renderTabPane('commit-remote',
    commitSection +
    remoteSection
  );

  // ─── Tab: Branches ───────────────────────────────────
  const branchesPane = renderTabPane('branches',
    branchSection
  );

  // ─── Tab: History ────────────────────────────────────
  const historyPane = renderTabPane('history',
    logSection
  );

  const stagedCount = staged.length;
  const behindCount = status && status.behind || 0;
  const aheadCount = status && status.ahead || 0;
  const dirtyCount = unstaged.length + untracked.length + conflicted.length;

  const tabBar = renderTabBar([
    { id: 'working-tree', label: 'Working Tree', icon: 'fa-folder-open', badge: dirtyCount || stagedCount || undefined, badgeColor: dirtyCount ? 'warning' : 'success' },
    { id: 'commit-remote', label: 'Commit & Remote', icon: 'fa-cloud-upload-alt', badge: aheadCount || behindCount || undefined, badgeColor: aheadCount ? 'info' : behindCount ? 'warning' : undefined },
    { id: 'branches', label: 'Branches', icon: 'fa-code-branch' },
    { id: 'history', label: 'History', icon: 'fa-history' },
  ], 'working-tree');

  const gitScript = `<script>\n${loadScript("git-interactions.js")}\n<\/script>`;

  return pageShell("Git", "/project-sync/git",
    card({
      title: "Git",
      subtitle: `<code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-code-branch",
      iconColor: "dark",
      body:
        branchHtml +
        tenantWarningHtml +
        tabBar +
        `<div class="tab-content border border-top-0 rounded-bottom p-3 bg-white">` +
        workingTreePane +
        commitRemotePane +
        branchesPane +
        historyPane +
        `</div>` +
        gitScript,
    })
  );
}

module.exports = { renderGitPage };
