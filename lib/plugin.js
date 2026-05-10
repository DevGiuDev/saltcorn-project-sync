const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("./project-io");

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

function page(title, body) {
  return { title, body };
}

function nav() {
  return `<p>
<a href="/project-sync">Overview</a> |
<a href="/project-sync/health">Health</a> |
<a href="/project-sync/deployments">Deployments</a>
</p>`;
}

function deploymentsTable(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "deployments.json");
  const rows = readJsonIfExists(file, []);
  if (!rows.length) return "<p>No deployment records found.</p>";
  return `<table><thead><tr><th>Recorded</th><th>Env</th><th>Status</th><th>Commit</th><th>Ops</th><th>Warnings</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${row.recorded_at || ""}</td><td>${row.env || ""}</td><td>${row.status || ""}</td><td><code>${row.commit || ""}</code></td><td>${row.operations ?? ""}</td><td>${row.warnings ?? ""}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

const routes = [
  {
    url: "/project-sync",
    method: "get",
    callback: async () =>
      page(
        "Saltcorn Project Sync",
        `${nav()}<h1>Saltcorn Project Sync</h1>
<p>Git-backed app versioning and safe deployment planning.</p>
<h2>Core safety rule</h2>
<p><strong>Missing from Git never means drop automatically.</strong> Orphaned tenant objects are preserved unless explicit change intents authorize destructive operations.</p>
<h2>Companion CLI</h2>
<pre>saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev</pre>
<p>The plugin UI is intentionally thin at this stage; Git/filesystem operations remain in the CLI.</p>`
      ),
  },
  {
    url: "/project-sync/health",
    method: "get",
    callback: async () => {
      const checks = [
        ["canonical JSON", true],
        ["planner", true],
        ["change intents", true],
        ["deployment log path", fs.existsSync(path.join(process.cwd(), ".saltcorn-project-sync"))],
      ];
      return page(
        "Project Sync Health",
        `${nav()}<h1>Health</h1><ul>${checks
          .map(([name, ok]) => `<li>${ok ? "✅" : "⚠️"} ${name}</li>`)
          .join("")}</ul>`
      );
    },
  },
  {
    url: "/project-sync/deployments",
    method: "get",
    callback: async () => page("Project Sync Deployments", `${nav()}<h1>Deployments</h1>${deploymentsTable()}`),
  },
];

module.exports = { pluginConfigFields, routes, deploymentsTable };
