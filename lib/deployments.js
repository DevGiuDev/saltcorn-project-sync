const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, writeCanonicalJson } = require("./project-io");

function deploymentLogFile(projectDir = process.cwd()) {
  return path.join(projectDir, ".saltcorn-project-sync", "deployments.json");
}

function appendDeploymentRecord(projectDir, record) {
  const file = deploymentLogFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = readJsonIfExists(file, []);
  const next = [
    ...existing,
    {
      recorded_at: new Date().toISOString(),
      ...record,
    },
  ];
  writeCanonicalJson(file, next);
  return next[next.length - 1];
}

module.exports = { deploymentLogFile, appendDeploymentRecord };
