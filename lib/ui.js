/**
 * Shared UI components for Saltcorn Project Sync views.
 *
 * Uses Saltcorn's built-in Tabler/Bootstrap classes.
 * All render helpers return HTML strings.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Navigation ────────────────────────────────────────────

const NAV_ITEMS = [
  { href: "/project-sync", label: "Overview", icon: "fa-home" },
  { href: "/project-sync/status", label: "Status", icon: "fa-heartbeat" },
  { href: "/project-sync/live-diff", label: "Live Diff", icon: "fa-exchange-alt" },
  { href: "/project-sync/plan-preview", label: "Plan", icon: "fa-tasks" },
  { href: "/project-sync/approvals", label: "Approvals", icon: "fa-shield-alt" },
  { href: "/project-sync/health", label: "Health", icon: "fa-stethoscope" },
  { href: "/project-sync/deployments", label: "Deployments", icon: "fa-rocket" },
  { href: "/project-sync/projects", label: "Projects", icon: "fa-folder-open" },
];

function renderNav(activeHref = "") {
  const links = NAV_ITEMS.map((item) => {
    const active = activeHref === item.href ? " active" : "";
    return `<a href="${item.href}" class="nav-link${active}">
      <i class="fas ${item.icon} me-1"></i>${item.label}
    </a>`;
  }).join("");

  return `<nav class="nav nav-tabs card-max-full-screen mb-4" style="gap:0;">${links}</nav>`;
}

// ─── Cards ─────────────────────────────────────────────────

function card({ title, subtitle, icon, iconColor, headerRight, body, classExtra = "" }) {
  const iconHtml = icon ? `<i class="fas ${icon} me-2${iconColor ? ` text-${iconColor}` : ""}"></i>` : "";
  const headerRightHtml = headerRight ? `<div>${headerRight}</div>` : "";
  const subtitleHtml = subtitle ? `<div class="small text-muted mt-1">${subtitleHtml_esc(subtitle)}</div>` : "";
  return `<div class="card mt-0 card-max-full-screen ${classExtra}">
  <div class="card-header d-flex justify-content-between align-items-center flex-wrap" style="gap:.5rem;">
    <div>
      <h5 class="mb-0">${iconHtml}${escapeHtml(title)}</h5>
      ${subtitleHtml}
    </div>
    ${headerRightHtml}
  </div>
  <div class="card-body">${body}</div>
</div>`;
}

function subtitleHtml_esc(s) {
  return escapeHtml(s);
}

function statCard(label, value, icon, color = "primary") {
  return `<div class="col-sm-6 col-lg-3 mb-3">
    <div class="card">
      <div class="card-body p-3 d-flex align-items-center">
        <div class="avatar bg-${color}-lt rounded me-3"><i class="fas ${icon} text-${color}"></i></div>
        <div>
          <div class="small text-muted">${escapeHtml(label)}</div>
          <div class="h3 mb-0">${value}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function emptyState(icon, message, actionHref, actionLabel) {
  const actionHtml = actionHref
    ? `<a href="${actionHref}" class="btn btn-primary btn-sm mt-2"><i class="fas fa-plus me-1"></i>${escapeHtml(actionLabel || "Create")}</a>`
    : "";
  return `<div class="text-center text-muted py-5">
    <i class="fas ${icon} fa-3x mb-3 opacity-25"></i>
    <p>${message}</p>
    ${actionHtml}
  </div>`;
}

// ─── Badges ────────────────────────────────────────────────

function badge(text, color = "secondary") {
  return `<span class="badge bg-${color}">${escapeHtml(text)}</span>`;
}

function statusBadge(ok, okLabel = "OK", errLabel = "Error") {
  return ok
    ? `<span class="badge bg-success-lt"><i class="fas fa-check me-1"></i>${okLabel}</span>`
    : `<span class="badge bg-danger-lt"><i class="fas fa-times me-1"></i>${errLabel}</span>`;
}

function countBadge(count, label, color = "primary") {
  return `<span class="badge bg-${color}-lt text-${color} me-1">${count} ${escapeHtml(label)}</span>`;
}

// ─── Tables ────────────────────────────────────────────────

function tableStart(id, headers, opts = {}) {
  const { searchable = false, filterable = false, filterOptions = [], compact = true } = opts;
  const searchHtml = searchable
    ? `<div class="mb-3">
        <input type="text" class="form-control form-control-sm" placeholder="Search…" id="${id}-search" style="max-width:300px;" />
      </div>`
    : "";
  const filterHtml = filterable && filterOptions.length
    ? `<div class="mb-3 d-flex flex-wrap" style="gap:.5rem;" id="${id}-filters">
        ${filterOptions.map((f) =>
          `<button class="btn btn-outline-secondary btn-sm filter-btn" data-filter="${escapeHtml(f.value)}">${escapeHtml(f.label)}</button>`
        ).join("")}
        <button class="btn btn-secondary btn-sm filter-btn active" data-filter="__all__">All</button>
      </div>`
    : "";
  const tableClass = `table table-hover align-middle mb-0${compact ? " table-sm" : ""}`;
  const thHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

  return `${searchHtml}${filterHtml}
  <div class="table-responsive">
    <table class="${tableClass}" id="${id}">
      <thead><tr>${thHtml}</tr></thead>
      <tbody>`;
}

function tableEnd(rowsHtml, emptyHtml = "") {
  if (!rowsHtml && emptyHtml) {
    return `</tbody></table></div>${emptyHtml}`;
  }
  return `</tbody></table></div>`;
}

function fullTable(id, headers, rowsHtml, opts = {}) {
  const { emptyIcon, emptyMsg, emptyAction, emptyLabel, ...tableOpts } = opts;
  const start = tableStart(id, headers, tableOpts);
  const end = tableEnd(rowsHtml, "");
  const empty = !rowsHtml || !rowsHtml.trim()
    ? emptyState(emptyIcon || "fa-inbox", emptyMsg || "No data", emptyAction, emptyLabel)
    : "";
  return `${start}${rowsHtml}${end}${empty}`;
}

/**
 * Renders a table with client-side search + tag filtering.
 *
 * `columns`: [{key, label}]
 * `rows`: [{key: value, ...}]
 * `opts.tags`: [{key, label}] — which columns to use as tag filters
 * `opts.searchable`: boolean
 */
