const { escapeHtml, card, pageShell } = require("../../ui");
const { configuredProjectRoot } = require("../config");
const { optionalRequire } = require("../../tenant-adapters");

function renderOverview() {
  const links = [
    { href: "/project-sync/status", icon: "fa-heartbeat", color: "danger", title: "Status", desc: "Live object counts, adapter capabilities" },
    { href: "/project-sync/live-diff", icon: "fa-exchange-alt", color: "warning", title: "Live Diff", desc: "Diff, plan & sync between live and files" },
    { href: "/project-sync/approvals", icon: "fa-shield-alt", color: "info", title: "Approvals", desc: "Environment policy and approval controls" },
    { href: "/project-sync/health", icon: "fa-stethoscope", color: "secondary", title: "Health", desc: "System health checks" },
    { href: "/project-sync/deployments", icon: "fa-rocket", color: "purple", title: "Deployments", desc: "Deployment history log" },
    { href: "/project-sync/projects", icon: "fa-folder-open", color: "teal", title: "Projects", desc: "Define and manage project scopes" },
    { href: "/project-sync/git", icon: "fa-code-branch", color: "dark", title: "Git", desc: "Stage, commit, push, pull and branch management" },
  ];
  const linkCards = links.map((l) => `
    <div class="col-sm-6 col-lg-4 mb-3">
      <a href="${l.href}" class="card card-link h-100">
        <div class="card-body p-3 d-flex align-items-center">
          <div class="avatar bg-${l.color}-lt rounded me-3" style="width:42px;height:42px;">
            <i class="fas ${l.icon} text-${l.color}" style="font-size:1.1rem;"></i>
          </div>
          <div>
            <div class="fw-bold">${l.title}</div>
            <div class="small text-muted">${l.desc}</div>
          </div>
        </div>
      </a>
    </div>`).join("");

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
        branchBanner = `
          <div class="alert ${match ? 'alert-success' : 'alert-warning'} d-flex justify-content-between align-items-center mb-4 py-2">
            <div>
              <i class="fas ${matchIcon} me-1"></i>
              <strong>Branch:</strong> <code>${escapeHtml(resolved.branch)}</code>
              <strong class="ms-3">Schema:</strong> <code>${escapeHtml(resolved.schema)}</code>
              <span class="ms-3 small">${matchText}</span>
            </div>
            <a href="/project-sync/git" class="btn btn-sm btn-outline-dark py-0 px-2"><i class="fas fa-code-branch me-1"></i>Manage branches</a>
          </div>`;
      }
    } catch { /* no branch info */ }
  }

  return pageShell("Overview", "/project-sync",
    card({
      title: "Saltcorn Project Sync",
      subtitle: "Git-backed app versioning and safe deployment planning",
      icon: "fa-code-branch",
      iconColor: "primary",
      headerRight: '<a href="/project-sync/settings" class="btn btn-outline-dark btn-sm" title="Plugin settings"><i class="fas fa-cog"></i></a>',
      body: `
  ${branchBanner}
  <div class="alert alert-info mb-4">
    <strong>Core safety rule:</strong> Missing from Git never means drop automatically.
    Orphaned tenant objects are preserved unless explicit change intents authorize destructive operations.
  </div>
  <div class="row">${linkCards}</div>
  <hr class="my-4" />
  <h6 class="mb-2"><i class="fas fa-terminal me-1"></i> Companion CLI</h6>
  <pre class="bg-light p-3 rounded small mb-0">saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev</pre>`,
    })
  );
}

module.exports = { renderOverview };
