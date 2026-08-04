const { renderFilterableTable, escapeHtml, icon, globalNav, projectNav, loadScript } = require("./_shared");

function sectionCard(title, iconName, body) {
  return '<div class="card scps-panel mb-4"><div class="card-header"><h6 class="mb-0"><i class="fas ' + iconName + ' me-2"></i>' + escapeHtml(title) + '</h6></div><div class="card-body">' + body + '</div></div>';
}

function phaseBadge(phase) {
  const map = {
    "pre-deploy": '<span class="badge bg-info text-dark">pre-deploy</span>',
    "post-deploy": '<span class="badge bg-primary">post-deploy</span>',
    manual: '<span class="badge bg-secondary">manual</span>',
  };
  return map[phase || "manual"] || map.manual;
}

function validBadge(valid) {
  return valid ? '<span class="badge bg-success">valid</span>' : '<span class="badge bg-danger">invalid</span>';
}

function ledgerStatusBadge(status) {
  if (!status) return '<span class="badge bg-warning text-dark">pending</span>';
  const map = {
    applied: '<span class="badge bg-success">applied</span>',
    failed: '<span class="badge bg-danger">failed</span>',
  };
  return map[status] || `<span class="badge bg-secondary">${escapeHtml(status)}</span>`;
}

/**
 * Split items into two groups by run mode for the two-block display.
 * run "once" → single-execution (ledger-tracked); run "always" → recurring.
 */
function splitByRun(items = []) {
  const once = [];
  const always = [];
  for (const item of items) {
    if ((item.run || "once") === "once") once.push(item);
    else always.push(item);
  }
  return { once, always };
}

function migrationRows(migrations, includeLedger) {
  return migrations.map((row) => {
    const base = {
      file: `<code>${escapeHtml(row.file)}</code>`,
      name: escapeHtml(row.name),
      phase: phaseBadge(row.phase),
      steps: String(row.steps || 0),
      valid: validBadge(row.valid),
      actions:
        `<button class="btn btn-outline-secondary btn-sm edit-migration-btn" data-file="${escapeHtml(row.file)}" data-kind="migration"><i class="fas fa-edit me-1"></i>Edit</button> ` +
        `<button class="btn btn-outline-danger btn-sm delete-data-btn" data-file="${escapeHtml(row.file)}" data-kind="migration"><i class="fas fa-trash"></i></button>`,
    };
    if (includeLedger) {
      base.ledger = ledgerStatusBadge(row.ledger_status);
      base.applied_at = row.ledger_applied_at ? escapeHtml(String(row.ledger_applied_at).slice(0, 19).replace("T", " ")) : '<span class="text-muted">—</span>';
    }
    return base;
  });
}

function seedRows(seeds) {
  return seeds.map((row) => ({
    file: `<code>${escapeHtml(row.file)}</code>`,
    name: escapeHtml(row.name),
    phase: phaseBadge(row.phase),
    mode: `<code>${escapeHtml(row.mode || "upsert")}</code>`,
    tables: String(row.tables || 0),
    valid: validBadge(row.valid),
    actions:
      `<button class="btn btn-outline-secondary btn-sm edit-seed-btn" data-file="${escapeHtml(row.file)}" data-kind="seed"><i class="fas fa-edit me-1"></i>Edit</button> ` +
      `<button class="btn btn-outline-danger btn-sm delete-data-btn" data-file="${escapeHtml(row.file)}" data-kind="seed"><i class="fas fa-trash"></i></button>`,
  }));
}

function migrationsBlock(title, iconName, rows, includeLedger) {
  if (!rows.length) return sectionCard(title, iconName, '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>None.</div>');
  const columns = [
    { key: (r) => r.file, label: "File" },
    { key: (r) => r.name, label: "Name" },
    { key: (r) => r.phase, label: "Phase", filterOptions: ["pre-deploy", "post-deploy", "manual"] },
    { key: (r) => String(r.steps), label: "Steps" },
  ];
  if (includeLedger) {
    columns.push({ key: (r) => r.ledger, label: "Status", filterOptions: ["applied", "pending", "failed"] });
    columns.push({ key: (r) => r.applied_at, label: "Applied" });
  }
  columns.push({ key: (r) => r.valid, label: "Valid" });
  columns.push({ key: (r) => r.actions, label: "", filter: false });
  return sectionCard(title + ` <span class="badge bg-secondary ms-1">${rows.length}</span>`, iconName, renderFilterableTable(`migrations-${title.replace(/\s/g, "-")}-table`, columns, migrationRows(rows, includeLedger), { hover: true, class: "table-bordered" }));
}

function seedsBlock(title, iconName, rows) {
  if (!rows.length) return sectionCard(title, iconName, '<div class="text-muted"><i class="fas fa-check-circle text-success me-1"></i>None.</div>');
  const columns = [
    { key: (r) => r.file, label: "File" },
    { key: (r) => r.name, label: "Name" },
    { key: (r) => r.phase, label: "Phase", filterOptions: ["pre-deploy", "post-deploy", "manual"] },
    { key: (r) => r.mode, label: "Mode", filterOptions: ["upsert", "replace", "truncate"] },
    { key: (r) => String(r.tables), label: "Tables" },
    { key: (r) => r.valid, label: "Valid" },
    { key: (r) => r.actions, label: "", filter: false },
  ];
  return sectionCard(title + ` <span class="badge bg-secondary ms-1">${rows.length}</span>`, iconName, renderFilterableTable(`seeds-${title.replace(/\s/g, "-")}-table`, columns, seedRows(rows), { hover: true, class: "table-bordered" }));
}

