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

  // Multi-match tags: collect all unique values from pipe-separated data
  function tagValues(rows, tag) {
    const set = new Set();
    for (const r of rows) {
      const raw = r[tag.key];
      if (!raw || raw === "—") continue;
      if (tag.multi_match) {
        String(raw).split("|").forEach((v) => { if (v.trim()) set.add(v.trim()); });
      } else {
        set.add(String(raw));
      }
    }
    return [...set].sort();
  }

  // Tag filter buttons
  const tagSections = tags.map((tag) => {
    const values = tagValues(rows, tag);
    const allValues = [...new Set(rows.map((r) => r[tag.key] || "—"))].sort();
    if (!tag.multi_match && allValues.length <= 1) return "";
    if (tag.multi_match && values.length <= 1) return "";
    const displayValues = tag.multi_match ? values : allValues;
    const buttons = displayValues.map((v) =>
      `<button class="btn btn-outline-secondary btn-sm${tag.multi_match ? ' sc-tag-multi' : ''}" data-tag="${escapeHtml(tag.key)}" data-value="${escapeHtml(v)}"${tag.multi_match ? ' data-multi-match="true"' : ''}>${escapeHtml(v)}</button>`
    ).join("");
    return `<div class="mb-2 d-flex align-items-center flex-wrap" style="gap:.35rem;">
      <span class="small text-muted me-1">${escapeHtml(tag.label)}:</span>
      <button class="btn btn-secondary btn-sm" data-tag="${escapeHtml(tag.key)}" data-value="__all__">All</button>
      ${buttons}
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

  return `<div class="filterable-table-container">
  ${searchHtml}${tagSections}
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
    // Collect multi-match tag keys from nearby buttons
    var container = table.closest('.filterable-table-container');
    var multiMatchKeys = {};
    if (container) container.querySelectorAll('.sc-tag-multi[data-tag]').forEach(function(btn){
      multiMatchKeys[btn.dataset.tag] = true;
    });
    function applyFilters(){
      var search = searchInput ? searchInput.value.toLowerCase() : '';
      var activeTags = {};
      // re-read active tag buttons
      if (container) container.querySelectorAll('[data-tag][data-value]').forEach(function(btn){
        if(btn.classList.contains('btn-secondary') && btn.dataset.value !== '__all__'){
          if(!activeTags[btn.dataset.tag]) activeTags[btn.dataset.tag] = btn.dataset.value;
        }
      });
      table.querySelectorAll('tbody tr').forEach(function(tr){
        var text = tr.textContent.toLowerCase();
        var matchSearch = !search || text.indexOf(search) >= 0;
        var matchTags = true;
        for(var tagKey in activeTags){
          var tagVal = tr.getAttribute('data-tag-'+tagKey) || '';
          if(multiMatchKeys[tagKey]){
            if(('|'+tagVal+'|').indexOf('|'+activeTags[tagKey]+'|') < 0){ matchTags = false; break; }
          } else {
            if(tagVal !== activeTags[tagKey]){ matchTags = false; break; }
          }
        }
        tr.style.display = (matchSearch && matchTags) ? '' : 'none';
      });
    }
    if(searchInput) searchInput.addEventListener('input', applyFilters);
    if (container) container.querySelectorAll('[data-tag][data-value]').forEach(function(btn){
      btn.addEventListener('click', function(){
        // deactivate siblings
        var tag = btn.dataset.tag;
        container.querySelectorAll('[data-tag="'+tag+'"][data-value]').forEach(function(b){
          b.classList.remove('btn-secondary');
          b.classList.add('btn-outline-secondary');
        });
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-secondary');
        applyFilters();
      });
    });
    // initial: all buttons active=__all__ are selected
    if (container) container.querySelectorAll('[data-value="__all__"]').forEach(function(btn){
      btn.classList.remove('btn-outline-secondary');
      btn.classList.add('btn-secondary');
    });
    // apply initial filter state
    applyFilters();
  })();
  <\/script></div>`;
}

// ─── Page shell ────────────────────────────────────────────

function pageShell(title, navActive, bodyHtml) {
  return `${renderBranchToast()}${renderNav(navActive)}${bodyHtml}`;
}

/**
 * Render a toast notification warning if the current git branch
 * doesn't match the current Saltcorn tenant.
 * Shows on every plugin page.
 */
function renderBranchToast() {
  const projectRoot = process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT;
  if (!projectRoot) return '';

  try {
    const bt = require("./branch-tenant");
    const dbMod = (() => { try { return require("@saltcorn/data/db"); } catch { try { return require("@saltcorn/data/dist/db"); } catch { return null; } } })();
    if (!dbMod) return '';

    const currentTenant = dbMod.getTenantSchema();
    const guard = bt.guardBranchTenant(projectRoot, currentTenant);
    if (guard.ok) return '';

    const expectedUrl = guard.expected === 'public'
      ? `${windowLocationOrigin()}`
      : `http://${guard.expected}.localhost:3000`;

    // Use a fixed position toast that stays visible
    return `
    <div id="scps-branch-toast" style="position:fixed;bottom:20px;right:20px;z-index:9999;max-width:420px">
      <div style="background:#fff;border:1px solid #dee2e6;border-left:4px solid #f0ad4e;border-radius:.375rem;box-shadow:0 .5rem 1rem rgba(0,0,0,.15)">
        <div style="display:flex;align-items:center;padding:.5rem .75rem;background:#ffc107;color:#212529;border-radius:calc(.375rem - 1px) calc(.375rem - 1px) 0 0">
          <i class="fas fa-exclamation-triangle" style="margin-right:.5rem"></i>
          <strong style="flex:1;font-size:.875rem">Branch / Tenant mismatch</strong>
          <button onclick="this.closest('#scps-branch-toast').style.display='none'" style="background:none;border:0;font-size:1.1rem;cursor:pointer;padding:0 .25rem;line-height:1">&times;</button>
        </div>
        <div style="padding:.75rem">
          <p style="margin:0 0 .5rem;font-size:.8125rem">
            Git branch <code>${escapeHtml(guard.branch)}</code> expects tenant <code>${escapeHtml(guard.expected)}</code>,
            but you\'re on tenant <code>${escapeHtml(guard.actual)}</code>.
          </p>
          <p style="margin:0 0 .5rem;font-size:.75rem;color:#6c757d">
            Operations like export, apply and pull may affect the wrong tenant.
          </p>
          <a href="/project-sync/git" style="display:inline-block;padding:.25rem .5rem;background:#ffc107;color:#212529;border:1px solid #e0a800;border-radius:.25rem;text-decoration:none;font-size:.8125rem">
            <i class="fas fa-code-branch" style="margin-right:.25rem"></i>Go to Git panel
          </a>
        </div>
      </div>
    </div>`;
  } catch {
    return '';
  }
}

