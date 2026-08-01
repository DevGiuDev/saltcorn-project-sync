const fs = require("node:fs");
const path = require("node:path");
const { writeCanonicalJson } = require("./project-io");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function createBackupRecord({ projectDir = process.cwd(), env = "dev", commit = null, source = null } = {}) {
  const dir = path.join(projectDir, "backups", `${timestamp()}-${env}`);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    created_at: new Date().toISOString(),
    env,
    commit,
    source,
    note: "Metadata placeholder. Future versions should include Saltcorn snapshot/pack artifact references.",
  };
  writeCanonicalJson(path.join(dir, "backup.json"), record);
  return { dir, record };
}

function isVerifiableBackupMetadata(result) {
  if (!result || typeof result !== "object" || result.ok === false || result.skipped) return false;
  return Boolean(
    result.id ||
      result.backup_id ||
      result.snapshot_id ||
      result.path ||
      result.file ||
      result.artifact ||
      result.created_at ||
      result.completed_at ||
      result.metadata
  );
}

function currentGitCommit(projectDir = process.cwd()) {
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
  } catch (_err) {
    return null;
  }
}

module.exports = { createBackupRecord, currentGitCommit, isVerifiableBackupMetadata };
