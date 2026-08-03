const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { writeCanonicalJson } = require("./project-io");
const { parseJson } = require("./canonical-json");

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

function resolveBackupProvider(config = {}, processEnv = process.env) {
  const reference = config.backup_hook_env || "SALTCORN_PROJECT_SYNC_BACKUP_CMD";
  const command = (config.backup_hook_env && processEnv[config.backup_hook_env]) || processEnv.SALTCORN_PROJECT_SYNC_BACKUP_CMD || "";
  return {
    type: command ? "command" : "none",
    ready: Boolean(command),
    reference: command ? reference : null,
    command,
  };
}

function publicBackupProvider(provider = {}) {
  return { type: provider.type || "none", ready: provider.ready === true, reference: provider.reference || null };
}

function runBackupProvider(provider, context = {}) {
  if (!provider?.ready || !provider.command) {
    return { ok: true, skipped: true, provider: "none", reason: "No backup provider is configured for this environment" };
  }
  const result = spawnSync(provider.command, {
    shell: true,
    input: JSON.stringify({
      project: context.project || null,
      environment: context.environment || null,
      tenant: context.tenant || null,
    }),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  if (result.status !== 0) throw new Error((result.stderr || `backup provider exited with ${result.status}`).trim());
  const parsed = result.stdout ? parseJson(result.stdout, "backup provider") : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("backup provider must return one JSON object");
  return { ...(parsed || {}), provider: parsed?.provider || provider.type };
}

module.exports = {
  createBackupRecord,
  currentGitCommit,
  isVerifiableBackupMetadata,
  resolveBackupProvider,
  publicBackupProvider,
  runBackupProvider,
};
