const { diffCount, timeAgo } = require("../helpers");
const {
  loadManifest, enrichWithGitInfo, readSyncMeta,
  computeFileSyncStatus,
} = require("../../manifest");
const { safeFileName } = require("../../project-io");
const { renderFilterableTable, escapeHtml, icon, globalNav, projectNav, loadScript } = require("./_shared");

function sectionCard(title, iconName, body) {
  return '<div class="card mb-4"><div class="card-header"><h6 class="mb-0"><i class="fas ' + iconName + ' me-2"></i>' + escapeHtml(title) + '</h6></div><div class="card-body">' + body + '</div></div>';
}

function diffBadge(kind) {
  const map = {
    created: '<span class="badge bg-success">created</span>',
    updated: '<span class="badge bg-warning text-dark">updated</span>',
    orphaned: '<span class="badge bg-danger">orphaned</span>',
  };
  return map[kind] || `<span class="badge bg-secondary">${escapeHtml(kind)}</span>`;
}

function renderSyncButton(objKind, diffKind, name, changes, direction) {
  const escaped = escapeHtml(name);
  const kindEsc = escapeHtml(objKind);
  const dir = direction || "pull";
  const isToFiles = dir === "pull";
  const btnClass = isToFiles ? "btn-outline-primary" : "btn-outline-success";
  const iconName = isToFiles ? "fa-file-import" : "fa-cloud-upload-alt";
  const cssAction = isToFiles ? "pull" : "push";
  const label = isToFiles ? "→ Files" : "→ Live";

  if (diffKind === "orphaned") {
    if (!isToFiles) return '<span class="text-muted">—</span>';
    return `<button class="btn ${btnClass} btn-sm ${cssAction}-btn" data-kind="${kindEsc}" data-name="${escaped}"><i class="fas ${iconName} me-1"></i>${label}</button>`;
  }
  if (diffKind === "created") {
    if (!isToFiles) return `<button class="btn ${btnClass} btn-sm push-btn" data-kind="${kindEsc}" data-name="${escaped}"><i class="fas ${iconName} me-1"></i>${label}</button>`;
    return '<span class="text-muted">—</span>';
  }
  if (diffKind === "updated") {
    const fullBtn = `<button class="btn ${btnClass} btn-sm ${cssAction}-btn" data-kind="${kindEsc}" data-name="${escaped}"><i class="fas ${iconName} me-1"></i>${label}</button>`;
    if (!changes) return fullBtn;
    const props = isToFiles
      ? [...(changes.changed || []).map((c) => c.key), ...(changes.removed || []).map((c) => c.key)]
      : [...(changes.changed || []).map((c) => c.key), ...(changes.added || []).map((c) => c.key)];
    if (props.length <= 1) return fullBtn;
    return '<div class="btn-group btn-group-sm">' +
      fullBtn +
      '<button class="btn ' + btnClass + ' btn-sm dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown"><span class="visually-hidden">Props</span></button>' +
      '<ul class="dropdown-menu">' + props.map((p) => `<li><a class="dropdown-item ${cssAction}-prop-btn" href="#" data-kind="${kindEsc}" data-name="${escaped}" data-prop="${escapeHtml(p)}">${escapeHtml(p)}</a></li>`).join("") + '</ul>' +
    '</div>';
  }
  return "";
}

