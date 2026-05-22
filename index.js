const { pluginConfigFields, routes } = require("./lib/plugin");
const projectSyncConsole = require("./viewtemplates/project-sync-console");

/**
 * Inject a global branch/tenant mismatch banner on ALL Saltcorn pages.
 * Uses the `headers` plugin hook to inject a scriptBody that checks
 * via the plugin API and shows a dismissible warning toast.
 */
function branchTenantHeaders() {
  return [
    {
      scriptBody: `(function(){
  var r = new XMLHttpRequest();
  r.open('GET', '/project-sync/api/branch-guard', true);
  r.onload = function() {
    if (r.status !== 200) return;
    var j;
    try { j = JSON.parse(r.responseText); } catch(e) { return; }
    if (!j || j.ok) return;
    var h = j.branch || '';
    var ex = j.expected || '';
    var ac = j.actual || '';
    var target = j.target_url || '';
    var sb = j.suggested_branch || '';
    var d = document.createElement('div');
    d.id = 'scps-branch-warning';
    d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding-top:15vh';
    var fixLine = sb
      ? '<div style="background:#e8f4fd;border:1px solid #b8daff;border-radius:.25rem;padding:.6rem .75rem;font-size:.8rem;color:#0c5460;margin-bottom:1.25rem">Switch to branch <code style="background:#cce5ff;padding:.1em .4em;border-radius:3px">' + sb + '</code> to match this tenant, or open the correct tenant below.</div>'
      : '';
    var linkBtn = target
      ? '<a href="' + target + '" style="display:inline-block;padding:.55rem 1.5rem;background:#0d6efd;color:#fff;border-radius:.375rem;text-decoration:none;font-size:.9rem;font-weight:500">Open ' + ex + ' tenant</a>'
      : '<a href="/project-sync/projects" style="display:inline-block;padding:.55rem 1.5rem;background:#0d6efd;color:#fff;border-radius:.375rem;text-decoration:none;font-size:.9rem;font-weight:500">Open projects</a>';
    d.innerHTML =
      '<div style="background:#fff;border:1px solid #dee2e6;border-top:4px solid #f0ad4e;border-radius:.5rem;padding:1.75rem 2rem;max-width:480px;width:90%;box-shadow:0 .75rem 2rem rgba(0,0,0,.2)">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1rem">' +
          '<h5 style="margin:0;color:#212529;font-size:1.1rem">Branch / Tenant mismatch</h5>' +
          '<button id="scps-dismiss-warning" style="background:none;border:0;font-size:1.3rem;cursor:pointer;padding:0 0 0 .5rem;line-height:1;color:#6c757d">\u00d7</button>' +
        '</div>' +
        '<p style="margin:0 0 .75rem;font-size:.9rem;color:#495057">' +
          'Git branch <code style="background:#e9ecef;padding:.1em .4em;border-radius:3px">' + h + '</code> expects tenant <code style="background:#e9ecef;padding:.1em .4em;border-radius:3px">' + ex + '</code>.' +
        '</p>' +
        '<p style="margin:0 0 .75rem;font-size:.9rem;color:#495057">' +
          'You are on tenant <code style="background:#e9ecef;padding:.1em .4em;border-radius:3px">' + ac + '</code>.' +
        '</p>' +
        fixLine +
        '<div style="display:flex;gap:.5rem;justify-content:flex-end">' +
          linkBtn +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    var dismissBtn = document.getElementById('scps-dismiss-warning');
    if (dismissBtn) dismissBtn.onclick = function() { d.style.display = 'none'; };
  };
  r.send();
})();`,
    },
  ];
}

/**
 * Saltcorn plugin entrypoint.
 *
 * The plugin provides UI/routes for project selection, diff display,
 * import/export, and deployment records. Heavy filesystem and Git operations
 * belong in the companion CLI.
 */
module.exports = {
  sc_plugin_api_version: 1,
  name: "saltcorn-project-sync",
  plugin_name: "Saltcorn Project Sync",
  description:
    "Git-backed Saltcorn app versioning with deterministic exports and safe deployment planning.",
  configuration_workflow: () => pluginConfigFields(),
  viewtemplates: () => [projectSyncConsole],
  routes: () => routes,
  headers: () => branchTenantHeaders(),
};
