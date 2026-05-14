/**
 * Live Diff + Plan Preview page renderers.
 */
const {
  escapeHtml, card, statCard, emptyState, filterableTable, pageShell,
  diffIcon, diffRow, kindIcon, kindLabel, actionIcon, fullTable,
  renderTabBar, renderTabPane, badge, statusBadge, countBadge,
} = require("../../ui");
const { diffCount, timeAgo } = require("../helpers");
const { configuredProjectRoot } = require("../config");
const {
  loadManifest, enrichWithGitInfo, readSyncMeta,
  computeFileSyncStatus, stampSyncMeta,
} = require("../../manifest");
const { pullObjectToDisk, safeFileName } = require("../../project-io");
const { loadScript } = require("./_shared");

// ─── Sync button ───────────────────────────────────────────

function renderSyncButton(objKind, diffKind, name, changes, direction) {
  var escaped = escapeHtml(name);
  var kindEsc = escapeHtml(objKind);
  var dir = direction || "pull";
  var isToFiles = dir === "pull";
  var btnClass = isToFiles ? "btn-outline-primary" : "btn-outline-success";
  var icon = isToFiles ? "fa-file-import" : "fa-cloud-upload-alt";
  var cssAction = isToFiles ? "pull" : "push";
  var label = isToFiles ? "\u2192 Files" : "\u2192 Live";
  var title = isToFiles ? "Traer del live a files" : "Aplicar a live";

  if (diffKind === "orphaned") {
    if (!isToFiles) return '<span class="text-muted">\u2014</span>';
    return '<button class="btn ' + btnClass + ' btn-sm ' + cssAction + '-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
  }
  if (diffKind === "updated") {
    var fullBtn = '<button class="btn ' + btnClass + ' btn-sm ' + cssAction + '-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
    if (!changes) return fullBtn;
    var toFilesProps = [
      ...(changes.changed || []).map(function(c){ return c.key; }),
      ...(changes.removed || []).map(function(c){ return c.key; }),
    ];
    var toLiveProps = [
      ...(changes.changed || []).map(function(c){ return c.key; }),
      ...(changes.added || []).map(function(c){ return c.key; }),
    ];
    var props = isToFiles ? toFilesProps : toLiveProps;
    if (props.length <= 1) return fullBtn;
    var propBtns = props.map(function(p){
      return '<a class="dropdown-item ' + cssAction + '-prop-btn" href="#" data-kind="' + kindEsc + '" data-name="' + escaped + '" data-prop="' + escapeHtml(p) + '">' + escapeHtml(p) + '</a>';
    }).join("");
    return '<div class="btn-group btn-group-sm" style="flex-wrap:nowrap">' +
      fullBtn +
      '<button class="btn ' + btnClass + ' btn-sm dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false"><span class="visually-hidden">Props</span></button>' +
      '<ul class="dropdown-menu">' + propBtns + '</ul>' +
    '</div>';
  }
  if (diffKind === "created") {
    if (!isToFiles) {
      return '<button class="btn ' + btnClass + ' btn-sm push-btn" data-kind="' + kindEsc + '" data-name="' + escaped + '" title="' + title + '"><i class="fas ' + icon + ' me-1"></i>' + label + '</button>';
    }
    return '<span class="text-muted">\u2014</span>';
  }
  return "";
}

// ─── Project sync meta ─────────────────────────────────────

