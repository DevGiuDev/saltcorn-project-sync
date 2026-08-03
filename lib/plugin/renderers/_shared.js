const fs = require("node:fs");
const path = require("node:path");
const { optionalRequire } = require("../../tenant-adapters");

const markup = optionalRequire([
  "@saltcorn/markup",
  "@saltcorn/markup/dist/index",
  "/usr/lib/node_modules/@saltcorn/cli/node_modules/@saltcorn/markup/dist/index.js",
]);
const tags = optionalRequire([
  "@saltcorn/markup/tags",
  "@saltcorn/markup/dist/tags",
  "/usr/lib/node_modules/@saltcorn/cli/node_modules/@saltcorn/markup/dist/tags.js",
]);
const layoutUtils = optionalRequire([
  "@saltcorn/markup/layout_utils",
  "@saltcorn/markup/dist/layout_utils",
  "/usr/lib/node_modules/@saltcorn/cli/node_modules/@saltcorn/markup/dist/layout_utils.js",
]);
const mkTable = markup.mkTable || optionalRequire([
  "@saltcorn/markup/table",
  "@saltcorn/markup/dist/table",
  "/usr/lib/node_modules/@saltcorn/cli/node_modules/@saltcorn/markup/dist/table.js",
]);
const renderTabs = markup.tabs || optionalRequire([
  "@saltcorn/markup/tabs",
  "@saltcorn/markup/dist/tabs",
  "/usr/lib/node_modules/@saltcorn/cli/node_modules/@saltcorn/markup/dist/tabs.js",
]);

function escapeHtml(value) {
  return tags.escape(String(value ?? ""));
}

function icon(name, classExtra = "") {
  return tags.i({ class: `fas ${name}${classExtra ? ` ${classExtra}` : ""}` });
}

function navButton(href, label, iconName, active = false) {
  return tags.a({
    href,
    class: `btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`,
  }, `${icon(iconName, " me-1")}${escapeHtml(label)}`);
}

function globalNav(active = "projects") {
  const sharedUiStyle = `<style id="scps-shared-ui">
    :root{--scps-ink:#152536;--scps-blue:#0d6efd;--scps-cyan:#13b5c8;--scps-steel:#d8e2eb;--scps-paper:#f7f9fb}
    .scps-page-nav{margin-bottom:1rem}
    .scps-page-nav .btn{border-radius:.35rem;font-weight:650;letter-spacing:.01em}
    .card-max-full-screen>.card-header,.scps-page-card>.card-header,.scps-panel>.card-header{background:var(--scps-ink);color:#f8fbfd;border-color:var(--scps-ink)}
    .card-max-full-screen>.card-header h5,.card-max-full-screen>.card-header h6,.scps-page-card>.card-header h5,.scps-page-card>.card-header h6,.scps-panel>.card-header h5,.scps-panel>.card-header h6{color:#fff}
    .card-max-full-screen>.card-header .text-muted,.scps-page-card>.card-header .text-muted,.scps-panel>.card-header .text-muted{color:#b9cad7!important}
    .card-max-full-screen>.card-header .btn-outline-secondary,.scps-page-card>.card-header .btn-outline-secondary,.scps-panel>.card-header .btn-outline-secondary{border-color:rgba(255,255,255,.45);color:#fff}
    .card-max-full-screen>.card-header .btn-outline-secondary:hover,.scps-page-card>.card-header .btn-outline-secondary:hover,.scps-panel>.card-header .btn-outline-secondary:hover{background:#fff;color:var(--scps-ink)}
    .scps-deploy-head,.scps-git-bar{background:var(--scps-ink)!important}
  </style>`;
  return sharedUiStyle + tags.nav({ class: "scps-page-nav d-flex flex-wrap", style: "gap:.5rem;" }, [
    navButton("/project-sync/projects", "Projects", "fa-folder-open", active === "projects"),
    navButton("/project-sync/deployments", "Deployments", "fa-rocket", active === "deployments"),
  ]);
}

