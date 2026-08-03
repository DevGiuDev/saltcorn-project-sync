const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { isGitRepo } = require("../git-ops");

function result(id, label, ready, detail, source = null) {
  return { id, label, ready: Boolean(ready), detail, source };
}

function runtimeValue(config, field, processEnv) {
  const ref = config[field];
  return ref && processEnv[ref] ? processEnv[ref] : "";
}

async function runSetupHealth({ project = {}, resolved = {}, processEnv = process.env, fetchImpl = global.fetch } = {}) {
  const config = resolved.config || {};
  const checks = [];
  const root = project.root_path || "";
  const exists = Boolean(root && fs.existsSync(root));
  checks.push(result("repository", "Git repository", exists && isGitRepo(root), exists ? (isGitRepo(root) ? `Repository found at ${root}` : `No Git repository at ${root}`) : "Project root does not exist", resolved.sources?.repository));

  let readable = false;
  let writable = false;
  if (exists) {
    try { fs.accessSync(root, fs.constants.R_OK); readable = true; } catch (_err) { /* reported below */ }
    try { fs.accessSync(root, fs.constants.W_OK); writable = true; } catch (_err) { /* reported below */ }
  }
  checks.push(result("permissions", "Repository permissions", readable && writable, readable && writable ? "Project root is readable and writable" : "Project root must be readable and writable"));
  checks.push(result("configuration", "Environment configuration", resolved.validation?.valid, resolved.validation?.valid ? `Configuration for ${config.environment || "dev"} is valid` : (resolved.validation?.errors || ["Invalid configuration"]).join("; ")));

  if ((config.transport || "direct") === "ssh") {
    let sshAvailable = false;
    try { execFileSync("ssh", ["-V"], { stdio: "ignore" }); sshAvailable = true; } catch (_err) { /* reported */ }
    const complete = Boolean(config.ssh_host && config.ssh_local_port && config.ssh_remote_port);
    checks.push(result("transport", "Managed SSH transport", sshAvailable && complete, sshAvailable && complete ? `SSH tunnel can forward localhost:${config.ssh_local_port}` : "ssh executable, host, local port, and remote port are required"));
  } else {
    checks.push(result("transport", "Direct HTTPS transport", config.adapter !== "rest" || Boolean(config.base_url), config.adapter === "rest" ? (config.base_url || "Base URL is missing") : "Not required by this adapter"));
  }

  const backupCommand = processEnv.SALTCORN_PROJECT_SYNC_BACKUP_CMD || runtimeValue(config, "backup_hook_env", processEnv);
  let backupReady = Boolean(backupCommand);
  let backupDetail = backupReady ? `Backup hook is referenced by ${config.backup_hook_env || "SALTCORN_PROJECT_SYNC_BACKUP_CMD"}` : "No backup hook reference is available";
  if (config.adapter === "rest") {
    backupReady = false;
    backupDetail = "Connection check did not confirm remote backup support";
  }
  if (config.adapter === "native" && !backupCommand) backupDetail = "Set a backup hook environment-variable reference";

  let connectionReady = config.adapter === "native";
  let connectionDetail = connectionReady ? "Native Saltcorn adapter is available in this tenant" : "Connection was not tested";
  if (config.adapter === "command") {
    connectionReady = Boolean(processEnv.SALTCORN_PROJECT_SYNC_EXPORT_CMD);
    connectionDetail = connectionReady ? "Command adapter export hook is configured" : "SALTCORN_PROJECT_SYNC_EXPORT_CMD is not configured";
  } else if (config.adapter === "rest" && config.base_url && typeof fetchImpl === "function") {
    const tokenRef = config.token_env;
    const token = processEnv.SALTCORN_PROJECT_SYNC_API_TOKEN || (tokenRef && processEnv[tokenRef]) || "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetchImpl(`${config.base_url.replace(/\/$/, "")}/project-sync/api/info`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = await response.json();
        connectionReady = payload?.ok !== false;
        connectionDetail = connectionReady ? `Connected to ${config.base_url}` : `Endpoint rejected the health request`;
        backupReady = Boolean(payload?.capabilities?.methods?.backup);
        backupDetail = backupReady ? "Remote adapter reports backup support" : "Remote adapter did not report backup support";
      } else {
        connectionDetail = `Endpoint returned HTTP ${response.status}`;
      }
    } catch (err) {
      connectionDetail = `Connection failed: ${err.name === "AbortError" ? "timeout" : err.message}`;
    } finally {
      clearTimeout(timer);
    }
  }
  checks.push(result("connection", "Tenant connection", connectionReady, connectionDetail, resolved.sources?.base_url));
  checks.push(result("backup", "Backup readiness", backupReady, backupDetail, resolved.sources?.backup_hook_env));

  const restoreCommand = processEnv.SALTCORN_PROJECT_SYNC_RESTORE_CMD || runtimeValue(config, "restore_hook_env", processEnv);
  checks.push(result("restore", "Restore hook", config.adapter === "rest" || Boolean(restoreCommand), config.adapter === "rest" ? "Remote restore endpoint selected" : (restoreCommand ? `Restore hook is referenced by ${config.restore_hook_env || "SALTCORN_PROJECT_SYNC_RESTORE_CMD"}` : "No restore hook reference is available"), resolved.sources?.restore_hook_env));
  return { ready: checks.every((check) => check.ready), checks };
}

module.exports = { runSetupHealth };