function renderProjectSyncMeta(projectRoot) {
  let manifest;
  try { manifest = loadManifest(projectRoot); } catch { return ""; }
  const sync = readSyncMeta(manifest);
  const enriched = enrichWithGitInfo(manifest, projectRoot);
  const git = enriched.git;

  const rows = [];
  rows.push([
    '<i class="fas fa-code-branch me-1"></i>Versi\u00f3n',
    '<div class="d-flex align-items-center" style="gap:4px">' +
      '<code id="version-display">' + escapeHtml(manifest.version || "?") + '</code>' +
      '<input type="text" class="form-control form-control-sm d-none" id="version-input" value="' + escapeHtml(manifest.version || "") + '" style="width:100px" />' +
      '<button class="btn btn-outline-secondary btn-sm py-0 px-1" id="version-edit-btn" title="Editar versi\u00f3n"><i class="fas fa-pen" style="font-size:10px"></i></button>' +
      '<button class="btn btn-outline-success btn-sm py-0 px-1 d-none" id="version-save-btn" title="Guardar"><i class="fas fa-check" style="font-size:10px"></i></button>' +
      '<button class="btn btn-outline-secondary btn-sm py-0 px-1 d-none" id="version-cancel-btn" title="Cancelar"><i class="fas fa-times" style="font-size:10px"></i></button>' +
    '</div>',
  ]);
  if (git) {
    let gitHtml = '<span class="badge bg-secondary">' + escapeHtml(git.branch) + '</span>';
    gitHtml += ' @ <code>' + escapeHtml(git.commit || "?") + '</code>';
    if (git.dirty) gitHtml += ' <span class="badge bg-warning text-dark">dirty</span>';
    rows.push(['Git', gitHtml]);
  }
  if (sync.last_sync) {
    const ago = timeAgo(new Date(sync.last_sync));
    let syncHtml = '<span title="' + escapeHtml(sync.last_sync) + '">' + escapeHtml(ago) + '</span>';
    if (sync.last_sync_commit) syncHtml += ' @ <code>' + escapeHtml(sync.last_sync_commit) + '</code>';
    rows.push(['\u00daltimo sync', syncHtml]);
  } else {
    rows.push(['\u00daltimo sync', '<span class="text-muted">Nunca</span>']);
  }

  const body = rows.map(function(r) {
    return '<tr><td class="text-muted ps-2" style="width:140px">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
  }).join('');
  const toFilesAll = '<button class="btn btn-outline-primary btn-sm" id="full-pull-btn" title="Export all from live to files"><i class="fas fa-file-export me-1"></i>All</button>';
  const toFilesDrift = '<button class="btn btn-outline-primary btn-sm ms-1" id="pull-drift-btn" title="Sync drifted items from live to files"><i class="fas fa-file-import me-1"></i>Drift</button>';
  const toLiveDrift = '<button class="btn btn-outline-success btn-sm ms-1" id="push-drift-btn" title="Apply drifted items from files to live"><i class="fas fa-cloud-upload-alt me-1"></i>Drift</button>';
  const stampBtn = '<button class="btn btn-outline-secondary btn-sm ms-1" id="stamp-sync-btn" title="Mark files and live as aligned"><i class="fas fa-check-double me-1"></i>Sync</button>';
  const gitHint = (git && git.dirty)
    ? '<div class="alert alert-info py-1 px-2 mt-2 mb-0 small"><i class="fas fa-info-circle me-1"></i>Haz <code>git add -A && git commit</code> para registrar los cambios. <a href="/project-sync/git" class="btn btn-outline-dark btn-sm py-0 px-1 ms-1"><i class="fas fa-code-branch me-1"></i>Git panel</a></div>'
    : (git ? '<div class="mt-2"><a href="/project-sync/git" class="btn btn-outline-dark btn-sm py-0 px-1"><i class="fas fa-code-branch me-1"></i>Git panel</a></div>' : '');
  const actions = '<div class="mt-2 d-flex align-items-center flex-wrap" style="gap:.5rem">' +
    '<span class="badge bg-primary bg-opacity-10 text-primary px-2 py-1"><i class="fas fa-file me-1"></i>→ Files</span>' + toFilesAll + toFilesDrift +
    '<span class="mx-1 text-muted">|</span>' +
    '<span class="badge bg-success bg-opacity-10 text-success px-2 py-1"><i class="fas fa-cloud me-1"></i>→ Live</span>' + toLiveDrift +
    '<span class="mx-1 text-muted">|</span>' + stampBtn +
    '</div>' + gitHint;
  return '<table class="table table-sm table-borderless mb-0"><tbody>' + body + '</tbody></table>' + actions;
}

// ─── Diff list ─────────────────────────────────────────────