function projectNav({ projectId = "", active = "scope", mode = "full" } = {}) {
  if (projectId === undefined || projectId === null || String(projectId) === "") return "";
  const id = encodeURIComponent(projectId);
  const allTabs = [
    { key: "scope", label: "Scope", href: `/project-sync/projects/${id}`, icon: "fa-folder-open" },
    { key: "git", label: "Git", href: `/project-sync/git?project_id=${id}`, icon: "fa-code-branch" },
    { key: "live-diff", label: "Live Diff", href: `/project-sync/live-diff?project_id=${id}`, icon: "fa-exchange-alt" },
    { key: "plan", label: "Plan", href: `/project-sync/plan-preview?project_id=${id}`, icon: "fa-tasks" },
    { key: "approvals", label: "Approvals", href: `/project-sync/approvals?project_id=${id}`, icon: "fa-shield-alt" },
    { key: "deploy", label: "Deploy", href: `/project-sync/projects/${id}/deploy`, icon: "fa-rocket" },
    { key: "settings", label: "Settings", href: `/project-sync/settings?project_id=${id}`, icon: "fa-cog" },
  ];
  const allowed = mode === "deployment"
    ? new Set(["deploy", "settings"])
    : mode === "workspace"
      ? new Set(["scope", "git", "live-diff", "plan", "settings"])
      : null;
  const tabs = allowed ? allTabs.filter((tab) => allowed.has(tab.key)) : allTabs;
  return tags.div({ class: "scps-project-nav d-flex flex-wrap mb-3", style: "gap:.5rem;" }, tabs.map((tab) =>
    navButton(tab.href, tab.label, tab.icon, tab.key === active)
  ));
}

function filterRowHtml(columns = []) {
  return `<tr class="scps-filter-row">${columns.map((column, index) => {
    if (column.filter === false) return "<th></th>";
    if (Array.isArray(column.filterOptions) && column.filterOptions.length) {
      return `<th><select class="form-select form-select-sm scps-col-filter" data-col="${index}"><option value="">All</option>${column.filterOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}</select></th>`;
    }
    return `<th><input type="search" class="form-control form-control-sm scps-col-filter" data-col="${index}" placeholder="Filter…" /></th>`;
  }).join("")}</tr>`;
}

function filterScript(tableId) {
  return `<script>(function(){var wrap=document.getElementById(${JSON.stringify(tableId)});if(!wrap)return;var table=wrap.querySelector('table');if(!table||table.dataset.scpsFiltersInit)return;table.dataset.scpsFiltersInit='1';var filters=wrap.querySelectorAll('.scps-col-filter');function norm(s){return String(s||'').replace(/\s+/g,' ').trim().toLowerCase();}function apply(){table.querySelectorAll('tbody tr').forEach(function(row){var ok=true;filters.forEach(function(input){if(!ok)return;var v=norm(input.value);if(!v)return;var col=Number(input.dataset.col||0);var cell=row.children[col];var text=norm(cell?cell.textContent:'');if(!text.includes(v))ok=false;});row.style.display=ok?'':'none';});}filters.forEach(function(input){input.addEventListener('input',apply);input.addEventListener('change',apply);});})();<\/script>`;
}

function renderFilterableTable(tableId, columns, rows, opts = {}) {
  const strippedColumns = columns.map(({ filter, filterOptions, ...rest }) => rest);
  const tableHtml = mkTable(strippedColumns, rows, { ...opts, tableId });
  const withFilters = tableHtml.includes("</thead>")
    ? tableHtml.replace("</thead>", `${filterRowHtml(columns)}</thead>`)
    : tableHtml;
  return withFilters + filterScript(tableId);
}

function loadScript(name) {
  return fs.readFileSync(path.join(__dirname, "..", "scripts", name), "utf8");
}

module.exports = {
  tags,
  layoutUtils,
  mkTable,
  renderTabs,
  renderFilterableTable,
  escapeHtml,
  icon,
  globalNav,
  projectNav,
  loadScript,
};
