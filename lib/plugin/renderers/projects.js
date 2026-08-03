const { renderFilterableTable, escapeHtml, icon, globalNav, projectNav } = require("./_shared");

function linkCard(project) {
  const landing = project.ui_mode === "deployment"
    ? `/project-sync/projects/${encodeURIComponent(project.id)}/deploy?environment=${encodeURIComponent(project.environment || "dev")}`
    : `/project-sync/projects/${encodeURIComponent(project.id)}`;
  return `
    <div class="col-md-6 col-xl-4 mb-3">
      <a href="${landing}" class="card card-link h-100 text-decoration-none text-reset">
        <div class="card-body">
          <h5 class="card-title mb-1"><i class="fas fa-folder me-2"></i>${escapeHtml(project.name)}</h5>
          <div class="mb-2"><code>${escapeHtml(project.slug)}</code></div>
          ${project.ui_mode === "deployment" ? '<span class="badge bg-info text-dark mb-2">Deployment server</span>' : ""}
          ${project.description ? `<p class="small text-muted mb-2">${escapeHtml(project.description)}</p>` : ""}
          <div class="small text-muted">
            ${project.root_path ? `<div><i class="fas fa-hdd me-1"></i>${escapeHtml(project.root_path)}</div>` : ""}
            ${project.updated_at ? `<div><i class="fas fa-clock me-1"></i>${new Date(project.updated_at).toLocaleDateString()}</div>` : ""}
          </div>
        </div>
      </a>
    </div>`;
}

function renderProjectList(projects) {
  if (!projects.length) {
    return globalNav("projects") +
      '<div class="card card-max-full-screen"><div class="card-header d-flex justify-content-between align-items-center"><h5 class="mb-0"><i class="fas fa-folder-open me-2"></i>Projects</h5><a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a></div><div class="card-body text-center text-muted py-5"><i class="fas fa-folder-open fa-3x opacity-25 mb-3"></i><p>No projects yet. Define which objects from this Saltcorn tenant belong to each project.</p><a href="/project-sync/projects/new" class="btn btn-primary btn-sm">Create project</a></div></div>';
  }
  const deploymentOnly = projects.every((project) => project.ui_mode === "deployment");
  return globalNav("projects") +
    '<div class="card card-max-full-screen"><div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem"><div><h5 class="mb-0"><i class="fas ' + (deploymentOnly ? 'fa-server' : 'fa-folder-open') + ' me-2"></i>' + (deploymentOnly ? 'Deployment targets' : 'Projects') + '</h5><div class="small text-muted mt-1">' + (deploymentOnly ? 'Choose a target to review and launch a deployment' : 'Define which objects from this tenant belong to each project') + '</div></div>' + (deploymentOnly ? '' : '<a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a>') + '</div><div class="card-body"><div class="row">' +
    projects.map(linkCard).join("") +
    '</div></div></div>';
}