function renderProjectMeta(projectRoot, projectId = "") {
  let manifest;
  try {
    manifest = loadManifest(projectRoot);
  } catch {
    return "";
  }
  const sync = readSyncMeta(manifest);
  const git = enrichWithGitInfo(manifest, projectRoot).git;
  const projectQuery = projectId !== undefined && projectId !== null && String(projectId) !== "" ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const lastSync = sync.last_sync ? `<span title="${escapeHtml(sync.last_sync)}">${escapeHtml(timeAgo(new Date(sync.last_sync)))}</span>` : '<span class="text-muted">Never</span>';
  return `
    <table class="table table-sm table-borderless mb-3">
      <tbody>
        <tr>
          <td class="text-muted" style="width:140px">Version</td>
          <td>
            <div class="d-flex align-items-center" style="gap:4px">
              <code id="version-display">${escapeHtml(manifest.version || "?")}</code>
              <input type="text" class="form-control form-control-sm d-none" id="version-input" value="${escapeHtml(manifest.version || "")}" style="width:100px" />
              <button class="btn btn-outline-secondary btn-sm py-0 px-1" id="version-edit-btn"><i class="fas fa-pen" style="font-size:10px"></i></button>
              <button class="btn btn-outline-success btn-sm py-0 px-1 d-none" id="version-save-btn"><i class="fas fa-check" style="font-size:10px"></i></button>
              <button class="btn btn-outline-secondary btn-sm py-0 px-1 d-none" id="version-cancel-btn"><i class="fas fa-times" style="font-size:10px"></i></button>
            </div>
          </td>
        </tr>
        <tr><td class="text-muted">Git</td><td>${git ? `<span class="badge bg-secondary">${escapeHtml(git.branch)}</span> @ <code>${escapeHtml(git.commit || "?")}</code>${git.dirty ? ' <span class="badge bg-warning text-dark">dirty</span>' : ''}` : '<span class="text-muted">Unknown</span>'}</td></tr>
        <tr><td class="text-muted">Last sync</td><td>${lastSync}${sync.last_sync_commit ? ` @ <code>${escapeHtml(sync.last_sync_commit)}</code>` : ""}</td></tr>
      </tbody>
    </table>
    <div class="d-flex align-items-center flex-wrap" style="gap:.5rem">
      <button class="btn btn-outline-primary btn-sm" id="full-pull-btn"><i class="fas fa-file-export me-1"></i>All</button>
      <button class="btn btn-outline-primary btn-sm" id="pull-drift-btn"><i class="fas fa-file-import me-1"></i>Drift</button>
      <button class="btn btn-outline-success btn-sm" id="push-drift-btn"><i class="fas fa-cloud-upload-alt me-1"></i>Drift</button>
      <button class="btn btn-outline-secondary btn-sm" id="stamp-sync-btn"><i class="fas fa-check-double me-1"></i>Sync</button>
      <a href="/project-sync/git${projectQuery}" class="btn btn-outline-dark btn-sm"><i class="fas fa-code-branch me-1"></i>Git panel</a>
    </div>`;
}

function diffRowsFor(kind, diff, fileStatus) {
  return [
    ...(diff.created || []).map((item) => ({ kind: diffBadge("created"), name: item.name, meaning: "In Git, missing live", action: renderSyncButton(kind, "created", item.name, null, "push") })),
    ...(diff.updated || []).map((item) => {
      let direction = "pull";
      if (fileStatus) {
        const info = fileStatus.get(`${kind}::${safeFileName(item.key)}`);
        if (info && info.modified_after_sync) direction = "push";
      }
      return { kind: diffBadge("updated"), name: item.key, meaning: item.changesText || "Different live shape", action: renderSyncButton(kind, "updated", item.key, item.changes || null, direction) };
    }),
    ...(diff.orphaned || []).map((item) => ({ kind: diffBadge("orphaned"), name: item.name, meaning: "Live only; preserved by default", action: renderSyncButton(kind, "orphaned", item.name, null, "pull") })),
  ];
}

function renderDiffTable(kind, diff, fileStatus) {
  const rows = diffRowsFor(kind, diff, fileStatus);
  if (!rows.length) return '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No drift detected.</div>';
  return renderFilterableTable(`diff-table-${kind}`, [
    { key: (row) => row.kind, label: "Kind" },
    { key: (row) => `<code>${escapeHtml(row.name)}</code>`, label: "Name" },
    { key: (row) => `<small class="text-muted">${escapeHtml(row.meaning)}</small>`, label: "Detail" },
    { key: (row) => row.action, label: "", filter: false },
  ], rows, { hover: true, class: "table-bordered" });
}

