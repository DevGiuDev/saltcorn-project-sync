/**
 * Project page renderers: list, form, detail.
 */
const {
  escapeHtml, card, statCard, emptyState, badge, filterableTable, pageShell,
  kindIcon, renderTabBar, renderTabPane,
} = require("../../ui");

// ─── Helpers ───────────────────────────────────────────────

function obj_auto_tags(items) {
  return [...new Set(items.map((i) => i.auto_detected || "none"))].filter((v, _i, arr) => arr.length > 1 || v !== "none");
}

function collectSaltcornTags(items) {
  const set = new Set();
  for (const obj of items) {
    if (Array.isArray(obj.tags)) {
      for (const t of obj.tags) set.add(t);
    }
  }
  return [...set];
}

// ─── Project list ──────────────────────────────────────────

function renderProjectList(projects) {
  if (!projects.length) {
    return pageShell("Projects", "/project-sync/projects",
      card({ title: "Projects", icon: "fa-folder-open", headerRight: '<a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a>',
        body: emptyState("fa-folder-open", "No projects yet. Define which objects from this Saltcorn tenant belong to each project.", "/project-sync/projects/new", "Create project")
      })
    );
  }

  const projectCards = projects.map((p) => `
    <div class="col-sm-6 col-lg-4 mb-3">
      <a href="/project-sync/projects/${p.id}" class="card card-link h-100">
        <div class="card-body p-3">
          <div class="d-flex align-items-center mb-2">
            <div class="avatar bg-primary-lt rounded me-3" style="width:40px;height:40px;">
              <i class="fas fa-folder text-primary"></i>
            </div>
            <div>
              <div class="fw-bold">${escapeHtml(p.name)}</div>
              <div class="small text-muted"><code>${escapeHtml(p.slug)}</code></div>
            </div>
          </div>
          ${p.description ? `<p class="small text-muted mb-2">${escapeHtml(p.description)}</p>` : ""}
          <div class="small">
            ${p.root_path ? `<span class="me-2"><i class="fas fa-hdd me-1"></i>${escapeHtml(p.root_path)}</span>` : ""}
            ${p.updated_at ? `<span class="text-muted"><i class="fas fa-clock me-1"></i>${new Date(p.updated_at).toLocaleDateString()}</span>` : ""}
          </div>
        </div>
      </a>
    </div>`).join("");

  return pageShell("Projects", "/project-sync/projects",
    card({
      title: "Projects",
      subtitle: "Define which objects from this tenant belong to each project",
      icon: "fa-folder-open",
      iconColor: "teal",
      headerRight: '<a href="/project-sync/projects/new" class="btn btn-primary btn-sm"><i class="fas fa-plus me-1"></i>New project</a>',
      body: `<div class="row">${projectCards}</div>`,
    })
  );
}

// ─── Project form ──────────────────────────────────────────

function renderProjectForm(project = null) {
  const isNew = !project;
  return pageShell(isNew ? "New Project" : "Edit Project", "/project-sync/projects",
    card({
      title: isNew ? "New project" : "Edit project",
      icon: isNew ? "fa-plus" : "fa-pen",
      body: `
<form id="project-form">
  <div class="mb-3">
    <label class="form-label">Name</label>
    <input type="text" id="inp-name" class="form-control" value="${escapeHtml(project?.name || "")}" required />
  </div>
  <div class="mb-3">
    <label class="form-label">Slug</label>
    <input type="text" id="inp-slug" class="form-control" value="${escapeHtml(project?.slug || "")}" placeholder="auto-generated from name" />
    <small class="form-text text-muted">Used as directory and git repo name.</small>
  </div>
  <div class="mb-3">
    <label class="form-label">Description</label>
    <textarea id="inp-description" class="form-control" rows="2">${escapeHtml(project?.description || "")}</textarea>
  </div>
  <div class="mb-3">
    <label class="form-label">Minimum Saltcorn version</label>
    <input type="text" id="inp-min-version" class="form-control" value="${escapeHtml(project?.min_version || "1.6.0")}" />
  </div>
  <button type="submit" class="btn btn-primary">${isNew ? "Create project" : "Save changes"}</button>
  <a href="/project-sync/projects" class="btn btn-secondary ms-2">Cancel</a>
</form>
<div id="status-msg" class="alert mt-3" style="display:none;"></div>
<script>
(function() {
  document.getElementById('project-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var el = function(id) { return document.getElementById(id); };
    var body = {
      name: el('inp-name').value,
      slug: el('inp-slug').value || undefined,
      description: el('inp-description').value,
      min_version: el('inp-min-version').value
    };
    if (!body.name) return;
    var msgEl = document.getElementById('status-msg');
    fetch('/project-sync/api/projects', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); })
      .then(function(j) {
        if (j.ok && j.project) {
          window.location = '/project-sync/projects/' + j.project.id;
        } else {
          msgEl.style.display = 'block';
          msgEl.className = 'alert alert-danger';
          msgEl.textContent = j.error || 'Failed to create project';
        }
      })
      .catch(function(err) {
        msgEl.style.display = 'block';
        msgEl.className = 'alert alert-danger';
        msgEl.textContent = err.message;
      });
  });
})();
<\/script>`,
    })
  );
}

