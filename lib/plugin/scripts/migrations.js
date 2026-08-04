(function () {
  "use strict";
  var pid = window.SCPS_DATA_PROJECT_ID;
  function projectQuery() { return pid ? "?project_id=" + encodeURIComponent(pid) : ""; }
  function apiUrl(path) { return path + projectQuery(); }

  // ─── Cache de tablas/campos (para wizards) ─────────────────
  var tablesCache = null;
  function loadTables() {
    if (tablesCache) return Promise.resolve(tablesCache);
    return fetch(apiUrl("/project-sync/api/tables")).then(function (r) { return r.json(); }).then(function (j) {
      tablesCache = j.ok ? j.tables : [];
      return tablesCache;
    }).catch(function () { tablesCache = []; return []; });
  }
  function tableNames() { return (tablesCache || []).map(function (t) { return t.name; }); }
  function fieldNames(tableName) {
    var t = (tablesCache || []).find(function (x) { return x.name === tableName; });
    return t ? (t.fields || []).map(function (f) { return f.name; }) : [];
  }

  // ─── Estado del editor ─────────────────────────────────────
  var state = { kind: "migration", name: "", phase: "pre-deploy", run: "once", steps: [], mode: "upsert", tables: [], originalFile: "" };
  var rawEditorInstance = null; // instancia Monaco del JSON crudo

  function blankState(kind) {
    if (kind === "seed") return { kind: "seed", name: "", phase: "post-deploy", run: "always", mode: "upsert", tables: [], originalFile: "" };
    return { kind: "migration", name: "", phase: "pre-deploy", run: "once", steps: [], originalFile: "" };
  }

  // ─── Utilidades DOM ────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function option(value, label, selected) {
    var o = document.createElement("option");
    o.value = value; o.textContent = label || value;
    if (selected) o.selected = true;
    return o;
  }
  function fillSelect(select, values, selected, placeholder) {
    clear(select);
    if (placeholder) select.appendChild(option("", placeholder, !selected));
    for (var i = 0; i < values.length; i++) select.appendChild(option(values[i], values[i], values[i] === selected));
  }

  function flash(msg, ok) {
    var banner = document.createElement("div");
    banner.className = "alert alert-" + (ok ? "success" : "danger") + " alert-dismissible fade show";
    banner.innerHTML = escapeHtml(msg) + '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>';
    var container = document.querySelector(".card-body");
    if (container) { container.insertBefore(banner, container.firstChild); setTimeout(function () { banner.remove(); }, 4000); }
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ─── Activación de Monaco en textareas.to-code dinámicos ──
  // Saltcorn's enable_monaco() loads the Monaco AMD loader + TypeScript
  // declares, then calls back. The callback is what actually transforms
  // each textarea into a Monaco editor instance. We replicate the essential
  // part of Saltcorn's own attach logic (language from mode, create editor,
  // sync value back to textarea) without the TypeScript-expression features
  // that don't apply to SQL/JSON.
  var monacoEditors = new WeakMap(); // textarea → monaco editor instance

  function attachMonaco(codes) {
    codes.forEach(function (el) {
      if (el.classList.contains("monaco-enabled")) return;
      el.classList.add("monaco-enabled");
      var value = el.value || "";
      var mode = el.getAttribute("mode") || "";
      var language = "typescript";
      if (mode === "text/x-sql") language = "sql";
      else if (mode === "application/json") language = "json";
      else if (mode === "text/css") language = "css";
      else if (mode === "text/html") language = "html";

      var container = document.createElement("div");
      el.after(container);
      var compact = el.getAttribute("compact");
      if (compact) container.style.height = "90px";
      else if (el.classList.contains("h-350")) container.classList.add("h-350");
      else container.style.height = "300px";
      // Hide the raw textarea; Monaco writes back to it on change.
      el.style.display = "none";

      var editor = window.monaco.editor.create(container, {
        value: value,
        language: language,
        theme: typeof _sc_lightmode !== "undefined" && _sc_lightmode === "dark" ? "vs-dark" : "vs",
        minimap: { enabled: false },
        automaticLayout: true,
      });
      monacoEditors.set(el, editor);

      editor.onDidChangeModelContent(function () {
        el.value = editor.getValue();
        // Trigger both jQuery change (Saltcorn convention) and a native input
        // event so our own listeners (which listen for "input") stay in sync
        // with Monaco edits.
        if (typeof $ === "function") $(el).trigger("change");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }

  function activateCodeEditors(scope) {
    var codes = Array.prototype.slice.call((scope || document).querySelectorAll("textarea.to-code:not(.monaco-enabled)"));
    if (!codes.length) return;
    if (typeof enable_monaco === "function") {
      // enable_monaco loads Monaco if needed, then calls our callback.
      enable_monaco(codes, function () { attachMonaco(codes); });
    } else if (window.monaco && typeof window.monaco.editor.create === "function") {
      // Monaco already loaded (e.g. admin page); attach directly.
      attachMonaco(codes);
    }
    // If neither enable_monaco nor monaco is available, the textarea
    // remains a plain editable textarea — graceful degradation.
  }

  /**
   * Push a new value into a textarea that may be backed by Monaco. When
   * Monaco is attached, writing el.value alone does NOT update the visible
   * editor model, so callers that programmatically change a code field must
   * use this helper.
   */
  function setCodeValue(textareaEl, value) {
    if (!textareaEl) return;
    textareaEl.value = value;
    var editor = monacoEditors.get(textareaEl);
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }

  // ─── Render: controles fijos ───────────────────────────────
  function renderFixedControls() {
    var host = el("fixed-controls"); if (!host) return;
    clear(host);
    var isSeed = state.kind === "seed";

    var row = document.createElement("div");
    row.className = "row g-3 mb-3";

    // name
    var cName = document.createElement("div"); cName.className = "col-md-4";
    cName.innerHTML = '<label class="form-label fw-bold">Name <span class="text-danger">*</span></label>';
    var inpName = document.createElement("input");
    inpName.id = "ed-name"; inpName.className = "form-control"; inpName.placeholder = isSeed ? "countries" : "add-status-index";
    inpName.value = state.name || "";
    inpName.addEventListener("input", function () { state.name = inpName.value; syncRawJson(); });
    cName.appendChild(inpName);
    cName.appendChild(makeHelp("Unique identifier. Used by the ledger for run: \"once\" tracking."));
    row.appendChild(cName);

    // phase
    var cPhase = document.createElement("div"); cPhase.className = "col-md-3";
    cPhase.innerHTML = '<label class="form-label fw-bold">Phase</label>';
    var selPhase = document.createElement("select"); selPhase.id = "ed-phase"; selPhase.className = "form-select";
    [["pre-deploy", "pre-deploy · before structure"], ["post-deploy", "post-deploy · after structure"], ["manual", "manual · explicit apply only"]].forEach(function (p) {
      selPhase.appendChild(option(p[0], p[1], state.phase === p[0]));
    });
    selPhase.addEventListener("change", function () { state.phase = selPhase.value; syncRawJson(); });
    cPhase.appendChild(selPhase);
    cPhase.appendChild(makeHelp("When this runs during a deploy."));
    row.appendChild(cPhase);

    // run
    var cRun = document.createElement("div"); cRun.className = "col-md-3";
    cRun.innerHTML = '<label class="form-label fw-bold">Run</label>';
    var selRun = document.createElement("select"); selRun.id = "ed-run"; selRun.className = "form-select";
    var onceLabel = isSeed ? "once · ledger-tracked" : "once · single execution (ledger)";
    selRun.appendChild(option("once", onceLabel, state.run === "once"));
    selRun.appendChild(option("always", "always · every deploy", state.run === "always"));
    selRun.addEventListener("change", function () { state.run = selRun.value; syncRawJson(); });
    cRun.appendChild(selRun);
    cRun.appendChild(makeHelp(isSeed ? "Seeds are idempotent (upsert); \"always\" re-applies each deploy." : "\"Once\" records in the ledger and never re-runs."));
    row.appendChild(cRun);

    // mode (seeds only)
    if (isSeed) {
      var cMode = document.createElement("div"); cMode.className = "col-md-2";
      cMode.innerHTML = '<label class="form-label fw-bold">Mode</label>';
      var selMode = document.createElement("select"); selMode.id = "ed-mode"; selMode.className = "form-select";
      [["upsert", "upsert · insert/update"], ["replace", "replace · truncate + insert"], ["truncate", "truncate · clear only"]].forEach(function (m) {
        selMode.appendChild(option(m[0], m[1], state.mode === m[0]));
      });
      selMode.addEventListener("change", function () { state.mode = selMode.value; syncRawJson(); });
      cMode.appendChild(selMode);
      cMode.appendChild(makeHelp("Destructive modes need --allow-destructive."));
      row.appendChild(cMode);
    }

    host.appendChild(row);
  }

  function makeHelp(text) {
    var d = document.createElement("div"); d.className = "form-text"; d.textContent = text; return d;
  }

  // ─── Render: botones wizard ────────────────────────────────
  function renderWizardButtons() {
    var host = el("wizard-buttons"); if (!host) return;
    clear(host);
    var btns = state.kind === "seed"
      ? [["seed-master", "Master data", "fa-seedling", "btn-outline-primary"], ["seed-truncate", "Clear table", "fa-eraser", "btn-outline-warning"]]
      : [["copy-field", "Copy field", "fa-copy", "btn-outline-primary"], ["create-index", "Create index", "fa-list-ol", "btn-outline-primary"], ["transform", "Transform data", "fa-magic", "btn-outline-primary"], ["add-field", "Add field", "fa-plus", "btn-outline-primary"], ["raw-sql", "Free SQL", "fa-code", "btn-outline-secondary"]];
    var grp = document.createElement("div"); grp.className = "d-flex flex-wrap gap-2";
    btns.forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = "btn btn-sm wizard-btn " + b[3];
      btn.setAttribute("data-wizard", b[0]);
      btn.innerHTML = '<i class="fas ' + b[2] + ' me-1"></i>' + escapeHtml(b[1]);
      btn.addEventListener("click", function (e) { e.preventDefault(); openWizard(b[0]); });
      grp.appendChild(btn);
    });
    host.appendChild(grp);
  }

  // ─── Render: editor de pasos (migraciones) ─────────────────
  function renderSteps() {
    var host = el("step-editor"); if (!host) return;
    clear(host);

    if (state.kind === "seed") {
      renderSeedTables(host);
      return;
    }

    var label = document.createElement("label"); label.className = "form-label fw-bold"; label.textContent = "Steps";
    host.appendChild(label);

    var list = document.createElement("div"); list.id = "steps-list"; list.className = "mb-2";
    (state.steps || []).forEach(function (step, idx) { list.appendChild(renderStepCard(step, idx)); });
    host.appendChild(list);

    var addBtn = document.createElement("button"); addBtn.className = "btn btn-outline-secondary btn-sm";
    addBtn.innerHTML = '<i class="fas fa-plus me-1"></i>Add step';
    addBtn.addEventListener("click", function (e) { e.preventDefault(); state.steps.push({ action: "ensure_field", table: "", field: "", type: "String" }); renderSteps(); syncRawJson(); });
    host.appendChild(addBtn);

    activateCodeEditors(host);
  }

  var STEP_ACTIONS = ["ensure_table", "ensure_field", "ensure_view", "ensure_page", "ensure_trigger", "ensure_role", "raw_sql", "raw_command"];

  function renderStepCard(step, idx) {
    var card = document.createElement("div");
    card.className = "border rounded p-3 mb-2";
    card.style.background = "#f8f9fa";

    var head = document.createElement("div"); head.className = "d-flex justify-content-between align-items-center mb-2";
    var title = document.createElement("span"); title.className = "badge bg-dark"; title.textContent = "Step " + (idx + 1);
    head.appendChild(title);
    var actions = document.createElement("div");
    if (idx > 0) {
      var up = document.createElement("button"); up.className = "btn btn-sm btn-outline-secondary me-1"; up.innerHTML = '<i class="fas fa-arrow-up"></i>';
      up.addEventListener("click", function (e) { e.preventDefault(); moveStep(idx, -1); });
      actions.appendChild(up);
    }
    if (idx < state.steps.length - 1) {
      var down = document.createElement("button"); down.className = "btn btn-sm btn-outline-secondary me-1"; down.innerHTML = '<i class="fas fa-arrow-down"></i>';
      down.addEventListener("click", function (e) { e.preventDefault(); moveStep(idx, 1); });
      actions.appendChild(down);
    }
    var del = document.createElement("button"); del.className = "btn btn-sm btn-outline-danger"; del.innerHTML = '<i class="fas fa-trash"></i>';
    del.addEventListener("click", function (e) { e.preventDefault(); state.steps.splice(idx, 1); renderSteps(); syncRawJson(); });
    actions.appendChild(del);
    head.appendChild(actions);
    card.appendChild(head);

    // action selector
    var actRow = document.createElement("div"); actRow.className = "mb-2";
    var actLabel = document.createElement("label"); actLabel.className = "form-label small fw-bold me-2"; actLabel.textContent = "Action";
    actRow.appendChild(actLabel);
    var sel = document.createElement("select"); sel.className = "form-select form-select-sm d-inline-block"; sel.style.width = "auto";
    STEP_ACTIONS.forEach(function (a) { sel.appendChild(option(a, a, step.action === a)); });
    sel.addEventListener("change", function () { step.action = sel.value; normalizeStep(step); renderSteps(); syncRawJson(); });
    actRow.appendChild(sel);
    card.appendChild(actRow);

    // dynamic fields
    card.appendChild(renderStepFields(step));
    return card;
  }

  function normalizeStep(step) {
    var a = step.action;
    if (a === "ensure_field") { step.table = step.table || ""; step.field = step.field || ""; step.type = step.type || "String"; }
    else if (a === "ensure_table") { step.table = step.table || ""; }
    else if (a === "raw_sql") { step.sql = step.sql || ""; }
    else if (a === "raw_command") { step.command = step.command || ""; }
    else if (a.indexOf("ensure_") === 0) { step.name = step.name || ""; }
  }

  function renderStepFields(step) {
    var wrap = document.createElement("div");
    var a = step.action;
    function field(labelText, prop, inputType, isCode) {
      var row = document.createElement("div"); row.className = "mb-2";
      var lab = document.createElement("label"); lab.className = "form-label small fw-bold"; lab.textContent = labelText;
      row.appendChild(lab);
      var inp;
      if (isCode) {
        inp = document.createElement("textarea");
        inp.className = "to-code form-control font-monospace";
        inp.setAttribute("mode", "text/x-sql");
        inp.rows = 6; inp.spellcheck = false;
      } else {
        inp = document.createElement(inputType || "input");
        inp.className = "form-control form-control-sm";
      }
      inp.value = step[prop] != null ? step[prop] : "";
      inp.addEventListener("input", function () { step[prop] = inp.value; syncRawJson(); });
      row.appendChild(inp);
      return row;
    }

    if (a === "ensure_field") {
      var tSel = tableSelect(step.table, function (v) { step.table = v; syncRawJson(); });
      wrap.appendChild(withLabel("Table", tSel));
      var fInp = document.createElement("input"); fInp.className = "form-control form-control-sm"; fInp.value = step.field || "";
      fInp.addEventListener("input", function () { step.field = fInp.value; syncRawJson(); });
      wrap.appendChild(withLabel("Field", fInp));
      var typeSel = typeSelect(step.type, function (v) { step.type = v; syncRawJson(); });
      wrap.appendChild(withLabel("Type", typeSel));
    } else if (a === "ensure_table") {
      var ts = tableSelect(step.table, function (v) { step.table = v; syncRawJson(); });
      wrap.appendChild(withLabel("Table", ts));
    } else if (a === "raw_sql") {
      wrap.appendChild(field("SQL", "sql", "textarea", true));
    } else if (a === "raw_command") {
      var cmd = document.createElement("textarea"); cmd.className = "form-control font-monospace"; cmd.rows = 3;
      cmd.value = step.command || ""; cmd.addEventListener("input", function () { step.command = cmd.value; syncRawJson(); });
      wrap.appendChild(withLabel("Command (shell)", cmd));
      var note = document.createElement("div"); note.className = "form-text"; note.textContent = "Only via command/rest adapter.";
      wrap.appendChild(note);
    } else if (a.indexOf("ensure_") === 0) {
      var nm = document.createElement("input"); nm.className = "form-control form-control-sm"; nm.value = step.name || "";
      nm.addEventListener("input", function () { step.name = nm.value; syncRawJson(); });
      wrap.appendChild(withLabel("Name", nm));
    }
    return wrap;
  }

  function withLabel(text, control) {
    var d = document.createElement("div"); d.className = "mb-2";
    var lab = document.createElement("label"); lab.className = "form-label small fw-bold"; lab.textContent = text;
    d.appendChild(lab); d.appendChild(control); return d;
  }
  function tableSelect(selected, onChange) {
    var sel = document.createElement("select"); sel.className = "form-select form-select-sm";
    sel.appendChild(option("", "(select table)", !selected));
    tableNames().forEach(function (n) { sel.appendChild(option(n, n, n === selected)); });
    sel.addEventListener("change", function () { onChange(sel.value); });
    return sel;
  }
  function typeSelect(selected, onChange) {
    var types = ["String", "Integer", "Float", "Bool", "Date", "Key", "UUID", "JSON", "File"];
    var sel = document.createElement("select"); sel.className = "form-select form-select-sm";
    types.forEach(function (t) { sel.appendChild(option(t, t, t === selected)); });
    if (selected && types.indexOf(selected) === -1) sel.appendChild(option(selected, selected + " (custom)", true));
    sel.addEventListener("change", function () { onChange(sel.value); });
    return sel;
  }

  function moveStep(idx, dir) {
    var j = idx + dir; if (j < 0 || j >= state.steps.length) return;
    var tmp = state.steps[idx]; state.steps[idx] = state.steps[j]; state.steps[j] = tmp;
    renderSteps(); syncRawJson();
  }

  // ─── Render: seed tables editor ────────────────────────────
  function renderSeedTables(host) {
    var label = document.createElement("label"); label.className = "form-label fw-bold"; label.textContent = "Seed data (tables)";
    host.appendChild(label);
    var list = document.createElement("div"); list.id = "seed-tables-list"; list.className = "mb-2";
    (state.tables || []).forEach(function (entry, idx) { list.appendChild(renderSeedTableCard(entry, idx)); });
    host.appendChild(list);
    var addBtn = document.createElement("button"); addBtn.id = "btn-add-seed-table"; addBtn.className = "btn btn-outline-secondary btn-sm";
    addBtn.innerHTML = '<i class="fas fa-plus me-1"></i>Add table';
    addBtn.addEventListener("click", function (e) { e.preventDefault(); state.tables.push({ table: "", key: "id", rows: [] }); renderSteps(); syncRawJson(); });
    host.appendChild(addBtn);
  }
  function renderSeedTableCard(entry, idx) {
    var card = document.createElement("div"); card.className = "border rounded p-3 mb-2"; card.style.background = "#f8f9fa";
    var head = document.createElement("div"); head.className = "d-flex justify-content-between mb-2";
    head.innerHTML = '<span class="badge bg-dark">Table ' + (idx + 1) + '</span>';
    var del = document.createElement("button"); del.className = "btn btn-sm btn-outline-danger"; del.innerHTML = '<i class="fas fa-trash"></i>';
    del.addEventListener("click", function (e) { e.preventDefault(); state.tables.splice(idx, 1); renderSteps(); syncRawJson(); });
    head.appendChild(del); card.appendChild(head);
    card.appendChild(withLabel("Table", tableSelect(entry.table, function (v) { entry.table = v; syncRawJson(); })));
    // key select (campos de la tabla elegida)
    var keyWrap = document.createElement("div"); keyWrap.className = "mb-2";
    keyWrap.appendChild(makeLabel("Key column"));
    var keySel = document.createElement("select"); keySel.className = "form-select form-select-sm";
    fillSelect(keySel, entry.table ? fieldNames(entry.table) : ["id"], entry.key || "id", "(select key)");
    keySel.addEventListener("change", function () { entry.key = keySel.value; syncRawJson(); });
    keyWrap.appendChild(keySel);
    card.appendChild(keyWrap);
    // rows editor (JSON textarea)
    var rowsWrap = document.createElement("div"); rowsWrap.className = "mb-2";
    rowsWrap.appendChild(makeLabel("Rows (JSON array)"));
    var rowsTa = document.createElement("textarea"); rowsTa.className = "to-code form-control font-monospace"; rowsTa.setAttribute("mode", "application/json");
    rowsTa.rows = 6; rowsTa.spellcheck = false; rowsTa.value = JSON.stringify(entry.rows || [], null, 2);
    rowsTa.addEventListener("input", function () { try { entry.rows = JSON.parse(rowsTa.value || "[]"); } catch (_e) { /* ignore while typing */ } syncRawJson(false); });
    rowsWrap.appendChild(rowsTa);
    card.appendChild(rowsWrap);
    return card;
  }
  function makeLabel(text) { var l = document.createElement("label"); l.className = "form-label small fw-bold"; l.textContent = text; return l; }

  // ─── Sincronización JSON crudo ─────────────────────────────
  function buildJson() {
    if (state.kind === "seed") {
      return { name: state.name || "", phase: state.phase, run: state.run, mode: state.mode, tables: state.tables || [] };
    }
    return { name: state.name || "", phase: state.phase, run: state.run, steps: state.steps || [] };
  }
  function syncRawJson(updateTextarea) {
    if (updateTextarea === false) return;
    var json = JSON.stringify(buildJson(), null, 2);
    var ta = el("data-editor-json");
    if (ta) setCodeValue(ta, json);
  }
  function parseFromRawJson() {
    var ta = el("data-editor-json"); if (!ta) return;
    var editor = monacoEditors.get(ta);
    var raw = editor ? editor.getValue() : ta.value;
    try {
      var parsed = JSON.parse(raw);
      state.name = parsed.name || state.name;
      if (parsed.phase) state.phase = parsed.phase;
      if (parsed.run) state.run = parsed.run;
      if (state.kind === "seed") {
        if (parsed.mode) state.mode = parsed.mode;
        if (Array.isArray(parsed.tables)) state.tables = parsed.tables;
      } else {
        if (Array.isArray(parsed.steps)) state.steps = parsed.steps;
      }
      hideJsonError();
      renderFixedControls(); renderWizardButtons(); renderSteps();
    } catch (err) {
      showJsonError("Invalid JSON: " + err.message);
    }
  }
  function showJsonError(msg) { var box = el("data-editor-json-errors"); if (box) { box.textContent = msg; box.classList.remove("d-none"); } }
  function hideJsonError() { var box = el("data-editor-json-errors"); if (box) box.classList.add("d-none"); }

  // ─── Apertura del editor ───────────────────────────────────
  function openEditor(kind, existingData, originalFile) {
    state = existingData ? JSON.parse(JSON.stringify(existingData)) : blankState(kind);
    state.kind = kind;
    state.originalFile = originalFile || "";
    el("data-editor-kind").value = kind;
    el("data-editor-original-file").value = originalFile || "";
    el("data-editor-title").textContent = originalFile ? "Edit " + originalFile : "New " + kind;
    hideError();

    renderFixedControls();
    renderWizardButtons();
    renderSteps();
    syncRawJson();

    var modalEl = el("dataEditorModal");
    if (window.bootstrap) { var bs = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); bs.show(); }
    // Activa Monaco en el textarea de JSON crudo tras mostrar el modal.
    setTimeout(function () { activateCodeEditors(modalEl); }, 300);
  }

  function hideError() { var box = el("data-editor-errors"); if (box) box.classList.add("d-none"); }
  function showError(msg) { var box = el("data-editor-errors"); if (box) { box.textContent = msg; box.classList.remove("d-none"); } }

  // ─── Validate / Save ───────────────────────────────────────
  function getDataForSave() {
    // Reconstruye desde state, pero lee los textareas Monaco via .value
    var ta = el("data-editor-json");
    if (ta) {
      var editor = monacoEditors.get(ta);
      var raw = editor ? editor.getValue() : ta.value;
      try { return JSON.parse(raw); } catch (_e) { return buildJson(); }
    }
    return buildJson();
  }
  async function validateContent() {
    var data = getDataForSave();
    var kind = el("data-editor-kind").value;
    var result = await callApi("/project-sync/api/migrations/test", { kind: kind, data: data });
    if (result.ok) { hideError(); return data; }
    showError((result.errors || []).join("\n") || result.error || "Validation failed");
    return null;
  }
  async function saveContent() {
    var data = await validateContent();
    if (!data) return;
    var kind = el("data-editor-kind").value;
    var originalFile = el("data-editor-original-file").value;
    var endpoint = originalFile ? "/project-sync/api/migrations/update" : "/project-sync/api/migrations";
    var result = await callApi(endpoint, { kind: kind, data: data, original_file: originalFile });
    if (result.ok) {
      var modalEl = el("dataEditorModal");
      if (window.bootstrap) { var bs = bootstrap.Modal.getInstance(modalEl); if (bs) bs.hide(); }
      flash(kind + " saved: " + (result.file || originalFile), true);
      setTimeout(function () { location.reload(); }, 600);
    } else {
      showError((result.errors || []).join("\n") || result.error || "Save failed");
    }
  }
  async function deleteFile(file, kind) {
    if (!confirm("Delete " + kind + " file " + file + "? This cannot be undone.")) return;
    var result = await callApi("/project-sync/api/migrations/delete", { kind: kind, file: file });
    if (result.ok) { flash("Deleted " + file, true); setTimeout(function () { location.reload(); }, 600); }
    else flash(result.error || "Delete failed", false);
  }
  async function callApi(path, body) {
    var resp = await fetch(apiUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return resp.json();
  }

  // ─── Wizards ───────────────────────────────────────────────
  var activeWizard = null;
  function openWizard(type) {
    activeWizard = type;
    loadTables().then(function () {
      var titles = {
        "copy-field": "Copy field to another", "create-index": "Create index", "transform": "Transform data (SQL UPDATE)",
        "add-field": "Add field", "raw-sql": "Free SQL", "seed-master": "Master data", "seed-truncate": "Clear table"
      };
      el("wizard-title").innerHTML = '<i class="fas fa-magic me-2"></i>' + escapeHtml(titles[type] || type);
      var body = el("wizard-body"); clear(body);
      body.appendChild(wizardForm(type));
      var modalEl = el("wizardModal");
      if (window.bootstrap) { var bs = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); bs.show(); }
      setTimeout(function () { activateCodeEditors(modalEl); }, 300);
    });
  }

  function wizardForm(type) {
    var form = document.createElement("div");
    if (type === "copy-field") form.appendChild(copyFieldForm());
    else if (type === "create-index") form.appendChild(createIndexForm());
    else if (type === "transform") form.appendChild(transformForm());
    else if (type === "add-field") form.appendChild(addFieldForm());
    else if (type === "raw-sql") form.appendChild(rawSqlForm());
    else if (type === "seed-master") form.appendChild(seedMasterForm());
    else if (type === "seed-truncate") form.appendChild(seedTruncateForm());
    return form;
  }

  function labeled(labelText, control) { var d = document.createElement("div"); d.className = "mb-3"; d.appendChild(makeLabel(labelText)); d.appendChild(control); return d; }
  function newTableSelect(id) {
    var sel = document.createElement("select"); sel.id = id; sel.className = "form-select";
    sel.appendChild(option("", "(select table)", true));
    tableNames().forEach(function (n) { sel.appendChild(option(n, n)); });
    return sel;
  }
  function dynamicFieldSelect(tableSelId, fieldSelId) {
    var tableSel = document.getElementById(tableSelId);
    if (!tableSel) return;
    var handler = function () {
      var fs = document.getElementById(fieldSelId); if (!fs) return;
      var t = tableSel.value;
      clear(fs); fs.appendChild(option("", "(select field)", true));
      fieldNames(t).forEach(function (f) { fs.appendChild(option(f, f)); });
    };
    tableSel.addEventListener("change", handler);
  }

  function copyFieldForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table", tSel));
    var fFrom = document.createElement("select"); fFrom.id = "w-field-from"; fFrom.className = "form-select";
    fFrom.appendChild(option("", "(select source field)", true));
    f.appendChild(labeled("Source field", fFrom));
    var destWrap = document.createElement("div");
    var fTo = document.createElement("input"); fTo.id = "w-field-to"; fTo.className = "form-control"; fTo.placeholder = "destination field name";
    destWrap.appendChild(fTo);
    var createChk = document.createElement("input"); createChk.type = "checkbox"; createChk.id = "w-create-dest"; createChk.checked = true; createChk.className = "form-check-input ms-2";
    var chkLabel = document.createElement("label"); chkLabel.className = "form-check-label ms-1"; chkLabel.textContent = "Create destination field (String)";
    var chkWrap = document.createElement("div"); chkWrap.className = "form-check mb-3"; chkWrap.appendChild(createChk); chkWrap.appendChild(chkLabel);
    f.appendChild(labeled("Destination field", fTo));
    f.appendChild(chkWrap);
    setTimeout(function () { dynamicFieldSelect("w-table", "w-field-from"); }, 50);
    return f;
  }
  function createIndexForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table", tSel));
    var cols = document.createElement("input"); cols.id = "w-columns"; cols.className = "form-control"; cols.placeholder = "col1, col2";
    f.appendChild(labeled("Columns (comma-separated)", cols));
    var idxName = document.createElement("input"); idxName.id = "w-index-name"; idxName.className = "form-control"; idxName.placeholder = "idx_contacts_status";
    f.appendChild(labeled("Index name", idxName));
    var uniq = document.createElement("input"); uniq.type = "checkbox"; uniq.id = "w-unique"; uniq.className = "form-check-input";
    var ul = document.createElement("label"); ul.className = "form-check-label ms-1"; ul.textContent = "Unique";
    var uw = document.createElement("div"); uw.className = "form-check mb-3"; uw.appendChild(uniq); uw.appendChild(ul); f.appendChild(uw);
    return f;
  }
  function transformForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table", tSel));
    var ta = document.createElement("textarea"); ta.id = "w-sql"; ta.className = "to-code form-control font-monospace"; ta.setAttribute("mode", "text/x-sql");
    ta.rows = 8; ta.spellcheck = false; ta.value = "UPDATE <table> SET ... WHERE ...";
    f.appendChild(labeled("SQL", ta));
    return f;
  }
  function addFieldForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table", tSel));
    var fname = document.createElement("input"); fname.id = "w-field"; fname.className = "form-control"; fname.placeholder = "status";
    f.appendChild(labeled("Field name", fname));
    var typeSel = typeSelect("String", function () {}); typeSel.id = "w-type"; typeSel.className = "form-select";
    f.appendChild(labeled("Type", typeSel));
    var req = document.createElement("input"); req.type = "checkbox"; req.id = "w-required"; req.className = "form-check-input";
    var rl = document.createElement("label"); rl.className = "form-check-label ms-1"; rl.textContent = "Required";
    var rw = document.createElement("div"); rw.className = "form-check mb-3"; rw.appendChild(req); rw.appendChild(rl); f.appendChild(rw);
    return f;
  }
  function rawSqlForm() {
    var f = document.createElement("div");
    var ta = document.createElement("textarea"); ta.id = "w-sql"; ta.className = "to-code form-control font-monospace"; ta.setAttribute("mode", "text/x-sql");
    ta.rows = 10; ta.spellcheck = false; ta.value = "-- Write your SQL here\n";
    f.appendChild(labeled("SQL", ta));
    return f;
  }
  function seedMasterForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table", tSel));
    var keySel = document.createElement("select"); keySel.id = "w-key"; keySel.className = "form-select";
    keySel.appendChild(option("id", "id", true));
    f.appendChild(labeled("Key column", keySel));
    var rowsTa = document.createElement("textarea"); rowsTa.id = "w-rows"; rowsTa.className = "to-code form-control font-monospace"; rowsTa.setAttribute("mode", "application/json");
    rowsTa.rows = 8; rowsTa.spellcheck = false; rowsTa.value = "[\n  { \"code\": \"ES\", \"name\": \"Spain\" }\n]";
    f.appendChild(labeled("Rows (JSON array)", rowsTa));
    setTimeout(function () {
      var ts = document.getElementById("w-table");
      if (ts) ts.addEventListener("change", function () {
        var ks = document.getElementById("w-key"); if (!ks) return;
        clear(ks); fieldNames(ts.value).forEach(function (fld) { ks.appendChild(option(fld, fld)); });
      });
    }, 50);
    return f;
  }
  function seedTruncateForm() {
    var f = document.createElement("div");
    var tSel = newTableSelect("w-table"); f.appendChild(labeled("Table to clear", tSel));
    var warn = document.createElement("div"); warn.className = "alert alert-warning";
    warn.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>This will delete <strong>all rows</strong> from the selected table on every run.';
    f.appendChild(warn);
    return f;
  }

  function confirmWizard() {
    if (!activeWizard) return;
    var generators = {
      "copy-field": genCopyField, "create-index": genCreateIndex, "transform": genTransform,
      "add-field": genAddField, "raw-sql": genRawSql, "seed-master": genSeedMaster, "seed-truncate": genSeedTruncate
    };
    var gen = generators[activeWizard];
    if (!gen) return;
    var result = gen();
    if (!result) return; // validation failed inside generator

    if (result.kind === "seed-entry") {
      // Para wizards de seed: añaden una entrada a state.tables y cambian el tipo
      state.tables = state.tables || [];
      state.tables.push(result.entry);
      state.mode = state.mode || "upsert";
    } else if (result.steps) {
      state.steps = state.steps || [];
      result.steps.forEach(function (s) { state.steps.push(s); });
    } else if (result.fullState) {
      state = result.fullState; state.kind = "seed"; state.originalFile = "";
    }
    syncRawJson(); renderFixedControls(); renderWizardButtons(); renderSteps();
    var modalEl = el("wizardModal");
    if (window.bootstrap) { var bs = bootstrap.Modal.getInstance(modalEl); if (bs) bs.hide(); }
    activeWizard = null;
    flash("Step(s) added. Review and save.", true);
  }

  function val(id) {
    var e = document.getElementById(id); if (!e) return "";
    // Si el textarea está respaldado por Monaco, lee del modelo del editor.
    var editor = monacoEditors.get(e);
    return (editor ? editor.getValue() : e.value).trim();
  }
  function chk(id) { var e = document.getElementById(id); return e ? e.checked : false; }
  function requireFields(pairs) {
    for (var i = 0; i < pairs.length; i++) { if (!pairs[i][1]) { flash(pairs[i][0] + " is required", false); return false; } }
    return true;
  }

  function genCopyField() {
    var table = val("w-table"), from = val("w-field-from"), to = val("w-field-to");
    if (!requireFields([["Table", table], ["Source field", from], ["Destination field", to]])) return null;
    var steps = [];
    if (chk("w-create-dest")) steps.push({ action: "ensure_field", table: table, field: to, type: "String" });
    steps.push({ action: "raw_sql", sql: "UPDATE " + table + " SET " + to + " = " + from + " WHERE " + to + " IS NULL" });
    if (!state.name) { state.name = "copy-" + from + "-to-" + to; }
    return { steps: steps };
  }
  function genCreateIndex() {
    var table = val("w-table"), cols = val("w-columns"), idxName = val("w-index-name");
    if (!requireFields([["Table", table], ["Columns", cols], ["Index name", idxName]])) return null;
    var sql = "CREATE " + (chk("w-unique") ? "UNIQUE " : "") + "INDEX IF NOT EXISTS " + idxName + " ON " + table + "(" + cols + ")";
    if (!state.name) state.name = idxName;
    return { steps: [{ action: "raw_sql", sql: sql }] };
  }
  function genTransform() {
    var table = val("w-table"), sql = val("w-sql");
    if (!requireFields([["Table", table], ["SQL", sql]])) return null;
    if (!state.name) state.name = "transform-" + table;
    return { steps: [{ action: "raw_sql", sql: sql }] };
  }
  function genAddField() {
    var table = val("w-table"), field = val("w-field"), type = val("w-type");
    if (!requireFields([["Table", table], ["Field", field]])) return null;
    if (!state.name) state.name = "add-" + field + "-to-" + table;
    return { steps: [{ action: "ensure_field", table: table, field: field, type: type || "String", required: chk("w-required") }] };
  }
  function genRawSql() {
    var sql = val("w-sql");
    if (!requireFields([["SQL", sql]])) return null;
    if (!state.name) state.name = "custom-sql";
    return { steps: [{ action: "raw_sql", sql: sql }] };
  }
  function genSeedMaster() {
    var table = val("w-table"), key = val("w-key"), rowsRaw = val("w-rows");
    if (!requireFields([["Table", table]])) return null;
    var rows; try { rows = JSON.parse(rowsRaw || "[]"); } catch (e) { flash("Rows must be valid JSON: " + e.message, false); return null; }
    if (!state.name) state.name = table + "-master-data";
    return { kind: "seed-entry", entry: { table: table, key: key || "id", rows: rows } };
  }
  function genSeedTruncate() {
    var table = val("w-table");
    if (!requireFields([["Table", table]])) return null;
    state.mode = "truncate";
    if (!state.name) state.name = "clear-" + table;
    return { kind: "seed-entry", entry: { table: table, key: "id", rows: [] } };
  }

  // ─── Event wiring ──────────────────────────────────────────
  document.addEventListener("click", function (e) {
    var newMigration = e.target.closest("#btn-new-migration");
    if (newMigration) { e.preventDefault(); loadTables().then(function () { openEditor("migration", null, ""); }); }

    var newSeed = e.target.closest("#btn-new-seed");
    if (newSeed) { e.preventDefault(); loadTables().then(function () { openEditor("seed", null, ""); }); }

    var editMigration = e.target.closest(".edit-migration-btn");
    if (editMigration) {
      e.preventDefault();
      fetch(apiUrl("/project-sync/api/migrations") + "&kind=migration&file=" + encodeURIComponent(editMigration.dataset.file))
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.ok) loadTables().then(function () { openEditor("migration", j.data, editMigration.dataset.file); }); else flash(j.error || "Could not load", false); });
    }
    var editSeed = e.target.closest(".edit-seed-btn");
    if (editSeed) {
      e.preventDefault();
      fetch(apiUrl("/project-sync/api/migrations") + "&kind=seed&file=" + encodeURIComponent(editSeed.dataset.file))
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.ok) loadTables().then(function () { openEditor("seed", j.data, editSeed.dataset.file); }); else flash(j.error || "Could not load", false); });
    }
    var deleteBtn = e.target.closest(".delete-data-btn");
    if (deleteBtn) { e.preventDefault(); deleteFile(deleteBtn.dataset.file, deleteBtn.dataset.kind); }

    if (e.target.closest("#data-editor-validate")) { e.preventDefault(); validateContent(); }
    if (e.target.closest("#data-editor-save")) { e.preventDefault(); saveContent(); }
    if (e.target.closest("#wizard-confirm")) { e.preventDefault(); confirmWizard(); }
  });

  // Sincronización al cambiar de pestaña: JSON → Form re-parsea
  document.addEventListener("click", function (e) {
    var jsonTab = e.target.closest("#tab-form-btn");
    if (jsonTab) { parseFromRawJson(); }
  });
})();
