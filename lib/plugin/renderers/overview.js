const {
  alert, button, card, codeBlock,
  escapeHtml, linkCard, pageShell,
} = require("../../ui");
const { configuredProjectRoot } = require("../config");
const { optionalRequire } = require("../../tenant-adapters");

function renderOverview() {
  const links = [
    { href: "/project-sync/status", icon: "fa-heartbeat", color: "danger", title: "Status", desc: "Live object counts, adapter capabilities" },
    { href: "/project-sync/health", icon: "fa-stethoscope", color: "secondary", title: "Health", desc: "System health checks" },
    { href: "/project-sync/deployments", icon: "fa-rocket", color: "purple", title: "Deployments", desc: "Deployment history log" },
    { href: "/project-sync/projects", icon: "fa-folder-open", color: "teal", title: "Projects", desc: "Define and manage project scopes" },
  ];
  const linkCards = links.map((l) => linkCard({
    href: l.href,
    title: l.title,
    body: `<div class="small text-muted">${escapeHtml(l.desc)}</div>`,
    icon: l.icon,
    color: l.color,
  })).join("");

  // Branch/Tenant status banner
  let branchBanner = '';
  const projectRoot = configuredProjectRoot();
  if (projectRoot) {
    try {
      const bt = require("../../branch-tenant");
      const resolved = bt.resolveActiveSchema(projectRoot);
      if (resolved.branch) {
        const dbMod = optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
        const currentTenant = dbMod ? dbMod.getTenantSchema() : "?";
        const match = resolved.schema === currentTenant;
        const matchIcon = match ? 'fa-check-circle text-success' : 'fa-exclamation-triangle text-warning';
        const matchText = match ? 'Tenant matches' : `Mismatch! Expected "${resolved.schema}", currently on "${currentTenant}"`;
        branchBanner = alert({
          color: match ? "success" : "warning",
          icon: null,
          classExtra: "d-flex justify-content-between align-items-center mb-4 py-2",
          body: `
            <div>
              <i class="fas ${matchIcon} me-1"></i>
              <strong>Branch:</strong> <code>${escapeHtml(resolved.branch)}</code>
              <strong class="ms-3">Schema:</strong> <code>${escapeHtml(resolved.schema)}</code>
              <span class="ms-3 small">${escapeHtml(matchText)}</span>
            </div>
          `,
        });
      }
    } catch { /* no branch info */ }
  }

  return pageShell("Overview", "/project-sync",
    card({
      title: "Saltcorn Project Sync",
      subtitle: "Git-backed app versioning and safe deployment planning",
      icon: "fa-code-branch",
      iconColor: "primary",
      headerRight: button({ href: "/project-sync/settings", color: "dark", outline: true, size: "sm", icon: "fa-cog", title: "Plugin settings" }),
      body: `
  ${branchBanner}
  ${alert({
    color: "info",
    classExtra: "mb-4",
    icon: null,
    body: "<strong>Core safety rule:</strong> Missing from Git never means drop automatically. Orphaned tenant objects are preserved unless explicit change intents authorize destructive operations.",
  })}
  <div class="row">${linkCards}</div>
  <hr class="my-4" />
  <h6 class="mb-2"><i class="fas fa-terminal me-1"></i> Companion CLI</h6>
  ${codeBlock(`saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev`)}`,
    })
  );
}

module.exports = { renderOverview };
