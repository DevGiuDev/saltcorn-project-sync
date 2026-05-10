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
              sublabel: "Filesystem path used by the companion CLI on trusted deployments.",
            },
            {
              name: "environment",
              label: "Environment",
              type: "String",
              required: true,
              default: "dev",
            },
          ],
        }),
      },
    ],
  };
}

const routes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async () => ({
      title: "Saltcorn Project Sync",
      body: `<h1>Saltcorn Project Sync</h1>
<p>Git-backed app versioning and safe deployment planning.</p>
<p>This scaffold exposes the plugin entrypoint. UI workflows for object selection, diff review, and deploy logs will be implemented in later MVP iterations.</p>`,
    }),
  },
];

module.exports = { pluginConfigFields, routes };
