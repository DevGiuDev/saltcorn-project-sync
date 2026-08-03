/**
 * Plugin configuration: fields, project root, token.
 */
const { optionalRequire } = require("../tenant-adapters");

function pluginConfigFields() {
  return {
    steps: [
      {
        name: "Project Sync",
        form: async () => ({
          fields: [
            {
              name: "project_root",
              label: "Project root path",
              type: "String",
              required: false,
              sublabel:
                "Filesystem path to the Git repository containing project JSON files. Overrides SALTCORN_PROJECT_SYNC_PROJECT_ROOT env var.",
            },
            {
              name: "environment",
              label: "Environment",
              type: "String",
              required: true,
              default: "dev",
            },
            {
              name: "api_token_env",
              label: "API token environment variable",
              type: "String",
              required: false,
              default: "SALTCORN_PROJECT_SYNC_API_TOKEN",
            },
          ],
        }),
      },
    ],
  };
}

function getPluginConfig() {
  try {
    const stateMod = optionalRequire([
      "@saltcorn/data/db/state",
      "@saltcorn/data/dist/db/state",
    ]);
    if (stateMod) {
      const rootState = stateMod.getRootState();
      if (rootState && rootState.plugin_cfgs) {
        return rootState.plugin_cfgs["saltcorn-project-sync"] || {};
      }
    }
  } catch {
    /* fallback */
  }
  return {};
}

function configuredProjectRoot() {
  const cfg = getPluginConfig();
  if (cfg.project_root) return cfg.project_root;
  return process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "";
}

function configuredToken() {
  const cfg = getPluginConfig();
  const tokenEnv = cfg.api_token_env || "SALTCORN_PROJECT_SYNC_API_TOKEN";
  return process.env.SALTCORN_PROJECT_SYNC_API_TOKEN || process.env[tokenEnv] || "";
}

module.exports = {
  pluginConfigFields,
  getPluginConfig,
  configuredProjectRoot,
  configuredToken,
};