function renderDiffList(diff, label, objKind, fileStatus) {
  const items = [
    ...(diff.created || []).map((i) => diffRow("", "created", i.name, "In Git, missing live")),
    ...(diff.updated || []).map((i) => diffRow("", "updated", i.key, i.changesText || "Different live shape")),
    ...(diff.orphaned || []).map((i) => diffRow("", "orphaned", i.name, "Live only; preserved by default")),
  ];
  if (!items.length) return '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No drift detected.</div>';

  const rowData = [
    ...(diff.created || []).map((i) => ({ diffKind: "created", name: i.name, meaning: "In Git, missing live", _tag: "created", changes: null })),
    ...(diff.updated || []).map((i) => {
      let direction = "pull";
      if (fileStatus) {
        const safeKey = `${objKind}::${safeFileName(i.key)}`;
        const info = fileStatus.get(safeKey);
        if (info && info.modified_after_sync) direction = "push";
      }
      return { diffKind: "updated", name: i.key, meaning: i.changesText || "Different live shape", _tag: "updated", changes: i.changes || null, direction };
    }),
    ...(diff.orphaned || []).map((i) => ({ diffKind: "orphaned", name: i.name, meaning: "Live only; preserved by default", _tag: "orphaned", changes: null, direction: "pull" })),
  ];

  return filterableTable(`diff-${label}`, [
    { key: "kind", label: "Kind" },
    { key: "name", label: "Name" },
    { key: "meaning", label: "Detail" },
    { key: "action", label: "" },
  ], rowData.map((r) => ({
    kind: `${diffIcon(r._tag)}${escapeHtml(r.diffKind)}`,
    name: `<code>${escapeHtml(r.name)}</code>`,
    meaning: `<small class="text-muted">${escapeHtml(r.meaning)}</small>`,
    action: renderSyncButton(objKind, r.diffKind, r.name, r.changes, r.direction),
    _tag: r._tag,
    status: r.diffKind,
  })), { tags: [{ key: "status", label: "Status" }], emptyMsg: `No ${label} drift.` });
}

// ─── Sub-tab bar ───────────────────────────────────────────

function subTabBar(activeTab) {
  const tabs = [
    { id: "diff", label: '<i class="fas fa-exchange-alt me-1"></i>Diff', href: "/project-sync/live-diff" },
    { id: "plan", label: '<i class="fas fa-tasks me-1"></i>Plan', href: "/project-sync/plan-preview" },
  ];
  const items = tabs.map((t) => {
    const cls = t.id === activeTab ? "btn-primary" : "btn-outline-secondary";
    return '<a href="' + t.href + '" class="btn btn-sm ' + cls + '">' + t.label + '</a>';
  }).join('');
  return '<div class="btn-group btn-group-sm mb-3">' + items + '</div>';
}

// ─── Live Diff page ────────────────────────────────────────

