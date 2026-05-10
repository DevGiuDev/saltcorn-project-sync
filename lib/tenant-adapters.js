const { execFileSync, spawnSync } = require("node:child_process");
const { parseJson } = require("./canonical-json");

function requireCommand(name) {
  const cmd = process.env[name];
  if (!cmd) throw new Error(`${name} is required for command tenant adapter`);
  return cmd;
}

function runShellJson(command, input = null) {
  const result = spawnSync(command, {
    shell: true,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with ${result.status}`);
  }
  return result.stdout ? parseJson(result.stdout, command) : null;
}

function commandAdapter() {
  return {
    exportProject() {
      return runShellJson(requireCommand("SALTCORN_PROJECT_SYNC_EXPORT_CMD"));
    },
    applyProject(state) {
      const cmd = requireCommand("SALTCORN_PROJECT_SYNC_APPLY_CMD");
      return runShellJson(cmd, state) || { ok: true };
    },
    backup() {
      const cmd = process.env.SALTCORN_PROJECT_SYNC_BACKUP_CMD;
      if (!cmd) return { ok: true, skipped: true };
      return runShellJson(cmd) || { ok: true };
    },
  };
}

function getTenantAdapter(name = process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command") {
  if (name === "command") return commandAdapter();
  throw new Error(`unsupported tenant adapter: ${name}`);
}

function gitCommitOrNull(projectDir = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim();
  } catch (_err) {
    return null;
  }
}

module.exports = { getTenantAdapter, commandAdapter, gitCommitOrNull };