function filterableTable(id, columns, rows, opts = {}) {
  const { searchable = true, tags = [], compact = true, emptyIcon, emptyMsg } = opts;

  if (!rows.length) {
    return emptyState(emptyIcon || "fa-inbox", emptyMsg || "No data found");
  }

  // Tag filter buttons
  const tagSections = tags.map((tag) => {
    const values = [...new Set(rows.map((r) => r[tag.key] || "—"))].sort();
    if (values.length <= 1) return "";
    const buttons = values.map((v) =>
      `<button class="btn btn-outline-secondary btn-sm" data-tag="${escapeHtml(tag.key)}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`
    ).join("");
    return `<div class="mb-2 d-flex align-items-center flex-wrap" style="gap:.35rem;">
      <span class="small text-muted me-1">${escapeHtml(tag.label)}:</span>
      ${buttons}
      <button class="btn btn-secondary btn-sm" data-tag="${escapeHtml(tag.key)}" data-value="__all__">All</button>
    </div>`;
  }).join("");

  const searchHtml = searchable
    ? `<div class="mb-3">
        <input type="text" class="form-control form-control-sm" placeholder="Filter rows…" id="${id}-search" style="max-width:320px;" />
      </div>`
    : "";

  const thHtml = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const trHtml = rows.map((row) => {
    const tdHtml = columns.map((c) => {
      const val = row[c.key];
      return `<td data-${c.key}="${escapeHtml(String(val ?? ""))}">${val !== undefined ? val : ""}</td>`;
    }).join("");
    const dataAttrs = Object.entries(row)
      .filter(([k]) => tags.some((t) => t.key === k))
      .map(([k, v]) => `data-tag-${k}="${escapeHtml(String(v ?? ""))}"`)
      .join(" ");
    return `<tr ${dataAttrs}>${tdHtml}</tr>`;
  }).join("");

  const tableClass = `table table-hover align-middle mb-0${compact ? " table-sm" : ""}`;

  return `${searchHtml}${tagSections}
  <div class="table-responsive">
    <table class="${tableClass}" id="${id}">
      <thead><tr>${thHtml}</tr></thead>
      <tbody>${trHtml}</tbody>
    </table>
  </div>
  <script>
  (function(){
    var table = document.getElementById('${id}');
    if (!table) return;
    var searchInput = document.getElementById('${id}-search');
    function applyFilters(){
      var search = searchInput ? searchInput.value.toLowerCase() : '';
      var activeTags = {};
      table.querySelectorAll('.btn[data-tag]').forEach(function(btn){
        // handled below
      });
      // re-read active tag buttons
      document.querySelectorAll('[data-tag][data-value]').forEach(function(btn){
        if(btn.classList.contains('btn-secondary') && btn.dataset.value !== '__all__'){
          if(!activeTags[btn.dataset.tag]) activeTags[btn.dataset.tag] = btn.dataset.value;
        }
      });
      table.querySelectorAll('tbody tr').forEach(function(tr){
        var text = tr.textContent.toLowerCase();
        var matchSearch = !search || text.indexOf(search) >= 0;
        var matchTags = true;
        for(var tagKey in activeTags){
          var tagVal = tr.getAttribute('data-tag-'+tagKey);
          if(tagVal !== activeTags[tagKey]){ matchTags = false; break; }
        }
        tr.style.display = (matchSearch && matchTags) ? '' : 'none';
      });
    }
    if(searchInput) searchInput.addEventListener('input', applyFilters);
    document.querySelectorAll('[data-tag][data-value]').forEach(function(btn){
      btn.addEventListener('click', function(){
        // deactivate siblings
        var tag = btn.dataset.tag;
        document.querySelectorAll('[data-tag="'+tag+'"][data-value]').forEach(function(b){
          b.classList.remove('btn-secondary');
          b.classList.add('btn-outline-secondary');
        });
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-secondary');
        applyFilters();
      });
    });
    // initial: all buttons active=__all__ are selected
    document.querySelectorAll('[data-value="__all__"]').forEach(function(btn){
      btn.classList.remove('btn-outline-secondary');
      btn.classList.add('btn-secondary');
    });
  })();
  <\/script>`;
}

