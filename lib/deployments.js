const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, writeCanonicalJson } = require("./project-io");

function deploymentLogFile(projectDir = process.cwd()) {
  return path.join(projectDir, ".saltcorn-project-sync", "deployments.json");
}

function loadDeploymentRecords(projectDir = process.cwd()) {
  return readJsonIfExists(deploymentLogFile(projectDir), []);
}

function appendDeploymentRecord(projectDir, record) {
  const file = deploymentLogFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = loadDeploymentRecords(projectDir);
  const nextIndex = existing.length + 1;
  const nextRecord = {
    id: record.id || `deploy-${String(nextIndex).padStart(6, "0")}`,
    recorded_at: new Date().toISOString(),
    ...record,
  };
  const next = [...existing, nextRecord];
  writeCanonicalJson(file, next);
  return nextRecord;
}

function findDeploymentRecord(projectDir = process.cwd(), id = "last") {
  const records = loadDeploymentRecords(projectDir);
  if (!records.length) return null;
  if (!id || id === "last") return records[records.length - 1];
  return records.find((record) => record.id === id) || null;
}

module.exports = { deploymentLogFile, loadDeploymentRecords, appendDeploymentRecord, findDeploymentRecord };
