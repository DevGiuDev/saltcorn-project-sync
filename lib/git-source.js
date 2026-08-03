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

function listDeploymentRefs(projectRoot, defaultRef = "HEAD") {
  const options = [];
  const seen = new Set();
  const add = (value, label, kind) => {
    const ref = String(value || "").trim();
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    options.push({ value: ref, label: String(label || ref), kind });
  };
  add(defaultRef, `${defaultRef} · configured source`, "configured");
  try {
    const refs = gitOutput(projectRoot, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)|%(objectname:short)|%(subject)",
      "refs/remotes/origin",
      "refs/tags",
    ]);
    for (const line of refs.split("\n").filter(Boolean)) {
      const [full, hash, ...subjectParts] = line.split("|");
      if (full === "refs/remotes/origin/HEAD") continue;
      if (full.startsWith("refs/remotes/origin/")) {
        const branch = full.slice("refs/remotes/origin/".length);
        add(branch, `${branch} · ${hash} ${subjectParts.join("|")}`.trim(), "branch");
      } else if (full.startsWith("refs/tags/")) {
        const tag = full.slice("refs/tags/".length);
        add(tag, `${tag} · tag · ${hash}`, "tag");
      }
    }
  } catch (_err) {
    // Keep the configured ref available even if ref discovery fails.
  }
  try {
    const commits = gitOutput(projectRoot, ["log", "-8", "--format=%H|%h|%s"]);
    for (const line of commits.split("\n").filter(Boolean)) {
      const [hash, short, ...subjectParts] = line.split("|");
      add(hash, `${short} · ${subjectParts.join("|")}`, "commit");
    }
  } catch (_err) {
    // A repository with no commits still has the configured source option.
  }
  return options;
}

function fastForwardWorkingBranch(projectRoot, source = {}) {
  const remoteMatch = String(source.resolved_ref || "").match(/^refs\/remotes\/origin\/(.+)$/);
  if (!remoteMatch) return { status: "not_applicable", reason: "selected source is not an origin branch" };
  const branch = gitOutput(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== remoteMatch[1]) {
    return { status: "not_applicable", reason: `working branch is ${branch}; selected source is ${remoteMatch[1]}` };
  }
  const dirty = gitOutput(projectRoot, ["status", "--porcelain"]);
  if (dirty) throw new Error("Working tree is dirty; commit or stash its changes before generating a deployment plan");
  const before = gitOutput(projectRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (before === source.commit) return { status: "current", branch, before, after: before };
  try {
    gitOutput(projectRoot, ["merge-base", "--is-ancestor", before, source.commit]);
  } catch (_err) {
    throw new Error(`Working branch ${branch} has diverged from origin/${branch}; resolve it from Git before deploying`);
  }
  gitOutput(projectRoot, ["merge", "--ff-only", source.resolved_ref]);
  const after = gitOutput(projectRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (after !== source.commit) throw new Error(`Could not synchronize ${branch} to the selected origin commit`);
  return { status: "fast_forwarded", branch, before, after };
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

/**
 * Return object entries introduced by a specific commit.  This is used only
 * as a migration bridge for projects whose manifest predates portable scope:
 * an object file added by the selected commit is an explicit Git intent and
 * may be tracked on the target without requiring a manual Scope round-trip.
 */
function listCommitScopeEntries(projectRoot, commit) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(commit || ""))) return [];
  const entries = [];
  const seen = new Set();
  let changes;
  try {
    changes = gitOutput(projectRoot, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", commit]);
  } catch (_err) {
    return entries;
  }
  for (const line of changes.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0] || "";
    if (status !== "A" && !status.startsWith("R")) continue;
    const file = parts[parts.length - 1] || "";
    const match = file.match(/^objects\/(tables|views|pages|triggers|roles|menu|settings)\/[^/]+\.json$/);
    if (!match) continue;
    let object;
    try {
      object = JSON.parse(gitOutput(projectRoot, ["show", `${commit}:${file}`]));
    } catch (_err) {
      continue;
    }
    const objectName = object?.name || object?.role;
    if (!objectName) continue;
    const entry = { object_type: match[1], object_name: String(objectName) };
    const key = `${entry.object_type}::${entry.object_name}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => `${a.object_type}::${a.object_name}`.localeCompare(`${b.object_type}::${b.object_name}`));
}

async function withGitCommitCheckout(projectRoot, commit, fn) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(commit || ""))) throw new Error("invalid Git commit");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "scps-deploy-"));
  const checkout = path.join(parent, "checkout");
  const archive = path.join(parent, "project.tar");
  try {
    fs.mkdirSync(checkout);
    execFileSync("git", scopedSafeGitArgs(projectRoot, ["archive", "--format=tar", `--output=${archive}`, commit]), {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    execFileSync("tar", ["--no-same-owner", "-xf", archive, "-C", checkout], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { ...process.env, LC_ALL: "C" },
    });
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
  listDeploymentRefs,
  listCommitScopeEntries,
  fastForwardWorkingBranch,
  resolveGitCommit,
  withGitCommitCheckout,
};
