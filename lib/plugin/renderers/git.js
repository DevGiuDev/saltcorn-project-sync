/**
 * Git page renderer.
 */
const {
  alert, button, card, escapeHtml, filterableTable, pageShell,
  badge, emptyState, inputGroup, simpleTable,
  renderTabBar, renderTabPane,
} = require("../../ui");
const { optionalRequire } = require("../../tenant-adapters");
const { loadScript } = require("./_shared");

function renderGitPage({ projectRoot, status, branches, log, remoteUrl, branchMap, error }) {
  if (!projectRoot) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        alert({ color: "info", body: 'Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable Git operations.' })
      })
    );
  }
  if (error) {
    return pageShell("Git", "/project-sync/git",
      card({ title: "Git", icon: "fa-code-branch", body:
        alert({ color: "danger", icon: "fa-exclamation-triangle", body: escapeHtml(error) })
      })
    );
  }

  // Branch info
  const aheadBehindHtml = status && (status.ahead > 0 || status.behind > 0)
    ? '<div class="d-flex align-items-center flex-wrap" style="gap:.3rem">' +
      (status.ahead > 0
        ? `${badge(`${status.ahead} ahead`, "info", { soft: true, icon: "fa-arrow-up" })}` +
          `<span class="text-muted small">(${status.ahead} commit${status.ahead > 1 ? 's' : ''} not pushed)</span>`
        : '') +
      (status.behind > 0
        ? `${badge(`${status.behind} behind`, "warning", { soft: true, icon: "fa-arrow-down" })}` +
          `<span class="text-muted small">(${status.behind} commit${status.behind > 1 ? 's' : ''} not pulled)</span>`
        : '') +
      '</div>'
    : (status && remoteUrl && remoteUrl.ok
      ? badge("Up to date", "success", { soft: true, icon: "fa-check" })
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
          tenantWarningHtml = alert({
            color: "warning",
            icon: null,
            classExtra: "d-flex justify-content-between align-items-center mb-3",
            body: `
              <div>
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Branch/tenant mismatch!</strong><br/>
                <span class="small">Git branch <code>${escapeHtml(currentBranch)}</code> expects tenant <code>${escapeHtml(guard.expected)}</code>, but you're on tenant <code>${escapeHtml(guard.actual)}</code>.</span>
              </div>
              ${button({ href: `${expectedUrl}/project-sync/git`, color: "warning", size: "sm", target: "_blank", icon: "fa-external-link-alt", label: `Open on ${guard.expected}` })}
            `,
          });
        } else if (guard.expected && guard.expected !== 'public') {
          tenantWarningHtml = alert({
            color: "success",
            classExtra: "py-2 mb-3",
            body: `Tenant <code>${escapeHtml(guard.actual)}</code> matches branch <code>${escapeHtml(currentBranch)}</code>`,
            icon: "fa-check-circle",
          });
        }
      }
    } catch { /* no branch-tenant */ }
  }

  const branchHtml = status
    ? `<div class="mb-3">` +
      `<div class="d-flex align-items-center flex-wrap" style="gap:.5rem">` +
      `${badge(status.branch, "secondary", { icon: "fa-code-branch" })}` +
      (remoteUrl && remoteUrl.ok
        ? `<span class="text-muted small"><i class="fas fa-cloud me-1"></i><code>${escapeHtml(remoteUrl.stdout)}</code></span>`
        : '') +
      (status.clean
        ? badge("Clean", "success", { soft: true, icon: "fa-check" })
        : badge("Dirty", "warning", { icon: "fa-pen", textColor: "dark" })) +
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
    ? alert({
        color: "danger",
        classExtra: "mb-3",
        title: "Conflicts:",
        icon: "fa-exclamation-triangle",
        body: `<ul class="mb-0 mt-1">${conflicted.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>`,
      })
    : '';

  const fileTable = (rows, columns) => simpleTable(columns, rows, { compact: true, hover: true });

  const stagedSection = staged.length
    ? card({
        title: `Staged (${staged.length})`,
        icon: 'fa-plus-circle', iconColor: 'success', classExtra: 'mb-3',
        headerRight: button({ id: "btn-unstage-all", color: "secondary", outline: true, size: "sm", icon: "fa-minus-circle", label: "Unstage all" }),
        body: fileTable(
          staged.map((f) => [
            { content: statusIcon(f.status) },
            { content: `<code>${escapeHtml(f.path)}</code>` },
          ]),
          [{ label: "X", width: "30px" }, { label: "File" }]
        ),
      })
    : '';

  const unstagedSection = unstaged.length
    ? card({
        title: `Modified (${unstaged.length})`,
        icon: 'fa-pen', iconColor: 'warning', classExtra: 'mb-3',
        headerRight: button({ id: "btn-stage-modified", color: "primary", outline: true, size: "sm", icon: "fa-plus", label: "Stage all" }),
        body: fileTable(
          unstaged.map((f) => [
            { content: statusIcon(f.status) },
            { content: `<code>${escapeHtml(f.path)}</code>` },
            { content: button({ color: "primary", outline: true, size: "sm", classExtra: "py-0 px-1 stage-btn", icon: "fa-plus", label: "Stage", attrs: { "data-path": f.path } }) },
          ]),
          [{ label: "X", width: "30px" }, { label: "File" }, { label: "", width: "80px" }]
        ),
      })
    : '';

  const untrackedSection = untracked.length
    ? card({
        title: `Untracked (${untracked.length})`,
        icon: 'fa-question-circle', iconColor: 'secondary', classExtra: 'mb-3',
        headerRight: button({ id: "btn-stage-untracked", color: "primary", outline: true, size: "sm", icon: "fa-plus", label: "Stage all" }),
        body: fileTable(
          untracked.map((f) => [
            { content: `<code>${escapeHtml(f)}</code>` },
            { content: button({ color: "primary", outline: true, size: "sm", classExtra: "py-0 px-1 stage-btn", icon: "fa-plus", label: "Stage", attrs: { "data-path": f } }) },
          ]),
          [{ label: "File" }, { label: "", width: "80px" }]
        ),
      })
    : '';

  // Commit section
  const commitSection = card({
    title: 'Commit', icon: 'fa-save', iconColor: 'primary', classExtra: 'mb-3',
    body: `
      ${inputGroup([
        '<input type="text" id="git-commit-msg" class="form-control" placeholder="Commit message..." />',
        button({ id: "btn-git-commit", color: "primary", icon: "fa-save", label: "Commit" }),
      ], { size: "sm", classExtra: "mb-2" })}` +
      (staged.length ? `<div class="text-muted small">${staged.length} file(s) staged and ready to commit.</div>` :
        '<div class="text-muted small">Stage files first, then commit.</div>'),
  });

  // Remote operations
  const remoteSection = card({
    title: 'Remote', icon: 'fa-cloud', iconColor: 'info', classExtra: 'mb-3',
    body: `
      <div class="d-flex flex-wrap align-items-center" style="gap:.5rem">
        ${button({ id: "btn-git-pull", color: "info", outline: !(status && status.behind > 0), size: "sm", icon: "fa-download", label: `Pull${status && status.behind > 0 ? ` (${status.behind})` : ""}` })}
        ${button({ id: "btn-git-push", color: "success", outline: !(status && status.ahead > 0), size: "sm", icon: "fa-upload", label: `Push${status && status.ahead > 0 ? ` (${status.ahead})` : ""}` })}
        ${button({ id: "btn-git-fetch", color: "secondary", outline: true, size: "sm", icon: "fa-sync", label: "Fetch" })}
        <span class="vr"></span>
        ${button({ id: "btn-git-stash", color: "warning", outline: true, size: "sm", icon: "fa-archive", label: "Stash" })}
        ${button({ id: "btn-git-stash-pop", color: "warning", outline: true, size: "sm", icon: "fa-archive", label: "Stash pop" })}
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
        ? `${badge(b, "primary")} ${badge("current", "success", { soft: true })}`
        : badge(b, "secondary"),
      tenant: tenant
        ? badge(tenant, "info", { soft: true, icon: "fa-database" })
        : '<span class="text-muted">—</span>',
      sync: (() => { var ab = aheadBehind[b]; if (!ab) return '<span class="text-muted small">—</span>'; if (ab.ahead === 0 && ab.behind === 0) return badge("Synced", "success", { soft: true, icon: "fa-check" }); var p = []; if (ab.ahead > 0) p.push(badge(String(ab.ahead), "primary", { soft: true, icon: "fa-arrow-up" })); if (ab.behind > 0) p.push(badge(String(ab.behind), "warning", { soft: true, icon: "fa-arrow-down" })); return p.join(' '); })(),
      url: url ? `<a href="http://${url}" target="_blank" class="small">${escapeHtml(url)} <i class="fas fa-external-link-alt fa-xs"></i></a>` : '<span class="text-muted">—</span>',
      actions: (isCurrent ? '<span class="text-muted small">current</span>' :
        `<div class="d-flex flex-wrap" style="gap:.25rem">
          ${button({ color: "secondary", outline: true, size: "sm", classExtra: "py-0 px-2 checkout-btn", icon: "fa-code-branch", label: "Switch", title: "Switch to this branch", attrs: { "data-branch": b } })}` +
        `${button({ color: "primary", outline: true, size: "sm", classExtra: "py-0 px-2 merge-btn", icon: "fa-code-merge", label: `Merge into ${currentBranch}`, title: `Merge ${b} into ${currentBranch}`, attrs: { "data-branch": b } })}` +
        (mapping ? button({ color: "danger", outline: true, size: "sm", classExtra: "py-0 px-2 delete-branch-btn", icon: "fa-trash", label: "Delete", title: "Delete branch and tenant", attrs: { "data-branch": b } }) : '') +
        `</div>`),
      _has_tenant: !!tenant,
    };
  });

  const branchSection = card({
    title: 'Branches', icon: 'fa-code-branch', iconColor: 'secondary', classExtra: 'mb-3',
    headerRight: button({ id: "btn-create-branch", color: "primary", size: "sm", icon: "fa-plus", label: "New branch" }),
    body: `
      <div id="create-branch-form" class="card card-body bg-light mb-3" style="display:none">
        <div class="d-flex align-items-center flex-wrap" style="gap:.5rem">
          <input type="text" id="new-branch-name" class="form-control form-control-sm" placeholder="Branch name (e.g. feature/new-views)" style="max-width:280px" />
          ${button({ id: "btn-do-create-branch", color: "primary", size: "sm", icon: "fa-code-branch", label: "Create branch + tenant" })}
          ${button({ id: "btn-cancel-branch", color: "secondary", outline: true, size: "sm", label: "Cancel" })}
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
      ? alert({ color: "success", classExtra: "py-2", body: 'Nothing to commit, working tree clean.', icon: "fa-check-circle" })
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
      subtitleHtml: `<code>${escapeHtml(projectRoot)}</code>`,
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