function renderLiveDiff({ diff = null, projectRoot = "", projectId = "", error = null, untracked = [] } = {}) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "live-diff" });
  const missingRootError = error === "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" || error === "Project has no root_path";
  if (!projectRoot) {
    const body = error && !missingRootError
      ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      : (projectId
        ? '<div class="alert alert-info">This project has no <code>root_path</code> yet. Open the project and set the folder first, then come back to Live Diff.</div>'
        : '<div class="alert alert-info">Choose a project first. Live Diff now lives with a project because it needs a selected Git root.</div><a href="/project-sync/projects" class="btn btn-outline-primary btn-sm mt-2"><i class="fas fa-folder-open me-1"></i>Open projects</a>');
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-exchange-alt me-2"></i>Live Diff</h5></div><div class="card-body">' + projectTabs + body + '</div></div>';
  }
  if (error) {
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-exchange-alt me-2"></i>Live Diff</h5></div><div class="card-body">' + projectTabs + `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` + '</div></div>';
  }

  const tableDiff = diff && diff.tables;
  const fieldRows = [];
  for (const fieldDiff of (tableDiff && tableDiff.fieldDiffs) || []) {
    for (const field of fieldDiff.fields.created || []) fieldRows.push({ table: fieldDiff.table, kind: diffBadge("created"), field: field.name, meaning: "In Git, missing live" });
    for (const field of fieldDiff.fields.updated || []) fieldRows.push({ table: fieldDiff.table, kind: diffBadge("updated"), field: field.key, meaning: field.changesText || "Different live shape" });
    for (const field of fieldDiff.fields.orphaned || []) fieldRows.push({ table: fieldDiff.table, kind: diffBadge("orphaned"), field: field.name, meaning: "Live only; preserved by default" });
  }

  const totals = {
    tables: diffCount((tableDiff && tableDiff.tables) || {}),
    fields: fieldRows.length,
    plugins: diffCount((diff && diff.plugins) || {}),
  };
  for (const [kind, kindDiff] of Object.entries((diff && diff.kinds) || {})) totals[kind] = diffCount(kindDiff);

  let fileStatus = null;
  try {
    const manifest = loadManifest(projectRoot);
    const sync = readSyncMeta(manifest);
    if (sync.last_sync_epoch) fileStatus = computeFileSyncStatus(projectRoot, sync.last_sync_epoch);
  } catch {
  }

  const summary = `<div class="row mb-4"><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Tables</div><div class="h4 mb-0">${totals.tables}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Fields</div><div class="h4 mb-0">${totals.fields}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Plugins</div><div class="h4 mb-0">${totals.plugins}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Total drift</div><div class="h4 mb-0">${Object.values(totals).reduce((a, b) => a + b, 0)}</div></div></div></div>`;

  const fieldsTable = fieldRows.length ? renderFilterableTable("diff-fields-table", [
    { key: (row) => `<code>${escapeHtml(row.table)}</code>`, label: "Table" },
    { key: (row) => row.kind, label: "Kind" },
    { key: (row) => `<code>${escapeHtml(row.field)}</code>`, label: "Field" },
    { key: (row) => `<small class="text-muted">${escapeHtml(row.meaning)}</small>`, label: "Meaning" },
  ], fieldRows, { hover: true, class: "table-bordered" }) : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No field drift detected.</div>';

  const kindCards = Object.entries((diff && diff.kinds) || {}).map(([kind, kindDiff]) => sectionCard(kind[0].toUpperCase() + kind.slice(1), "fa-folder", renderDiffTable(kind, kindDiff, fileStatus))).join("");
  const pluginCard = sectionCard("Plugins", "fa-puzzle-piece", renderDiffTable("plugins", (diff && diff.plugins) || {}, fileStatus));
  const tableCard = sectionCard("Tables", "fa-table", renderDiffTable("tables", (tableDiff && tableDiff.tables) || {}, fileStatus));
  const fieldCard = sectionCard("Fields", "fa-columns", fieldsTable);

  const untrackedCard = sectionCard("Untracked objects", "fa-binoculars", untracked.length
    ? '<div class="mb-3"><button id="add-all-untracked" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>Add all to scope</button></div>' + renderFilterableTable("diff-untracked-table", [
        { key: (row) => `<code>${escapeHtml(row.kind)}</code>`, label: "Kind" },
        { key: (row) => `<code>${escapeHtml(row.name)}</code>`, label: "Name" },
        { key: (row) => `<button class="btn btn-outline-primary btn-sm add-to-scope-btn" data-kind="${escapeHtml(row.kind)}" data-name="${escapeHtml(row.name)}"><i class="fas fa-plus me-1"></i>Add to scope</button>`, label: "", filter: false },
      ], untracked, { hover: true, class: "table-bordered" })
    : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No untracked objects outside scope.</div>');

  const script = `<script>window.SCPS_LIVE_DIFF_PROJECT_ID = ${projectId == null ? "null" : JSON.stringify(projectId)};<\/script><script>\n${loadScript("live-diff-sync.js")}\n<\/script>`;

  return nav +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header"><h5 class="mb-0"><i class="fas fa-exchange-alt me-2"></i>Live Diff</h5><div class="small text-muted mt-1">Project root: <code>' + escapeHtml(projectRoot) + '</code></div></div>' +
      '<div class="card-body">' +
        projectTabs +
        sectionCard("Project", "fa-info-circle", renderProjectMeta(projectRoot, projectId)) +
        summary +
        tableCard + fieldCard + pluginCard + kindCards + untrackedCard +
        script +
      '</div>' +
    '</div>';
}