/** Best-effort origin for building tenant URLs in server-rendered HTML */
function windowLocationOrigin() {
  // In server-rendered HTML we can't know the browser's origin,
  // but we can use a JS snippet that resolves at runtime
  return 'http://localhost:3000';
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

// ─── Tabs ──────────────────────────────────────────────────

/**
 * Render a Bootstrap 5 tab bar.
 * `tabs`: [{id, label, icon, badge, badgeColor}]
 * `activeId`: which tab is active by default
 */
function renderTabBar(tabs, activeId = "") {
  const items = tabs.map((t) => {
    const active = t.id === activeId ? " active" : "";
    const iconHtml = t.icon ? `<i class="fas ${t.icon} me-1"></i>` : "";
    const badgeHtml = t.badge !== undefined
      ? ` <span class="badge bg-${t.badgeColor || "secondary"}-lt ms-1">${t.badge}</span>`
      : "";
    return `<li class="nav-item" role="presentation">
      <button class="nav-link${active}" id="${t.id}-tab" data-bs-toggle="tab" data-bs-target="#tab-${t.id}" type="button" role="tab" aria-controls="tab-${t.id}" aria-selected="${t.id === activeId ? "true" : "false"}">${iconHtml}${escapeHtml(t.label)}${badgeHtml}</button>
    </li>`;
  }).join("");
  return `<ul class="nav nav-tabs mb-0" id="scope-tabs" role="tablist">${items}</ul>`;
}

/**
 * Wrap content in a Bootstrap 5 tab pane.
 */
function renderTabPane(id, bodyHtml, active = false) {
  const cls = `tab-pane fade${active ? " show active" : ""}`;
  return `<div class="${cls}" id="tab-${id}" role="tabpanel" aria-labelledby="${id}-tab">${bodyHtml}</div>`;
}

/**
 * Render stat row for a scope tab (included/total + extra stats).
 */
function scopeStatRow(included, total, extras = []) {
  const cards = [
    statCard("Included", included, "fa-check-circle", "success"),
    statCard("Excluded", total - included, "fa-times-circle", total - included ? "warning" : "success"),
    ...extras,
  ];
  return `<div class="row mb-3 pt-3">${cards.join("")}</div>`;
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
  renderTabBar,
  renderTabPane,
  scopeStatRow,
  NAV_ITEMS,
};