// ─── Project detail ────────────────────────────────────────

function renderProjectDetail(project, scoped) {
  const OBJECT_LABELS = {
    tables: "Tables", views: "Views", pages: "Pages",
    triggers: "Triggers", roles: "Roles", plugins: "Plugins",
    menu: "Menu",
  };

  const tabData = [];
  for (const [kind, label] of Object.entries(OBJECT_LABELS)) {
    const items = scoped[kind] || [];
    const included = items.filter((o) => o.included).length;
    tabData.push({ kind, label, items, included, total: items.length });
  }

  const visibleTabs = tabData.filter((t) => t.total > 0);
  const activeTab = visibleTabs.length ? visibleTabs[0].kind : "";

  let totalIncluded = 0, totalItems = 0;
  for (const t of tabData) {
    totalItems += t.total;
    totalIncluded += t.included;
  }

  const summaryStats = `
  <div class="row mb-4">
    ${statCard("Included", totalIncluded, "fa-check-circle", "success")}
    ${statCard("Excluded", totalItems - totalIncluded, "fa-times-circle", totalItems - totalIncluded ? "warning" : "success")}
    ${statCard("Version", project.min_version || "1.6.0", "fa-code-branch", "info")}
    ${statCard("Root", project.root_path ? "Set" : "Not set", "fa-hdd", project.root_path ? "primary" : "secondary")}
  </div>`;

  function typeTags(kind, items) {
    const tags = [{ key: "_included", label: "Status" }];
    switch (kind) {
      case "tables": {
        const hasSystem = items.some((o) => o.is_system);
        if (hasSystem) tags.push({ key: "_is_system", label: "System" });
        break;
      }
      case "views": {
        const vts = [...new Set(items.map((o) => o.viewtemplate || "—"))].filter((v) => v && v !== "—");
        if (vts.length > 1) tags.push({ key: "_viewtemplate", label: "Viewtemplate" });
        const tbls = [...new Set(items.map((o) => o.table_name || "—"))].filter((v) => v && v !== "—");
        if (tbls.length > 1) tags.push({ key: "_table_name", label: "Table" });
        break;
      }
      case "triggers": {
        const acts = [...new Set(items.map((o) => o.action || "—"))].filter((v) => v && v !== "—");
        if (acts.length > 1) tags.push({ key: "_action", label: "Action" });
        const tbls = [...new Set(items.map((o) => o.table_name || "—"))].filter((v) => v && v !== "—");
        if (tbls.length > 1) tags.push({ key: "_table_name", label: "Table" });
        break;
      }
      case "plugins": {
        const srcs = [...new Set(items.map((o) => o.source || "—"))].filter((v) => v && v !== "—");
        if (srcs.length > 1) tags.push({ key: "_source", label: "Source" });
        break;
      }
    }
    const autoVals = obj_auto_tags(items);
    if (autoVals.length > 1) tags.push({ key: "_auto", label: "Detection" });
    const saltcornTags = collectSaltcornTags(items);
    if (saltcornTags.length >= 1) tags.push({ key: "_sc_tag", label: "Tags", multi_match: true });
    return tags;
  }

  function typeColumns(kind, items) {
    const base = [
      { key: "toggle", label: "✓" },
      { key: "name", label: "Name" },
    ];
    const hasScTags = items && items.some((o) => Array.isArray(o.tags) && o.tags.length > 0);
    const tagsCol = hasScTags ? [{ key: "sc_tags", label: "Tags" }] : [];
    switch (kind) {
      case "tables":
        return [...base, { key: "detail", label: "Fields" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "views":
        return [...base, { key: "viewtemplate", label: "Template" }, { key: "table_col", label: "Table" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "triggers":
        return [...base, { key: "action_col", label: "Action" }, { key: "table_col", label: "Table" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "plugins":
        return [...base, { key: "detail", label: "Version" }, { key: "source_col", label: "Source" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "roles":
        return [...base, { key: "detail", label: "Detail" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "pages":
        return [...base, { key: "detail", label: "Title" }, ...tagsCol, { key: "auto", label: "Auto" }];
      case "menu":
        return [...base, { key: "detail", label: "Items" }, ...tagsCol, { key: "auto", label: "Auto" }];
      default:
        return [...base, { key: "detail", label: "Detail" }, ...tagsCol, { key: "auto", label: "Auto" }];
    }
  }

  function typeRows(kind, items) {
    return items.map((obj) => {
      const checked = obj.included ? "checked" : "";
      const autoTag = obj.auto_detected
        ? `<span class="badge bg-${obj.included ? "info" : "secondary"}-lt">${escapeHtml(obj.auto_detected)}</span>`
        : '<span class="badge bg-light text-muted">—</span>';

      let detail = '<span class="text-muted">—</span>';
      switch (kind) {
        case "tables":
          detail = obj.field_count !== undefined ? `<small class="text-muted">${obj.field_count} fields</small>` : '<span class="text-muted">—</span>';
          break;
        case "views":
          detail = obj.viewtemplate ? `<span class="badge bg-info-lt text-info">${escapeHtml(obj.viewtemplate)}</span>` : '<span class="text-muted">—</span>';
          break;
        case "triggers":
          detail = obj.action ? `<code class="small">${escapeHtml(obj.action)}</code>` : '<span class="text-muted">—</span>';
          break;
        case "plugins":
          detail = obj.version ? `<small class="text-muted">v${escapeHtml(obj.version)}</small>` : '<span class="text-muted">—</span>';
          break;
        case "roles":
          detail = obj.id !== undefined ? `<small class="text-muted">role #${obj.id}</small>` : '<span class="text-muted">—</span>';
          break;
        case "pages":
          detail = obj.title ? `<small class="text-muted">${escapeHtml(obj.title)}</small>` : '<span class="text-muted">—</span>';
          break;
        case "menu":
          detail = obj.item_count !== undefined ? `<small class="text-muted">${obj.item_count} items</small>` : '<span class="text-muted">—</span>';
          break;
      }

      const row = {
        toggle: `<input type="checkbox" ${checked} data-kind="${kind}" data-name="${escapeHtml(obj.name)}" class="scope-toggle form-check-input" />`,
        name: `<code>${escapeHtml(obj.name)}</code>`,
        detail,
        auto: autoTag,
        _included: obj.included ? "included" : "excluded",
        _auto: obj.auto_detected || "none",
        sc_tags: Array.isArray(obj.tags) && obj.tags.length
          ? obj.tags.map((t) => `<span class="badge bg-purple-lt text-purple me-1">${escapeHtml(t)}</span>`).join("")
          : '<span class="text-muted">—</span>',
        _sc_tag: Array.isArray(obj.tags) && obj.tags.length ? obj.tags.join("|") : "—",
      };

      switch (kind) {
        case "tables":
          row._is_system = obj.is_system ? "system" : "user";
          break;
        case "views":
          row.viewtemplate = obj.viewtemplate ? `<span class="badge bg-info-lt text-info">${escapeHtml(obj.viewtemplate)}</span>` : '<span class="text-muted">—</span>';
          row.table_col = obj.table_name ? `<code class="small">${escapeHtml(obj.table_name)}</code>` : '<span class="text-muted">—</span>';
          row._viewtemplate = obj.viewtemplate || "—";
          row._table_name = obj.table_name || "—";
          break;
        case "triggers":
          row.action_col = obj.action ? `<code class="small">${escapeHtml(obj.action)}</code>` : '<span class="text-muted">—</span>';
          row.table_col = obj.table_name ? `<code class="small">${escapeHtml(obj.table_name)}</code>` : '<span class="text-muted">—</span>';
          row._action = obj.action || "—";
          row._table_name = obj.table_name || "—";
          break;
        case "plugins":
          row.source_col = obj.source ? `<small class="text-muted">${escapeHtml(obj.source)}</small>` : '<span class="text-muted">—</span>';
          row._source = obj.source || "—";
          break;
      }

      return row;
    });
  }

  const tabPanes = visibleTabs.map((t) => {
    const tags = typeTags(t.kind, t.items);
    const columns = typeColumns(t.kind, t.items);
    const rows = typeRows(t.kind, t.items);
    const isActive = t.kind === activeTab;
    const table = filterableTable(`scope-${t.kind}`, columns, rows, {
      tags, compact: true, searchable: true, emptyMsg: `No ${t.label.toLowerCase()}.`,
    });

    const body = `
      <div class="d-flex justify-content-between align-items-center mb-3 pt-2">
        <h6 class="mb-0"><i class="fas ${kindIcon(t.kind)} me-1"></i>${escapeHtml(t.label)} <span class="badge bg-primary-lt ms-1">${t.included}/${t.total}</span></h6>
        <button class="btn btn-outline-secondary btn-sm toggle-all-btn" data-kind="${t.kind}"><i class="fas fa-check-double me-1"></i>Toggle all</button>
      </div>
      ${table}`;

    return renderTabPane(t.kind, body, isActive);
  }).join("");

  const tabBar = renderTabBar(
    visibleTabs.map((t) => ({
      id: t.kind,
      label: t.label,
      icon: kindIcon(t.kind).replace("fa ", ""),
      badge: t.included < t.total ? `${t.included}/${t.total}` : t.total,
      badgeColor: t.included < t.total ? "warning" : "success",
    })),
    activeTab
  );

  const projectDetailScript = `
  <script>
  (function() {
    const projectId = ${project.id};

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
        entries.push({
          object_type: cb.dataset.kind,
          object_name: cb.dataset.name,
          included: cb.checked
        });
      });
      return entries;
    }

    document.getElementById('btn-save-scope').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(getScope())
      }).then(function(r) { return r.json(); })
        .then(function(j) { showMsg('Scope saved (' + j.count + ' entries)', j.ok); })
        .catch(function(e) { showMsg(e.message, false); });
    });

    document.getElementById('btn-auto-detect').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/auto-detect', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(j) {
          if (j.ok) location.reload();
          else showMsg(j.error || 'Failed', false);
        })
        .catch(function(e) { showMsg(e.message, false); });
    });

    document.getElementById('btn-download').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/scope', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(getScope())
      }).then(function() {
        fetch('/project-sync/api/projects/' + projectId + '/download', { method: 'POST' })
          .then(function(r) {
            if (!r.ok) return r.json().then(function(j) { throw new Error(j.error); });
            return r.blob();
          })
          .then(function(blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '${escapeHtml(project.slug)}-project.zip';
            a.click();
          })
          .catch(function(e) { showMsg(e.message, false); });
      }).catch(function(e) { showMsg(e.message, false); });
    });

    ${project.root_path ? `
    document.getElementById('btn-write-disk').addEventListener('click', function() {
      fetch('/project-sync/api/projects/' + projectId + '/write-disk', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(j) { showMsg(j.ok ? 'Written to disk: ' + j.path : j.error, j.ok); })
        .catch(function(e) { showMsg(e.message, false); });
    });` : ""}

    document.querySelectorAll('.toggle-all-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.dataset.kind;
        var boxes = document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]');
        var allChecked = true;
        boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
        boxes.forEach(function(cb) { cb.checked = !allChecked; });
      });
    });

    document.querySelectorAll('.scope-toggle').forEach(function(cb) {
      cb.addEventListener('click', function(e) {
        if (e.shiftKey) {
          var kind = cb.dataset.kind;
          var newState = cb.checked;
          document.querySelectorAll('.scope-toggle[data-kind="' + kind + '"]').forEach(function(other) {
            other.checked = newState;
          });
        }
      });
    });
  })();
  <\/script>`;

  return pageShell(`Project: ${project.name}`, "/project-sync/projects",
    card({
      title: escapeHtml(project.name),
      subtitle: `${badge(project.slug, "primary")} ${project.description ? ` · ${escapeHtml(project.description)}` : ""}`,
      icon: "fa-folder-open",
      iconColor: "primary",
      headerRight: `
        <div class="btn-group btn-group-sm">
          <button id="btn-download" class="btn btn-success"><i class="fas fa-download me-1"></i>ZIP</button>
          ${project.root_path ? '<button id="btn-write-disk" class="btn btn-outline-secondary"><i class="fas fa-hdd me-1"></i>Write disk</button>' : ""}
          <button id="btn-auto-detect" class="btn btn-outline-secondary"><i class="fas fa-sync me-1"></i>Re-detect</button>
          <button id="btn-save-scope" class="btn btn-primary"><i class="fas fa-check me-1"></i>Save scope</button>
        </div>`,
      body: `
  ${summaryStats}
  <div id="status-msg" class="alert" style="display:none;"></div>
  ${tabBar}
  <div class="tab-content border border-top-0 rounded-bottom p-3 bg-white">${tabPanes}</div>
  ${projectDetailScript}`,
    })
  );
}

module.exports = { renderProjectList, renderProjectForm, renderProjectDetail };
