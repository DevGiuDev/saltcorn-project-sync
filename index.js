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
    var d = document.createElement('div');
    d.id = 'scps-branch-toast';
    d.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;max-width:420px';
    var h = j.branch || '';
    var ex = j.expected || '';
    var ac = j.actual || '';
    d.innerHTML =
      '<div style="background:#fff;border:1px solid #dee2e6;border-left:4px solid #f0ad4e;border-radius:.375rem;box-shadow:0 .5rem 1rem rgba(0,0,0,.15)">' +
        '<div style="display:flex;align-items:center;padding:.5rem .75rem;background:#ffc107;color:#212529;border-radius:calc(.375rem - 1px) calc(.375rem - 1px) 0 0">' +
          '<b style="flex:1;font-size:.875rem">Branch / Tenant mismatch</b>' +
          '<button id="scps-toast-close" style="background:none;border:0;font-size:1.2rem;cursor:pointer;padding:0 .25rem;line-height:1;color:#212529">\u00d7</button>' +
        '</div>' +
        '<div style="padding:.75rem">' +
          '<p style="margin:0 0 .5rem;font-size:.8125rem">' +
            'Git branch <code>' + h + '</code> expects tenant <code>' + ex + '</code>,' +
            ' but you are on tenant <code>' + ac + '</code>.' +
          '</p>' +
          '<p style="margin:0 0 .5rem;font-size:.75rem;color:#6c757d">' +
            'Operations like export, apply and pull may affect the wrong tenant.' +
          '</p>' +
          '<a href="/project-sync/git" style="display:inline-block;padding:.25rem .5rem;background:#ffc107;color:#212529;border:1px solid #e0a800;border-radius:.25rem;text-decoration:none;font-size:.8125rem">' +
            'Go to Git panel' +
          '</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    var cb = document.getElementById('scps-toast-close');
    if (cb) cb.onclick = function() { d.style.display = 'none'; };
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