function renderPlanPreview({ plan = null, projectRoot = "", projectId = "", error = null } = {}) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "plan" });
  const missingRootError = error === "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" || error === "Project has no root_path";
  if (!projectRoot) {
    const body = error && !missingRootError
      ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      : (projectId
        ? '<div class="alert alert-info">This project has no <code>root_path</code> yet. Open the project and set the folder first, then come back to Plan Preview.</div>'
        : '<div class="alert alert-info">Choose a project first. Plan Preview now lives with a project because it needs a selected Git root.</div><a href="/project-sync/projects" class="btn btn-outline-primary btn-sm mt-2"><i class="fas fa-folder-open me-1"></i>Open projects</a>');
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-tasks me-2"></i>Plan</h5></div><div class="card-body">' + projectTabs + body + '</div></div>';
  }
  if (error) {
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-tasks me-2"></i>Plan</h5></div><div class="card-body">' + projectTabs + `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` + '</div></div>';
  }

  const ops = (plan && plan.operations) || [];
  const warnings = (plan && plan.warnings) || [];
  const blocked = (plan && plan.blocked) || [];

  const summary = `<div class="row mb-4"><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Operations</div><div class="h4 mb-0">${ops.length}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Warnings</div><div class="h4 mb-0">${warnings.length}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Blocked</div><div class="h4 mb-0">${blocked.length}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Backup</div><div class="h4 mb-0">${plan && plan.backup_required ? "Required" : "Not needed"}</div></div></div></div>`;

  const warningsTable = warnings.length ? renderFilterableTable("plan-warnings-table", [
    { key: (row) => `<i class="fas fa-exclamation-triangle text-warning me-1"></i>${escapeHtml(row.type || "")}`, label: "Type" },
    { key: (row) => escapeHtml(row.table || row.plugin || row.view || row.page || row.trigger || row.role || ""), label: "Target" },
  ], warnings, { hover: true, class: "table-bordered" }) : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No warnings.</div>';

  const opsTable = ops.length ? renderFilterableTable("plan-ops-table", [
    { key: (row) => `<code>${escapeHtml(row.action)}</code>`, label: "Action" },
    { key: (row) => escapeHtml(row.table || row.plugin || row.view || row.page || row.trigger || row.role || row.field || row.from || ""), label: "Target" },
    { key: (row) => row.safe ? '<span class="badge bg-success">Safe</span>' : '<span class="badge bg-warning text-dark">Review</span>', label: "Status" },
  ], ops, { hover: true, class: "table-bordered" }) : '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>No operations planned.</div>';

  const blockedHtml = blocked.length
    ? `<div class="alert alert-danger"><h6 class="alert-heading"><i class="fas fa-ban me-1"></i>Blocked</h6><ul class="mb-0">${blocked.map((item) => `<li>${escapeHtml(item.reason || JSON.stringify(item))}</li>`).join("")}</ul></div>`
    : '<div class="text-muted mb-3"><i class="fas fa-check-circle text-success me-1"></i>No blockers.</div>';

  return nav +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header"><h5 class="mb-0"><i class="fas fa-tasks me-2"></i>Plan</h5><div class="small text-muted mt-1">Project root: <code>' + escapeHtml(projectRoot) + '</code></div></div>' +
      '<div class="card-body">' +
        projectTabs + summary + blockedHtml +
        sectionCard("Warnings", "fa-exclamation-triangle", warningsTable) +
        sectionCard("Operations", "fa-cogs", opsTable) +
      '</div>' +
    '</div>';
}

module.exports = { renderLiveDiff, renderPlanPreview };