// ─── Page shell ────────────────────────────────────────────

function pageShell(title, navActive, bodyHtml) {
  return `${renderNav(navActive)}${bodyHtml}`;
}

// ─── Diff helpers ──────────────────────────────────────────

function diffIcon(kind) {
  switch (kind) {
    case "created": return '<i class="fas fa-plus-circle text-success me-1"></i>';
    case "updated": return '<i class="fas fa-pen text-warning me-1"></i>';
    case "orphaned": return '<i class="fas fa-question-circle text-info me-1"></i>';
    default: return "";
  }
}

function diffRow(table, kind, name, meaning) {
  return `<tr>
    <td>${diffIcon(kind)} ${escapeHtml(kind)}</td>
    <td><code>${escapeHtml(name)}</code></td>
    <td><small class="text-muted">${escapeHtml(meaning)}</small></td>
  </tr>`;
}

function envBadge(env) {
  const colors = { local: "secondary", dev: "info", staging: "warning", prod: "danger", production: "danger" };
  return badge(env, colors[env] || "secondary");
}

function kindIcon(kind) {
  const icons = {
    tables: "fa-table", views: "fa-eye", pages: "fa-file-alt",
    triggers: "fa-bolt", roles: "fa-user-shield", plugins: "fa-puzzle-piece",
    menu: "fa-bars",
  };
  return icons[kind] || "fa-cube";
}

function kindLabel(kind) {
  const labels = {
    tables: "Tables", views: "Views", pages: "Pages",
    triggers: "Triggers", roles: "Roles", plugins: "Plugins",
    menu: "Menu", settings: "Settings",
  };
  return labels[kind] || kind;
}

function actionIcon(action) {
  if (!action) return "";
  if (action.startsWith("create")) return '<i class="fas fa-plus-circle text-success me-1"></i>';
  if (action.startsWith("drop")) return '<i class="fas fa-trash text-danger me-1"></i>';
  if (action.startsWith("alter") || action.startsWith("update")) return '<i class="fas fa-pen text-warning me-1"></i>';
  if (action.startsWith("rename")) return '<i class="fas fa-exchange-alt text-info me-1"></i>';
  return '<i class="fas fa-cog me-1"></i>';
}

module.exports = {
  escapeHtml,
  renderNav,
  card,
  statCard,
  emptyState,
  badge,
  statusBadge,
  countBadge,
  tableStart,
  tableEnd,
  fullTable,
  filterableTable,
  pageShell,
  diffIcon,
  diffRow,
  envBadge,
  kindIcon,
  kindLabel,
  actionIcon,
  NAV_ITEMS,
};