/**
 * Fixed controls rendered above the step editor. These are the fields that
 * are common to every migration/seed, presented as real form controls instead
 * of JSON keys.
 */
function fixedControls(kind) {
  const isSeed = kind === "seed";
  return `
    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <label class="form-label fw-bold">Name <span class="text-danger">*</span></label>
        <input id="ed-name" class="form-control" placeholder="add-status-index" autocomplete="off" />
        <div class="form-text">Unique identifier. Used by the ledger for <code>run: "once"</code> tracking.</div>
      </div>
      <div class="col-md-3">
        <label class="form-label fw-bold">Phase</label>
        <select id="ed-phase" class="form-select">
          <option value="pre-deploy">pre-deploy · before structure</option>
          <option value="post-deploy">post-deploy · after structure</option>
          <option value="manual">manual · explicit apply only</option>
        </select>
        <div class="form-text">When this runs during a deploy.</div>
      </div>
      <div class="col-md-3">
        <label class="form-label fw-bold">Run</label>
        <select id="ed-run" class="form-select">
          <option value="once">once · ${isSeed ? "rebuild on every deploy" : "single execution (ledger)"}</option>
          <option value="always">always · every deploy</option>
        </select>
        <div class="form-text">${isSeed ? "Seeds are idempotent (upsert); &quot;once&quot; is ledger-tracked." : "&quot;Once&quot; records in the ledger and never re-runs."}</div>
      </div>
      ${isSeed ? `
      <div class="col-md-2">
        <label class="form-label fw-bold">Mode</label>
        <select id="ed-mode" class="form-select">
          <option value="upsert">upsert · insert/update</option>
          <option value="replace">replace · truncate + insert</option>
          <option value="truncate">truncate · clear only</option>
        </select>
        <div class="form-text">Destructive modes need <code>--allow-destructive</code>.</div>
      </div>` : ""}
    </div>`;
}

/**
 * Wizard launcher buttons. Each opens a small guided form that, on confirm,
 * injects generated steps into the step editor.
 */
function wizardButtons(kind) {
  if (kind === "seed") {
    return `
      <div class="d-flex flex-wrap gap-2 mb-3">
        <button class="btn btn-outline-primary btn-sm wizard-btn" data-wizard="seed-master"><i class="fas fa-seedling me-1"></i>Master data</button>
        <button class="btn btn-outline-warning btn-sm wizard-btn" data-wizard="seed-truncate"><i class="fas fa-eraser me-1"></i>Clear table</button>
      </div>`;
  }
  return `
    <div class="d-flex flex-wrap gap-2 mb-3">
      <button class="btn btn-outline-primary btn-sm wizard-btn" data-wizard="copy-field"><i class="fas fa-copy me-1"></i>Copy field</button>
      <button class="btn btn-outline-primary btn-sm wizard-btn" data-wizard="create-index"><i class="fas fa-list-ol me-1"></i>Create index</button>
      <button class="btn btn-outline-primary btn-sm wizard-btn" data-wizard="transform"><i class="fas fa-magic me-1"></i>Transform data</button>
      <button class="btn btn-outline-primary btn-sm wizard-btn" data-wizard="add-field"><i class="fas fa-plus me-1"></i>Add field</button>
      <button class="btn btn-outline-secondary btn-sm wizard-btn" data-wizard="raw-sql"><i class="fas fa-code me-1"></i>Free SQL</button>
    </div>`;
}

function stepEditorShell(kind) {
  if (kind === "seed") {
    // Seeds don't have steps; they have tables[].rows. Show a seed-specific area.
    return `
      <label class="form-label fw-bold">Seed data (tables)</label>
      <div id="seed-tables-list" class="mb-2"></div>
      <button id="btn-add-seed-table" class="btn btn-outline-secondary btn-sm"><i class="fas fa-plus me-1"></i>Add table</button>
      <div class="form-text">Define the target table, the key column for matching rows, and the rows to upsert.</div>`;
  }
  return `
    <label class="form-label fw-bold">Steps</label>
    <div id="steps-list" class="mb-2"></div>
    <div class="d-flex gap-2">
      <button id="btn-add-step" class="btn btn-outline-secondary btn-sm"><i class="fas fa-plus me-1"></i>Add step</button>
    </div>`;
}

