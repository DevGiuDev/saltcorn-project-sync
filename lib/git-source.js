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

function gitOutput(projectRoot, args) {
  return execFileSync("git", args, {
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
    execFileSync("git", ["clone", "--shared", "--no-checkout", "--", projectRoot, checkout], {
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

module.exports = { validateGitRef, fetchRemote, resolveGitCommit, withGitCommitCheckout };
