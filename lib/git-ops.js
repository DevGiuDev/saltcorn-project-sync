/**
 * Git operations for the Saltcorn Project Sync plugin.
 *
 * Wraps common git commands via child_process. All operations are scoped to
 * the project root directory. Commands that mutate state (commit, push,
 * checkout) are intentionally simple — no interactive rebase, no conflict
 * resolution. For complex workflows use the CLI or a Git client.
 */

const { execFileSync } = require("node:child_process");

// ─── Helpers ──────────────────────────────────────────────

function redactGitOutput(value) {
  return String(value || "")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function git(args, dir, opts = {}) {
  try {
    const result = execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts.timeout || 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return { ok: true, stdout: redactGitOutput(result.trim()), stderr: "" };
  } catch (err) {
    const stdout = redactGitOutput((err.stdout || "").trim());
    const stderr = redactGitOutput((err.stderr || "").trim());
    return { ok: false, stdout, stderr, code: err.status, error: stderr || stdout || redactGitOutput(err.message) };
  }
}

function isGitRepo(dir) {
  const r = git(["rev-parse", "--is-inside-work-tree"], dir);
  return r.ok;
}

// ─── Status ───────────────────────────────────────────────

/**
 * Parse `git status --porcelain` into structured data.
 * Returns { branch, clean, staged, unstaged, untracked, conflicted }
 */
function gitStatus(dir) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const status = git(["status", "--porcelain", "-b"], dir);
  if (!status.ok) return { ok: false, error: status.error };

  const lines = status.stdout.split("\n").filter(Boolean);
  const result = {
    ok: true,
    branch: branch.ok ? branch.stdout.replace(/^HEAD detached from /, "") : "(unknown)",
    clean: lines.length === 0 || (lines.length === 1 && lines[0].startsWith("## ")),
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ahead: 0,
    behind: 0,
  };

  // Parse ahead/behind from the ## line
  // Format: "## branch...origin/branch [ahead N, behind M]"
  for (const line of lines) {
    if (!line.startsWith("## ")) continue;
    const aheadMatch = line.match(/\bahead (\d+)/);
    const behindMatch = line.match(/\bbehind (\d+)/);
    if (aheadMatch) result.ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) result.behind = parseInt(behindMatch[1], 10);
    break;
  }

  // Fallback: if branch line had no tracking info, try rev-list
  if (result.ahead === 0 && result.behind === 0) {
    const ab = git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], dir);
    if (ab.ok) {
      const parts = ab.stdout.split("\t");
      if (parts.length === 2) {
        result.behind = parseInt(parts[0], 10) || 0;
        result.ahead = parseInt(parts[1], 10) || 0;
      }
    }
  }

  for (const line of lines) {
    if (line.startsWith("## ")) continue; // branch info line
    const x = line[0];
    const y = line[1];
    const filePath = line.substring(3);

    if (x === "?" && y === "?") {
      result.untracked.push(filePath);
    } else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      result.conflicted.push(filePath);
    } else {
      if (x !== " " && x !== "?") result.staged.push({ path: filePath, status: x });
      if (y !== " " && y !== "?") result.unstaged.push({ path: filePath, status: y });
    }
  }
  return result;
}

// ─── Add ──────────────────────────────────────────────────

/**
 * Add files to the staging area.
 * @param {string} dir
 * @param {string[]|null} paths - null/empty = add all (-A)
 */
function gitAdd(dir, paths) {
  if (!paths || !paths.length) {
    return git(["add", "-A"], dir);
  }
  return git(["add", "--", ...paths], dir);
}

// ─── Commit ───────────────────────────────────────────────

/**
 * Commit staged changes.
 * @param {string} dir
 * @param {string} message - commit message (required)
 */
function gitCommit(dir, message) {
  if (!message || !message.trim()) {
    return { ok: false, error: "Commit message is required" };
  }
  // execFileSync does not invoke a shell, so the message must be passed as-is.
  const r = git(["commit", "-m", message.trim()], dir);
  if (!r.ok) return r;
  const hash = git(["rev-parse", "--short", "HEAD"], dir);
  return { ok: true, hash: hash.ok ? hash.stdout : null, message: r.stdout };
}

// ─── Push ─────────────────────────────────────────────────

/**
 * Push to remote.
 * @param {string} dir
 * @param {string} [remote="origin"]
 * @param {string} [branch] - defaults to current branch
 */
