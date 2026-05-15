const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, writeCanonicalJson } = require("./project-io");

function deploymentLogFile(projectDir = process.cwd()) {
  return path.join(projectDir, ".saltcorn-project-sync", "deployments.json");
}

function loadDeploymentRecords(projectDir = process.cwd()) {
  return readJsonIfExists(deploymentLogFile(projectDir), []);
}

function nextRecordId(existing, kind = "deployment") {
  const prefix = kind === "rollback" ? "rollback" : "deploy";
  const count = existing.filter((record) => (record.kind || "deployment") === kind).length + 1;
  return `${prefix}-${String(count).padStart(6, "0")}`;
}

function appendDeploymentRecord(projectDir, record) {
  const file = deploymentLogFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = loadDeploymentRecords(projectDir);
  const kind = record.kind || "deployment";
  const nextRecord = {
    id: record.id || nextRecordId(existing, kind),
    kind,
    recorded_at: new Date().toISOString(),
    ...record,
  };
  const next = [...existing, nextRecord];
  writeCanonicalJson(file, next);
  return nextRecord;
}

function appendRollbackRecord(projectDir, record) {
  return appendDeploymentRecord(projectDir, { ...record, kind: "rollback" });
}

function findDeploymentRecord(projectDir = process.cwd(), id = "last") {
  const records = loadDeploymentRecords(projectDir);
  if (!records.length) return null;
  if (!id || id === "last") return records[records.length - 1];
  return records.find((record) => record.id === id) || null;
}

/**
 * Find the last applied version from deployment records.
 * Returns null if no deployments found or version not recorded.
 */
function lastAppliedVersion(projectDir = process.cwd()) {
  const records = loadDeploymentRecords(projectDir);
  // Walk backwards to find the last successful deployment with a version
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.status === "applied-live" && r.version) return r.version;
  }
  return null;
}

module.exports = { deploymentLogFile, loadDeploymentRecords, appendDeploymentRecord, appendRollbackRecord, findDeploymentRecord, nextRecordId, lastAppliedVersion };