function renderProjectForm(project = null) {
  const isNew = !project;
  return globalNav("projects") +
    '<div class="card card-max-full-screen"><div class="card-header"><h5 class="mb-0"><i class="fas ' + (isNew ? 'fa-plus' : 'fa-pen') + ' me-2"></i>' + (isNew ? 'New project' : 'Edit project') + '</h5></div><div class="card-body">' +
    '<form id="project-form">' +
      '<div class="mb-3"><label class="form-label">Name</label><input id="inp-name" class="form-control" value="' + escapeHtml(project?.name || "") + '" required></div>' +
      '<div class="mb-3"><label class="form-label">Slug</label><input id="inp-slug" class="form-control" value="' + escapeHtml(project?.slug || "") + '" placeholder="auto-generated from name"><div class="form-text">Used as directory and git repo name.</div></div>' +
      '<div class="mb-3"><label class="form-label">Description</label><textarea id="inp-description" class="form-control" rows="2">' + escapeHtml(project?.description || "") + '</textarea></div>' +
      '<div class="mb-3"><label class="form-label">Minimum Saltcorn version</label><input id="inp-min-version" class="form-control" value="' + escapeHtml(project?.min_version || "1.6.0") + '"></div>' +
      '<div class="d-flex align-items-center" style="gap:.5rem"><button type="submit" class="btn btn-primary">' + (isNew ? 'Create project' : 'Save changes') + '</button><a href="/project-sync/projects" class="btn btn-secondary">Cancel</a></div>' +
    '</form><div id="status-msg" class="alert mt-3" style="display:none;"></div>' +
    `<script>(function(){document.getElementById('project-form').addEventListener('submit',function(e){e.preventDefault();var el=function(id){return document.getElementById(id);};var body={name:el('inp-name').value,slug:el('inp-slug').value||undefined,description:el('inp-description').value,min_version:el('inp-min-version').value};if(!body.name)return;var msgEl=document.getElementById('status-msg');fetch('/project-sync/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(j){if(j.ok&&j.project){window.location='/project-sync/projects/'+j.project.id;}else{msgEl.style.display='block';msgEl.className='alert alert-danger';msgEl.textContent=j.error||'Failed to create project';}}).catch(function(err){msgEl.style.display='block';msgEl.className='alert alert-danger';msgEl.textContent=err.message;});});})();<\/script>` +
    '</div></div>';
}

function objectDetail(kind, obj) {
  switch (kind) {
    case "tables": return obj.field_count !== undefined ? `<small class="text-muted">${obj.field_count} fields</small>` : '<span class="text-muted">—</span>';
    case "views": return obj.viewtemplate ? `<span class="badge bg-info">${escapeHtml(obj.viewtemplate)}</span>` : '<span class="text-muted">—</span>';
    case "triggers": return obj.action ? `<code class="small">${escapeHtml(obj.action)}</code>` : '<span class="text-muted">—</span>';
    case "plugins": return obj.version ? `<small class="text-muted">v${escapeHtml(obj.version)}</small>` : '<span class="text-muted">—</span>';
    case "roles": return obj.id !== undefined ? `<small class="text-muted">role #${obj.id}</small>` : '<span class="text-muted">—</span>';
    case "pages": return obj.title ? `<small class="text-muted">${escapeHtml(obj.title)}</small>` : '<span class="text-muted">—</span>';
    case "menu": return obj.item_count !== undefined ? `<small class="text-muted">${obj.item_count} items</small>` : '<span class="text-muted">—</span>';
    case "settings": return '<small class="text-muted">stable setting</small>';
    default: return '<span class="text-muted">—</span>';
  }
}

function objectTable(kind, items) {
  const rows = items.map((obj) => ({
    toggle: `<input type="checkbox" ${obj.included === true ? "checked" : ""} data-kind="${kind}" data-name="${escapeHtml(obj.name)}" class="scope-toggle form-check-input" aria-label="Include ${escapeHtml(obj.name)}" />`,
    name: `<code>${escapeHtml(obj.name)}</code>`,
    detail: objectDetail(kind, obj),
    tags: Array.isArray(obj.tags) && obj.tags.length ? obj.tags.map((tag) => `<span class="badge bg-secondary me-1">${escapeHtml(tag)}</span>`).join("") : '<span class="text-muted">—</span>',
    auto: obj.scope_pending
      ? '<span class="badge bg-warning text-dark" title="Detected in the tenant but not persisted in this project scope">new · save</span>'
      : (obj.auto_detected ? `<span class="badge bg-${obj.included ? "info" : "secondary"}">${escapeHtml(obj.auto_detected)}</span>` : '<span class="badge bg-light text-dark">saved</span>'),
  }));
  return renderFilterableTable(`scope-table-${kind}`, [
    { key: (row) => row.toggle, label: "✓", filter: false },
    { key: (row) => row.name, label: "Name" },
    { key: (row) => row.detail, label: "Detail" },
    { key: (row) => row.tags, label: "Tags" },
    { key: (row) => row.auto, label: "Auto" },
  ], rows, { hover: true, class: "table-bordered" });
}

