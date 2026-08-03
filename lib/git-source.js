const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function validateGitRef(value) {
  const ref = String(value || "HEAD").trim();
  if (!ref || ref.length > 255 || ref.startsWith("-") || /[\0\r\n\s~^:?*[\\]/.test(ref) || ref.includes("..") || ref.includes("@{")) {
    throw new Error("invalid Git ref");
  }
  return ref;
}

function repositoryGitDir(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  const dotGit = path.join(root, ".git");
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return dotGit;
    if (stat.isFile()) {
      const match = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
      if (match) return path.resolve(root, match[1]);
    }
  } catch (_err) {
    // Let Git report a missing or invalid repository.
  }
  return dotGit;
}

function scopedSafeGitArgs(projectRoot, args) {
  const root = fs.realpathSync(projectRoot);
  const gitDir = repositoryGitDir(root);
  const safeDirectories = [...new Set([root, gitDir])];
  return safeDirectories.flatMap((directory) => ["-c", `safe.directory=${directory}`]).concat(args);
}

function gitOutput(projectRoot, args) {
  return execFileSync("git", scopedSafeGitArgs(projectRoot, args), {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  }).trim();
}

function fetchRemote(projectRoot, remote = "origin") {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(remote)) throw new Error("invalid Git remote");
  gitOutput(projectRoot, ["fetch", "--prune", remote]);
}

function resolveGitCommit(projectRoot, inputRef = "HEAD", { preferRemote = true } = {}) {
  const ref = validateGitRef(inputRef);
  const candidates = [];
  if (preferRemote && !ref.includes("/") && ref !== "HEAD" && !/^[a-f0-9]{7,64}$/i.test(ref)) {
    candidates.push(`refs/remotes/origin/${ref}`);
  }
  candidates.push(ref);
  for (const candidate of candidates) {
    try {
      const commit = gitOutput(projectRoot, ["rev-parse", "--verify", `${candidate}^{commit}`]);
      if (/^[a-f0-9]{40,64}$/i.test(commit)) return { ref, resolved_ref: candidate, commit: commit.toLowerCase() };
    } catch (_err) {
      // Try next safe candidate.
    }
  }
  throw new Error(`Git ref not found: ${ref}`);
}

async function withGitCommitCheckout(projectRoot, commit, fn) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(commit || ""))) throw new Error("invalid Git commit");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "scps-deploy-"));
  const checkout = path.join(parent, "checkout");
  try {
    execFileSync("git", scopedSafeGitArgs(projectRoot, ["clone", "--shared", "--no-checkout", "--", projectRoot, checkout]), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    gitOutput(checkout, ["checkout", "--detach", commit]);
    return await fn(checkout);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

module.exports = {
  validateGitRef,
  repositoryGitDir,
  scopedSafeGitArgs,
  fetchRemote,
  resolveGitCommit,
  withGitCommitCheckout,
};
