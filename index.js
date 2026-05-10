const { pluginConfigFields, routes } = require("./lib/plugin");

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
  routes: () => routes,
};