function renderLiveDiff({ diff = null, projectRoot = "", error = null, untracked = [] } = {}) {
  if (!projectRoot) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Live Diff", icon: "fa-exchange-alt", body:
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> on the server to compare Git desired state with the live tenant.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Live Diff", icon: "fa-exchange-alt", body: `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const tableDiff = diff && diff.tables;
  const fieldRows = [];
  for (const fieldDiff of (tableDiff && tableDiff.fieldDiffs) || []) {
    for (const field of fieldDiff.fields.created || []) fieldRows.push({ table: fieldDiff.table, kind: "Created", field: field.name, meaning: "In Git, missing live", status: "Created" });
    for (const field of fieldDiff.fields.updated || []) fieldRows.push({ table: fieldDiff.table, kind: "Updated", field: field.key, meaning: field.changesText || "Different live shape", status: "Updated" });
    for (const field of fieldDiff.fields.orphaned || []) fieldRows.push({ table: fieldDiff.table, kind: "Orphaned", field: field.name, meaning: "Live only; preserved by default", status: "Orphaned" });
  }

  const totals = {
    tables: diffCount((tableDiff && tableDiff.tables) || {}),
    fields: fieldRows.length,
    plugins: diffCount((diff && diff.plugins) || {}),
  };
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) totals[kind] = diffCount(kindDiff);

  const metaSection = card({
    title: "Proyecto",
    icon: "fa-info-circle",
    classExtra: "mb-4",
    body: renderProjectSyncMeta(projectRoot),
  });

  let fileStatus = null;
  try {
    const manifest = loadManifest(projectRoot);
    const sync = readSyncMeta(manifest);
    if (sync.last_sync_epoch) fileStatus = computeFileSyncStatus(projectRoot, sync.last_sync_epoch);
  } catch { /* no manifest = no direction info */ }

  const summaryCards = `<div class="row mb-4">
    ${statCard("Tables", totals.tables, "fa-table", totals.tables ? "warning" : "success")}
    ${statCard("Fields", totals.fields, "fa-columns", totals.fields ? "warning" : "success")}
    ${statCard("Plugins", totals.plugins, "fa-puzzle-piece", totals.plugins ? "warning" : "success")}
    ${statCard("Total drift", Object.values(totals).reduce((a, b) => a + b, 0), "fa-exchange-alt", Object.values(totals).some(v => v > 0) ? "danger" : "success")}
  </div>`;

  const tablesSection = card({
    title: "Tables",
    icon: kindIcon("tables"),
    classExtra: "mb-4",
    body: renderDiffList((tableDiff && tableDiff.tables) || {}, "table", "table", fileStatus),
  });

  const fieldsSection = card({
    title: "Fields",
    icon: "fa-columns",
    classExtra: "mb-4",
    body: fieldRows.length
      ? filterableTable("diff-fields", [
          { key: "table", label: "Table" },
          { key: "kind", label: "Kind" },
          { key: "field", label: "Field" },
          { key: "meaning", label: "Meaning" },
        ], fieldRows.map((r) => ({
          table: `<code>${escapeHtml(r.table)}</code>`,
          kind: `${diffIcon(r.status.toLowerCase())}${escapeHtml(r.kind)}`,
          field: `<code>${escapeHtml(r.field)}</code>`,
          meaning: `<small class="text-muted">${escapeHtml(r.meaning)}</small>`,
          status: r.status,
        })), { tags: [{ key: "status", label: "Status" }] })
      : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No field drift.</div>',
  });

  const kindSections = Object.entries((diff && diff.kinds) || {}).map(([kind, kindDiff]) =>
    card({
      title: kindLabel(kind),
      icon: kindIcon(kind),
      classExtra: "mb-4",
      body: renderDiffList(kindDiff, kind, kind, fileStatus),
    })
  ).join("");

  const pluginsSection = card({
    title: "Plugins",
    icon: kindIcon("plugins"),
    body: renderDiffList((diff && diff.plugins) || {}, "plugin", "plugins", fileStatus),
  });

  const addAllBtn = '<button class="btn btn-primary btn-sm" id="add-all-untracked"><i class="fas fa-plus-circle me-1"></i>Add all to project</button>';
  const untrackedSection = untracked.length
    ? card({
        title: "Untracked",
        icon: "fa-question-circle",
        classExtra: "mb-4",
        headerRight: addAllBtn,
        body: '<div class="alert alert-info py-1 px-2 small mb-2"><i class="fas fa-info-circle me-1"></i>Objects on disk but not included in project scope. Add them to the project to enable sync.</div>' +
          filterableTable("untracked-objects", [
            { key: "kind", label: "Kind" },
            { key: "name", label: "Name" },
            { key: "action", label: "" },
          ], untracked.map((u) => ({
            kind: '<span class="badge bg-secondary">' + escapeHtml(u.kind) + '</span>',
            name: '<code>' + escapeHtml(u.name) + '</code>',
            action: '<button class="btn btn-outline-primary btn-sm add-to-scope-btn" data-kind="' + escapeHtml(u.kind) + '" data-name="' + escapeHtml(u.name) + '"><i class="fas fa-plus-circle me-1"></i>Add to project</button>',
          })))
      })
    : '';

  // ─── Build tabs by kind ────────────────────────────
  const kindTabDefs = [];

  // Tables tab
  if (totals.tables > 0 || true) {
    kindTabDefs.push({ id: 'tables', label: 'Tables', icon: 'fa-table', badge: totals.tables || undefined, badgeColor: totals.tables ? 'warning' : 'success',
      content: tablesSection });
  }
  // Fields tab
  if (totals.fields > 0) {
    kindTabDefs.push({ id: 'fields', label: 'Fields', icon: 'fa-columns', badge: totals.fields, badgeColor: 'warning',
      content: fieldsSection });
  }
  // Per-kind tabs (views, pages, triggers, roles...)
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) {
    const count = diffCount(kindDiff);
    if (count > 0) {
      kindTabDefs.push({ id: kind, label: kindLabel(kind), icon: kindIcon(kind).replace('fa ', ''), badge: count, badgeColor: 'warning',
        content: card({ title: kindLabel(kind), icon: kindIcon(kind), classExtra: '', body: renderDiffList(kindDiff, kind, kind, fileStatus) }) });
    }
  }
  // Plugins tab
  if (totals.plugins > 0) {
    kindTabDefs.push({ id: 'plugins', label: 'Plugins', icon: 'fa-puzzle-piece', badge: totals.plugins, badgeColor: 'warning',
      content: pluginsSection });
  }
  // Untracked tab
  if (untracked.length) {
    kindTabDefs.push({ id: 'untracked', label: 'Untracked', icon: 'fa-question-circle', badge: untracked.length, badgeColor: 'secondary',
      content: untrackedSection });
  }

  const firstActive = kindTabDefs.length ? kindTabDefs[0].id : 'tables';
  const diffTabBar = renderTabBar(
    kindTabDefs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, badge: t.badge, badgeColor: t.badgeColor })),
    firstActive
  );
  const diffTabPanes = kindTabDefs.map((t) =>
    renderTabPane(t.id, t.content, t.id === firstActive)
  ).join('');

  const syncScript = `<script>\n${loadScript("live-diff-sync.js")}\n<\/script>`;

  const tabNav = subTabBar("diff");
  return pageShell("Live Diff", "/project-sync/live-diff",
    card({
      title: "Live Diff",
      subtitle: `Comparing Git state vs. live tenant at <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-exchange-alt",
      iconColor: "warning",
      body: tabNav + `${metaSection}${summaryCards}` +
        diffTabBar +
        `<div class="tab-content border border-top-0 rounded-bottom p-3 bg-white">${diffTabPanes}</div>` +
        syncScript,
    })
  );
}

// ─── Plan Preview page ─────────────────────────────────────

function renderPlanPreview({ plan = null, projectRoot = "", error = null } = {}) {
  const tabNav = subTabBar("plan");
  if (!projectRoot) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Plan", icon: "fa-tasks", body: tabNav +
        '<div class="alert alert-info">Configure <code>SALTCORN_PROJECT_SYNC_PROJECT_ROOT</code> to enable plan previews.</div>'
      })
    );
  }
  if (error) {
    return pageShell("Live Diff", "/project-sync/live-diff",
      card({ title: "Plan", icon: "fa-tasks", body: tabNav +
        `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` })
    );
  }

  const ops = (plan && plan.operations) || [];
  const warnings = (plan && plan.warnings) || [];
  const blocked = (plan && plan.blocked) || [];

  const summaryCards = `<div class="row mb-4">
    ${statCard("Operations", ops.length, "fa-cogs", ops.length ? "primary" : "success")}
    ${statCard("Warnings", warnings.length, "fa-exclamation-triangle", warnings.length ? "warning" : "success")}
    ${statCard("Blocked", blocked.length, "fa-ban", blocked.length ? "danger" : "success")}
    ${statCard("Backup", plan && plan.backup_required ? "Required" : "Not needed", plan && plan.backup_required ? "fa-database" : "fa-check-circle", plan && plan.backup_required ? "warning" : "success")}
  </div>`;

  const blockedSection = blocked.length
    ? `<div class="alert alert-danger"><h6 class="alert-heading"><i class="fas fa-ban me-1"></i>Blocked</h6><ul class="mb-0">${blocked.map((i) => `<li>${escapeHtml(i.reason || JSON.stringify(i))}</li>`).join("")}</ul></div>`
    : '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers.</div>';

  const warningRows = warnings.map((w) => ({
    type: `<i class="fas fa-exclamation-triangle text-warning me-1"></i>${escapeHtml(w.type || "")}`,
    target: escapeHtml(w.table || w.plugin || w.view || w.page || w.trigger || w.role || ""),
  }));
  const warningsSection = warnings.length
    ? filterableTable("plan-warnings", [
        { key: "type", label: "Type" },
        { key: "target", label: "Target" },
      ], warningRows, { emptyMsg: "No warnings." })
    : '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>No warnings.</div>';

  const opRows = ops.map((op) => ({
    action: `${actionIcon(op.action)}<code>${escapeHtml(op.action)}</code>`,
    target: escapeHtml(op.table || op.plugin || op.view || op.page || op.trigger || op.role || op.field || op.from || ""),
    safe: op.safe ? statusBadge(true, "Safe") : statusBadge(false, "Review", "Caution"),
    status: op.safe ? "safe" : "review",
  }));
  const opsSection = ops.length
    ? filterableTable("plan-ops", [
        { key: "action", label: "Action" },
        { key: "target", label: "Target" },
        { key: "safe", label: "Status" },
      ], opRows, { tags: [{ key: "status", label: "Safety" }], emptyMsg: "No operations." })
    : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No operations planned.</div>';

  return pageShell("Live Diff", "/project-sync/live-diff",
    card({
      title: "Plan",
      subtitle: `Project root: <code>${escapeHtml(projectRoot)}</code>`,
      icon: "fa-tasks",
      iconColor: "success",
      body: tabNav + `${summaryCards}${blockedSection}<h6 class="mb-3">Warnings</h6>${warningsSection}<h6 class="mb-3">Operations</h6>${opsSection}`,
    })
  );
}

module.exports = { renderLiveDiff, renderPlanPreview, subTabBar };