function renderProjectDetail(project, scoped, { uiMode = "full" } = {}) {
  const sections = [
    ["tables", "Tables", scoped.tables || []],
    ["views", "Views", scoped.views || []],
    ["pages", "Pages", scoped.pages || []],
    ["triggers", "Triggers", scoped.triggers || []],
    ["roles", "Roles", scoped.roles || []],
    ["plugins", "Plugins", scoped.plugins || []],
    ["menu", "Menu", scoped.menu || []],
    ["settings", "Settings", scoped.settings || []],
  ].filter(([, , items]) => items.length > 0);

  const totalItems = sections.reduce((sum, [, , items]) => sum + items.length, 0);
  const totalIncluded = sections.reduce((sum, [, , items]) => sum + items.filter((item) => item.included).length, 0);
  const pendingItems = sections.reduce((sum, [, , items]) => sum + items.filter((item) => item.scope_pending).length, 0);

  const tabs = sections.map(([kind, label, items], ix) => `
    <li class="nav-item" role="presentation">
      <button class="nav-link ${ix === 0 ? "active" : ""}" id="scope-${kind}-tab" data-bs-toggle="tab" data-bs-target="#scope-${kind}" type="button" role="tab">${escapeHtml(label)} <span class="badge bg-primary ms-1">${items.filter((item) => item.included).length}/${items.length}</span></button>
    </li>`).join("");

  const panes = sections.map(([kind, label, items], ix) => `
    <div class="tab-pane fade ${ix === 0 ? "show active" : ""}" id="scope-${kind}" role="tabpanel">
      <div class="d-flex justify-content-between align-items-center mb-3 pt-2">
        <h6 class="mb-0"><i class="fas fa-folder-open me-1"></i>${escapeHtml(label)}</h6>
        <button class="btn btn-outline-secondary btn-sm toggle-all-btn" data-kind="${kind}"><i class="fas fa-check-double me-1"></i>Toggle all</button>
      </div>
      ${objectTable(kind, items)}
    </div>`).join("");

  const projectDetailScript = `
  <script>
  (function() {
    const projectId = ${project.id};
    const saveButton = document.getElementById('btn-save-scope');
    let scopeDirty = false;
    function markScopeDirty() {
      scopeDirty = true;
      saveButton.className = 'btn btn-warning btn-sm';
      saveButton.innerHTML = '<i class="fas fa-save me-1"></i>Save scope *';
    }
    function markScopeClean() {
      scopeDirty = false;
      saveButton.className = 'btn btn-primary btn-sm';
      saveButton.innerHTML = '<i class="fas fa-check me-1"></i>Save scope';
    }
    function showMsg(text, ok) {
      const el = document.getElementById('status-msg');
      el.style.display = 'block';
      el.className = 'alert alert-' + (ok ? 'success' : 'danger');
      el.textContent = text;
      setTimeout(function() { el.style.display = 'none'; }, 4000);
    }
    function getScope() {
      const entries = [];
      document.querySelectorAll('.scope-toggle').forEach(function(cb) {
        entries.push({ object_type: cb.dataset.kind, object_name: cb.dataset.name, included: cb.checked });
      });
      return entries;
    }
    document.getElementById('btn-save-scope').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(getScope()) })
        .then(function(r) { return r.json(); })
        .then(function(j) { if (j.ok) markScopeClean(); showMsg('Scope saved (' + j.count + ' entries)', j.ok); })
        .catch(function(e) { showMsg(e.message, false); });
    });
    document.getElementById('btn-auto-detect').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/auto-detect', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(j) { if (j.ok) location.reload(); else showMsg(j.error || 'Failed', false); })
        .catch(function(e) { showMsg(e.message, false); });
    });
    document.getElementById('btn-download').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(getScope()) }).then(function() {
        fetch('/project-sync/api/projects/' + projectId + '/download', { method: 'POST' })
          .then(function(r) { if (!r.ok) return r.json().then(function(j) { throw new Error(j.error); }); return r.blob(); })
          .then(function(blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '${escapeHtml(project.slug)}-project.zip'; a.click(); })
          .catch(function(e) { showMsg(e.message, false); });
      }).catch(function(e) { showMsg(e.message, false); });
    });
    ${project.root_path ? `document.getElementById('btn-write-disk').addEventListener('click', function() { fetch('/project-sync/api/projects/' + projectId + '/write-disk', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(j) { showMsg(j.ok ? 'Written to disk: ' + j.path : j.error, j.ok); }).catch(function(e) { showMsg(e.message, false); }); });` : ""}
    document.querySelectorAll('.toggle-all-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.dataset.kind;
        var boxes = document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]');
        var allChecked = true;
        boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
        boxes.forEach(function(cb) { cb.checked = !allChecked; });
        markScopeDirty();
      });
    });
    document.querySelectorAll('.scope-toggle').forEach(function(cb) {
      cb.addEventListener('click', function(e) {
        markScopeDirty();
        if (e.shiftKey) {
          var kind = cb.dataset.kind;
          var newState = cb.checked;
          document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]').forEach(function(other) { other.checked = newState; });
        }
      });
    });
    window.addEventListener('beforeunload', function(e) {
      if (!scopeDirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  })();
  <\/script>`;

  return globalNav("projects") +
    '<div class="card card-max-full-screen">' +
      '<div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem">' +
        `<div><h5 class="mb-0"><i class="fas fa-folder-open me-2"></i>${escapeHtml(project.name)}</h5><div class="small text-muted mt-1"><span class="badge bg-primary">${escapeHtml(project.slug)}</span>${project.description ? ' · ' + escapeHtml(project.description) : ''}</div></div>` +
        '<div class="d-flex flex-wrap" style="gap:.5rem">' +
          '<button id="btn-download" class="btn btn-success btn-sm"><i class="fas fa-download me-1"></i>ZIP</button>' +
          (project.root_path ? '<button id="btn-write-disk" class="btn btn-outline-secondary btn-sm"><i class="fas fa-hdd me-1"></i>Write disk</button>' : '') +
          '<button id="btn-auto-detect" class="btn btn-outline-secondary btn-sm"><i class="fas fa-sync me-1"></i>Re-detect</button>' +
          '<button id="btn-save-scope" class="btn btn-primary btn-sm"><i class="fas fa-check me-1"></i>Save scope</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        projectNav({ projectId: project.id, active: "scope", mode: uiMode }) +
        `<div class="row mb-4"><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Included</div><div class="h4 mb-0">${totalIncluded}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Excluded</div><div class="h4 mb-0">${totalItems - totalIncluded}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Pending save</div><div class="h4 mb-0${pendingItems ? ' text-warning' : ''}">${pendingItems}</div></div></div><div class="col-md-3 mb-2"><div class="border rounded p-3"><div class="small text-muted">Root</div><div class="h4 mb-0">${project.root_path ? "Set" : "Not set"}</div></div></div></div>` +
        (pendingItems ? `<div class="alert alert-warning d-flex align-items-start gap-2"><i class="fas fa-circle-info mt-1"></i><div><strong>${pendingItems} new tenant object${pendingItems === 1 ? '' : 's'} detected.</strong> They are intentionally unchecked until you choose them and press <em>Save scope</em>. This prevents an object from entering a deployment just because it was created in the tenant.</div></div>` : '') +
        '<div id="status-msg" class="alert" style="display:none"></div>' +
        '<ul class="nav nav-tabs" id="scope-tabs" role="tablist">' + tabs + '</ul>' +
        '<div class="tab-content border border-top-0 rounded-bottom p-3 bg-white">' + panes + '</div>' +
        projectDetailScript +
      '</div>' +
    '</div>';
}

module.exports = { renderProjectList, renderProjectForm, renderProjectDetail };
