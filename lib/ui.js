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

function classNames(...values) {
  return values
    .flat()
    .filter(Boolean)
    .join(" ");
}

function joinHtml(parts) {
  return parts
    .flat(Infinity)
    .filter((part) => part !== undefined && part !== null && part !== false)
    .join("");
}

function attrsToHtml(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`)
    .join("");
}

function tag(name, attrs = {}, ...children) {
  const html = joinHtml(children);
  const attrHtml = attrsToHtml(attrs);
  if (["input", "br", "hr"].includes(name)) {
    return `<${name}${attrHtml} />`;
  }
  return `<${name}${attrHtml}>${html}</${name}>`;
}

function icon(name, classExtra = "") {
  return tag("i", { class: classNames("fas", name, classExtra) });
}

// ─── Navigation ────────────────────────────────────────────

const NAV_ITEMS = [
  // Core workflow
  { href: "/project-sync", label: "Overview", icon: "fa-home" },
  { href: "/project-sync/live-diff", label: "Live Diff", icon: "fa-exchange-alt" },
  { href: "/project-sync/git", label: "Git", icon: "fa-code-branch" },
  // Separator
  { href: "__sep__" },
  // Config
  { href: "/project-sync/projects", label: "Projects", icon: "fa-folder-open" },
  { href: "/project-sync/settings", label: "Settings", icon: "fa-cog" },
  // Separator
  { href: "__sep__" },
  // Monitoring
  { href: "/project-sync/status", label: "Status", icon: "fa-heartbeat" },
  { href: "/project-sync/approvals", label: "Approvals", icon: "fa-shield-alt" },
  { href: "/project-sync/health", label: "Health", icon: "fa-stethoscope" },
  { href: "/project-sync/deployments", label: "Deployments", icon: "fa-rocket" },
];

function renderNav(activeHref = "") {
  const links = NAV_ITEMS.map((item) => {
    if (item.href === "__sep__") {
      return tag("span", { class: "nav-link px-1 text-muted", "aria-hidden": "true" }, "|");
    }
    const active = activeHref === item.href ? " active" : "";
    return tag("a", { href: item.href, class: `nav-link${active}` }, `${icon(item.icon, "me-1")}${escapeHtml(item.label)}`);
  }).join("");

  return tag("nav", { class: "nav nav-tabs card-max-full-screen mb-4", style: "gap:0;flex-wrap:wrap;" }, links);
}

// ─── Cards ─────────────────────────────────────────────────

function card({ title, titleHtml, subtitle, subtitleHtml, icon: iconName, iconColor, headerRight, body, classExtra = "" }) {
  const iconHtml = iconName ? icon(iconName, classNames("me-2", iconColor ? `text-${iconColor}` : "")) : "";
  const headerRightHtml = headerRight ? `<div>${headerRight}</div>` : "";
  const resolvedSubtitle = subtitleHtml !== undefined
    ? subtitleHtml
    : (subtitle ? subtitleHtml_esc(subtitle) : "");
  const subtitleBlock = resolvedSubtitle
    ? tag("div", { class: "small text-muted mt-1" }, resolvedSubtitle)
    : "";
  const heading = titleHtml !== undefined ? titleHtml : escapeHtml(title);
  return tag("div", { class: classNames("card mt-0 card-max-full-screen", classExtra) },
    tag("div", { class: "card-header d-flex justify-content-between align-items-center flex-wrap", style: "gap:.5rem;" },
      tag("div", {},
        tag("h5", { class: "mb-0" }, `${iconHtml}${heading}`),
        subtitleBlock
      ),
      headerRightHtml
    ),
    tag("div", { class: "card-body" }, body)
  );
}

function subtitleHtml_esc(s) {
  return escapeHtml(s);
}

function statCard(label, value, iconName, color = "primary") {
  return tag("div", { class: "col-sm-6 col-lg-3 mb-3" },
    tag("div", { class: "card" },
      tag("div", { class: "card-body p-3 d-flex align-items-center" },
        tag("div", { class: `avatar bg-${color}-lt rounded me-3` }, icon(iconName, `text-${color}`)),
        tag("div", {},
          tag("div", { class: "small text-muted" }, escapeHtml(label)),
          tag("div", { class: "h3 mb-0" }, String(value))
        )
      )
    )
  );
}

function emptyState(iconName, message, actionHref, actionLabel) {
  const actionHtml = actionHref
    ? button({ href: actionHref, color: "primary", size: "sm", classExtra: "mt-2", icon: "fa-plus", label: actionLabel || "Create" })
    : "";
  return tag("div", { class: "text-center text-muted py-5" },
    icon(iconName, "fa-3x mb-3 opacity-25"),
    tag("p", {}, message),
    actionHtml
  );
}

// ─── Badges ────────────────────────────────────────────────

function badge(text, color = "secondary", opts = {}) {
  const {
    soft = false,
    icon: iconName,
    classExtra = "",
    textColor = soft ? color : "",
  } = opts;
  return tag("span", {
    class: classNames(
      "badge",
      soft ? `bg-${color}-lt` : `bg-${color}`,
      textColor ? `text-${textColor}` : "",
      classExtra
    ),
  }, `${iconName ? icon(iconName, "me-1") : ""}${escapeHtml(text)}`);
}

function statusBadge(ok, okLabel = "OK", errLabel = "Error") {
  return ok
    ? badge(okLabel, "success", { soft: true, icon: "fa-check" })
    : badge(errLabel, "danger", { soft: true, icon: "fa-times" });
}

function countBadge(count, label, color = "primary") {
  return badge(`${count} ${label}`, color, { soft: true, classExtra: "me-1" });
}

function button({ label = "", href, id, icon: iconName, color = "secondary", outline = false, size, classExtra = "", type = "button", title, target, attrs = {} }) {
  const className = classNames(
    "btn",
    outline ? `btn-outline-${color}` : `btn-${color}`,
    size ? `btn-${size}` : "",
    classExtra
  );
  const content = `${iconName ? icon(iconName, label ? "me-1" : "") : ""}${label ? escapeHtml(label) : ""}`;
  const rel = href && target === "_blank" && !attrs.rel ? "noopener noreferrer" : attrs.rel;
  const sharedAttrs = { id, class: className, title, target, rel, ...attrs };
  if (href) return tag("a", { href, ...sharedAttrs }, content);
  return tag("button", { type, ...sharedAttrs }, content);
}

function buttonGroup(children, { size = "sm", classExtra = "" } = {}) {
  return tag("div", { class: classNames("btn-group", size ? `btn-group-${size}` : "", classExtra) }, children);
}

function alert({ color = "info", icon: iconName = "fa-info-circle", title, body = "", classExtra = "", attrs = {} }) {
  const titleBlock = title
    ? tag("div", { class: "fw-bold mb-1" }, `${iconName ? icon(iconName, "me-1") : ""}${escapeHtml(title)}`)
    : "";
  const bodyPrefix = title ? "" : (iconName ? `${icon(iconName, "me-1")}` : "");
  return tag("div", { class: classNames("alert", `alert-${color}`, classExtra), role: "alert", ...attrs }, `${titleBlock}${bodyPrefix}${body}`);
}

function formField({ label, input, helpText = "", classExtra = "", labelClass = "form-label", helpClass = "form-text" }) {
  return tag("div", { class: classNames("mb-3", classExtra) },
    label ? tag("label", { class: labelClass }, escapeHtml(label)) : "",
    input,
    helpText ? tag("div", { class: helpClass }, helpText) : ""
  );
}

function textInput({ id, value = "", placeholder = "", classExtra = "", attrs = {} }) {
  return tag("input", {
    type: "text",
    id,
    value,
    placeholder,
    class: classNames("form-control", classExtra),
    ...attrs,
  });
}

function textareaInput({ id, value = "", rows = 2, classExtra = "", attrs = {} }) {
  return tag("textarea", {
    id,
    rows,
    class: classNames("form-control", classExtra),
    ...attrs,
  }, escapeHtml(value));
}

function inputGroup(children, { size = "sm", classExtra = "", style = "" } = {}) {
  return tag("div", {
    class: classNames("input-group", size ? `input-group-${size}` : "", classExtra),
    style,
  }, children);
}

function keyValueGrid(items, { classExtra = "mb-3" } = {}) {
  return tag("div", { class: classNames("row", classExtra) }, items.map((item) =>
    tag("div", { class: item.colClass || "col-sm-4" },
      tag("div", { class: "small text-muted" }, escapeHtml(item.label)),
      tag("div", {}, item.value)
    )
  ));
}

function simpleTable(columns, rows, opts = {}) {
  const { compact = true, hover = true, responsive = true, classExtra = "", emptyHtml = "" } = opts;
  if (!rows.length) return emptyHtml;
  const tableClass = classNames(
    "table",
    hover ? "table-hover" : "",
    "align-middle",
    "mb-0",
    compact ? "table-sm" : "",
    classExtra
  );
  const thead = tag("thead", {}, tag("tr", {}, columns.map((column) =>
    tag("th", { style: column.width ? `width:${column.width}` : "", class: column.classExtra || "" }, escapeHtml(column.label))
  )));
  const tbody = tag("tbody", {}, rows.map((row) =>
    tag("tr", {}, row.map((cell) => tag("td", { class: cell.classExtra || "", style: cell.style || "" }, cell.content)))
  ));
  const table = tag("table", { class: tableClass }, `${thead}${tbody}`);
  return responsive ? tag("div", { class: "table-responsive" }, table) : table;
}

function linkCard({ href, title, titleHtml, subtitleHtml = "", body = "", icon: iconName, color = "primary" }) {
  return tag("div", { class: "col-sm-6 col-lg-4 mb-3" },
    tag("a", { href, class: "card card-link h-100" },
      tag("div", { class: "card-body p-3" },
        tag("div", { class: "d-flex align-items-center mb-2" },
          tag("div", { class: `avatar bg-${color}-lt rounded me-3`, style: "width:40px;height:40px;" }, icon(iconName, `text-${color}`)),
          tag("div", {},
            tag("div", { class: "fw-bold" }, titleHtml !== undefined ? titleHtml : escapeHtml(title)),
            subtitleHtml ? tag("div", { class: "small text-muted" }, subtitleHtml) : ""
          )
        ),
        body
      )
    )
  );
}

function codeBlock(text, classExtra = "bg-light p-3 rounded small mb-0") {
  return tag("pre", { class: classExtra }, escapeHtml(text));
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

  // Tag filter controls: buttons for ≤5 values, <select> for >5
  const TAG_BUTTON_THRESHOLD = 5;
  const tagSections = tags.map((tag) => {
    const values = tagValues(rows, tag);
    const allValues = [...new Set(rows.map((r) => r[tag.key] || "—"))].sort();
    if (!tag.multi_match && allValues.length <= 1) return "";
    if (tag.multi_match && values.length <= 1) return "";
    const displayValues = tag.multi_match ? values : allValues;

    if (displayValues.length > TAG_BUTTON_THRESHOLD) {
      // Use <select> dropdown for many values
      const options = `<option value="__all__">All</option>` +
        displayValues.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
      return `<div class="mb-2 d-flex align-items-center" style="gap:.35rem;">
        <span class="small text-muted me-1">${escapeHtml(tag.label)}:</span>
        <select class="form-select form-select-sm" data-tag="${escapeHtml(tag.key)}"${tag.multi_match ? ' data-multi-match="true"' : ''} style="width:auto;max-width:200px;">${options}</select>
      </div>`;
    }

    // Use button row for few values
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
      // Read active tag buttons
      if (container) container.querySelectorAll('[data-tag][data-value]').forEach(function(btn){
        if(btn.classList.contains('btn-secondary') && btn.dataset.value !== '__all__'){
          if(!activeTags[btn.dataset.tag]) activeTags[btn.dataset.tag] = btn.dataset.value;
        }
      });
      // Read active tag <select> dropdowns
      if (container) container.querySelectorAll('select[data-tag]').forEach(function(sel){
        if(sel.value && sel.value !== '__all__'){
          if(!activeTags[sel.dataset.tag]) activeTags[sel.dataset.tag] = sel.value;
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
    // Button click handlers
    if (container) container.querySelectorAll('button[data-tag][data-value]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tag = btn.dataset.tag;
        container.querySelectorAll('button[data-tag="'+tag+'"][data-value]').forEach(function(b){
          b.classList.remove('btn-secondary');
          b.classList.add('btn-outline-secondary');
        });
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-secondary');
        applyFilters();
      });
    });
    // Select change handlers
    if (container) container.querySelectorAll('select[data-tag]').forEach(function(sel){
      sel.addEventListener('change', applyFilters);
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
  classNames,
  tag,
  icon,
  renderNav,
  card,
  statCard,
  emptyState,
  badge,
  statusBadge,
  countBadge,
  button,
  buttonGroup,
  alert,
  formField,
  textInput,
  textareaInput,
  inputGroup,
  keyValueGrid,
  simpleTable,
  linkCard,
  codeBlock,
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