function gitPush(dir, remote, branch) {
  // Check remote exists
  const remoteName = remote || "origin";
  const remoteCheck = git(["remote", "get-url", remoteName], dir);
  if (!remoteCheck.ok) {
    return { ok: false, error: `No remote "${remoteName}" configured. Add one with: git remote add ${remoteName} <url>` };
  }
  if (/\[redacted\]@/.test(remoteCheck.stdout)) {
    return { ok: false, error: "Remote URLs must not contain embedded credentials. Configure a non-interactive SSH deploy key or credential helper." };
  }
  // Detect current branch if not provided
  const current = branch ? { ok: true, stdout: branch } : git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const branchName = current.ok ? current.stdout : "";
  if (!branchName || branchName === "HEAD") {
    return { ok: false, error: "Could not determine a pushable current branch" };
  }
  const result = git(["push", "--porcelain", "--set-upstream", remoteName, branchName], dir, { timeout: 60_000 });
  if (!result.ok && /(authentication failed|could not read Username|terminal prompts disabled|permission denied \(publickey\))/i.test(result.error)) {
    return {
      ...result,
      error: `Git authentication failed for remote "${remoteName}". Configure a non-interactive SSH deploy key or credential helper; do not embed tokens in the remote URL.`,
    };
  }
  return result;
}

// ─── Pull ─────────────────────────────────────────────────

/**
 * Pull from remote.
 * @param {string} dir
 * @param {string} [remote="origin"]
 * @param {string} [branch]
 */
function gitPull(dir, remote, branch) {
  const args = branch ? ["pull", remote || "origin", branch] : ["pull", remote || "origin"];
  return git(args, dir, { timeout: 60_000 });
}

// ─── Branches ─────────────────────────────────────────────

/**
 * List local and remote branches.
 */
function gitBranches(dir) {
  const local = git(["branch", "--list"], dir);
  const remote = git(["branch", "-r"], dir);
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);

  const parseBranches = (str) =>
    str.split("\n").map((l) => l.trim().replace(/^\* /, "")).filter(Boolean);

  return {
    ok: true,
    current: current.ok ? current.stdout : "(unknown)",
    local: local.ok ? parseBranches(local.stdout) : [],
    remote: remote.ok ? parseBranches(remote.stdout) : [],
  };
}

// ─── Checkout ─────────────────────────────────────────────

/**
 * Switch to a branch.
 * Refuses if working tree is dirty (unless force).
 */
function gitCheckout(dir, branch, force) {
  if (!force) {
    const status = gitStatus(dir);
    if (status.ok && !status.clean) {
      return { ok: false, error: "Working tree is dirty. Commit or stash changes before switching branches." };
    }
  }
  return git(["checkout", branch], dir);
}

// ─── Log ──────────────────────────────────────────────────

/**
 * Recent commit log.
 * @param {string} dir
 * @param {number} [count=10]
 */
function gitLog(dir, count) {
  const n = count || 10;
  const r = git([
    "log", `-${n}`, "--pretty=format:%h|%an|%ar|%s",
    "--no-color",
  ], dir);
  if (!r.ok) return r;

  const commits = r.stdout.split("\n").filter(Boolean).map((line) => {
    const [hash, author, date, ...msgParts] = line.split("|");
    return { hash, author, date, message: msgParts.join("|") };
  });
  return { ok: true, commits };
}

// ─── Stash ────────────────────────────────────────────────

function gitStash(dir) {
  return git(["stash"], dir);
}

function gitStashPop(dir) {
  return git(["stash", "pop"], dir);
}

// ─── Remote URL ───────────────────────────────────────────

function gitRemoteUrl(dir) {
  return git(["remote", "get-url", "origin"], dir);
}

/**
 * Get ahead/behind counts for each branch against its remote tracking branch.
 * Returns { branchName: { ahead, behind } | null } where:
 *   ahead  = commits not pushed to remote
 *   behind = commits on remote not in local branch
 *   null   = no tracking branch exists
 *
 * @param {string} dir - Git repo path
 * @param {string[]} branches - Branches to compare
 * @returns {Object<string, {ahead: number, behind: number} | null>}
 */
function gitAheadBehind(dir, branches) {
  const result = {};
  for (const b of branches) {
    const tracking = `origin/${b}`;
    const r = git(["rev-list", "--left-right", "--count", `${tracking}...${b}`], dir);
    if (r.ok) {
      const parts = r.stdout.split(/\s+/);
      result[b] = {
        behind: parseInt(parts[0], 10) || 0,
        ahead: parseInt(parts[1], 10) || 0,
      };
    } else {
      result[b] = null; // no tracking branch
    }
  }
  return result;
}

/**
 * Merge a branch into the current branch.
 * @param {string} branchName - Branch to merge into current
 * @param {string} dir - Git repo path
 */
function gitMerge(branchName, dir) {
  return git(["merge", branchName], dir, { timeout: 60_000 });
}

module.exports = {
  redactGitOutput,
  git,
  isGitRepo,
  gitStatus,
  gitAdd,
  gitCommit,
  gitPush,
  gitPull,
  gitBranches,
  gitCheckout,
  gitMerge,
  gitLog,
  gitStash,
  gitStashPop,
  gitRemoteUrl,
  gitAheadBehind,
};