function editorModal() {
  return `
  <div class="modal fade" id="dataEditorModal" tabindex="-1" aria-labelledby="dataEditorLabel" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header bg-dark text-white">
          <h5 class="modal-title" id="dataEditorLabel"><i class="fas fa-database me-2"></i><span id="data-editor-title">New</span></h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="data-editor-kind" value="migration" />
          <input type="hidden" id="data-editor-original-file" value="" />
          <ul class="nav nav-tabs mb-3" id="editorTabs" role="tablist">
            <li class="nav-item" role="presentation"><button class="nav-link active" id="tab-form-btn" data-bs-toggle="tab" data-bs-target="#tab-form" type="button" role="tab"><i class="fas fa-edit me-1"></i>Form</button></li>
            <li class="nav-item" role="presentation"><button class="nav-link" id="tab-json-btn" data-bs-toggle="tab" data-bs-target="#tab-json" type="button" role="tab"><i class="fas fa-code me-1"></i>Raw JSON</button></li>
          </ul>
          <div class="tab-content">
            <div class="tab-pane fade show active" id="tab-form" role="tabpanel">
              <div id="fixed-controls"></div>
              <hr/>
              <div id="wizard-buttons"></div>
              <div id="step-editor"></div>
              <div id="data-editor-errors" class="alert alert-danger mt-3 d-none"></div>
            </div>
            <div class="tab-pane fade" id="tab-json" role="tabpanel">
              <textarea id="data-editor-json" class="to-code" mode="application/json" rows="22" spellcheck="false"></textarea>
              <div class="form-text mt-1">Edit the raw JSON. Switching back to Form re-parses it. <code>raw_sql</code> steps run inside a transaction.</div>
              <div id="data-editor-json-errors" class="alert alert-danger mt-2 d-none"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="data-editor-validate" class="btn btn-outline-secondary"><i class="fas fa-check me-1"></i>Validate</button>
          <button id="data-editor-save" class="btn btn-primary"><i class="fas fa-save me-1"></i>Save</button>
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        </div>
      </div>
    </div>
  </div>`;
}

function wizardModal() {
  return `
  <div class="modal fade" id="wizardModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header bg-primary text-white">
          <h5 class="modal-title" id="wizard-title"><i class="fas fa-magic me-2"></i>Wizard</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body" id="wizard-body"></div>
        <div class="modal-footer">
          <button id="wizard-confirm" class="btn btn-primary"><i class="fas fa-check me-1"></i>Generate step(s)</button>
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderMigrationsPage({ project, projectId = "", projectRoot = "", environment = "dev", uiMode = "full", migrations = [], seeds = [], error = null } = {}) {
  const nav = globalNav("projects");
  const projectTabs = projectNav({ projectId, active: "data", mode: uiMode });
  const missingRoot = !projectRoot;

  if (missingRoot) {
    const body = error
      ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>`
      : (projectId
        ? '<div class="alert alert-info">This project has no <code>root_path</code> yet. Open the project and set the folder first, then come back to manage data scripts.</div>'
        : '<div class="alert alert-info">Choose a project first.</div><a href="/project-sync/projects" class="btn btn-outline-primary btn-sm"><i class="fas fa-folder-open me-1"></i>Open projects</a>');
    return nav + '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas fa-database me-2"></i>Data scripts</h5></div><div class="card-body">' + projectTabs + body + '</div></div>';
  }

  const projectHeader = project
    ? `<div class="small text-muted mb-3">Project: <strong>${escapeHtml(project.name || "")}</strong> · Environment: <code>${escapeHtml(environment)}</code> · Root: <code>${escapeHtml(projectRoot)}</code></div>`
    : `<div class="small text-muted mb-3">Root: <code>${escapeHtml(projectRoot)}</code></div>`;

  // Split migrations/seeds by run mode for the two-block layout.
  const migSplit = splitByRun(migrations);
  const seedSplit = splitByRun(seeds);

  return nav +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header"><h5 class="mb-0"><i class="fas fa-database me-2"></i>Data scripts</h5><div class="small text-muted mt-1">Versioned migrations and seeds for data normalization, master data, and transformations.</div></div>' +
      '<div class="card-body">' +
        projectTabs +
        (error ? `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${escapeHtml(error)}</div>` : "") +
        `<div class="d-flex justify-content-between align-items-center mb-3"><h6 class="mb-0">Migrations</h6><div class="btn-group"><button id="btn-new-migration" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New migration</button></div></div>` +
        migrationsBlock("Single execution (once)", "fa-lock", migSplit.once, true) +
        migrationsBlock("Recurring (always)", "fa-sync-alt", migSplit.always, false) +
        `<div class="d-flex justify-content-between align-items-center mb-3 mt-4"><h6 class="mb-0">Seeds</h6><div class="btn-group"><button id="btn-new-seed" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New seed</button></div></div>` +
        seedsBlock("Single execution (once)", "fa-lock", seedSplit.once) +
        seedsBlock("Recurring (always)", "fa-sync-alt", seedSplit.always) +
        editorModal() +
        wizardModal() +
        `<script>window.SCPS_DATA_PROJECT_ID = ${projectId == null ? "null" : JSON.stringify(projectId)};window.SCPS_DATA_ENVIRONMENT = ${JSON.stringify(environment)};<\/script>` +
        `<script>\n${loadScript("migrations.js")}\n<\/script>` +
      '</div>' +
    '</div>';
}

module.exports = { renderMigrationsPage, splitByRun };
