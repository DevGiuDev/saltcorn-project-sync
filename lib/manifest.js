const fs = require("node:fs");
const path = require("node:path");
const { parseJson } = require("./canonical-json");
const { execSync } = require("node:child_process");

const MANIFEST_FILE = "saltcorn.project.json";
const CURRENT_FORMAT_VERSION = 2;

/**
 * Detect the current git branch for a directory.
 * Returns null if not a git repo or git is unavailable.
 */
function detectGitBranch(dir) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect the current git commit short hash.
 * Returns null if not a git repo.
 */
function detectGitCommit(dir) {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect if the git working tree is dirty (uncommitted changes).
 */
function detectGitDirty(dir) {
  try {
    const status = execSync("git status --porcelain", { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return status.length > 0;
  } catch {
    return null;
  }
}

/**
 * Read git metadata for a project directory.
 */
function readGitInfo(dir) {
  const branch = detectGitBranch(dir);
  if (!branch) return null; // not a git repo
  return {
    branch,
    commit: detectGitCommit(dir),
    dirty: detectGitDirty(dir),
  };
}

/**
 * Compute per-file sync status by comparing git commit timestamp against last_sync.
 * Uses git log for each file (not filesystem mtime) because git checkout
 * resets mtime to the current time, making mtime unreliable.
 *
 * Returns a Map of `"kind::safeName"` → `{ modified_after_sync: boolean }`
 */
function computeFileSyncStatus(projectDir, lastSyncEpoch) {
  if (!lastSyncEpoch) return null;
  const { OBJECT_DIRS } = require("./project-io");
  const result = new Map();

  // Check if git is available
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: projectDir, stdio: "pipe" });
  } catch {
    // Not a git repo — fall back to mtime
    for (const kind of OBJECT_DIRS) {
      const dir = path.join(projectDir, "objects", kind);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const baseName = file.replace(/\.json$/, "");
        result.set(`${kind}::${baseName}`, {
          modified_after_sync: stat.mtimeMs > lastSyncEpoch,
        });
      }
    }
    return result.size > 0 ? result : null;
  }

  // Git repo — use git log timestamps
  for (const kind of OBJECT_DIRS) {
    const dir = path.join(projectDir, "objects", kind);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const filePath = path.join("objects", kind, file); // relative path for git
      const baseName = file.replace(/\.json$/, "");
      try {
        const ts = execSync(
          `git log -1 --format="%at" -- ${filePath}`,
          { cwd: projectDir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        ).trim();
        const commitEpoch = ts ? parseInt(ts, 10) * 1000 : 0;
        result.set(`${kind}::${baseName}`, {
          modified_after_sync: commitEpoch > lastSyncEpoch,
        });
      } catch {
        // File not tracked by git yet — consider it modified
        result.set(`${kind}::${baseName}`, { modified_after_sync: true });
      }
    }
  }
  return result.size > 0 ? result : null;
}

function defaultManifest({ name = "saltcorn-project", slug = "saltcorn-project" } = {}) {
  return {
    format_version: CURRENT_FORMAT_VERSION,
    name,
    slug,
    version: "0.1.0",
    saltcorn: {
      min_version: "1.6.0",
      tested_versions: [],
    },
    sync: {
      last_sync: null,         // ISO 8601 timestamp of last full deploy (push to live)
      last_sync_epoch: null,   // Same as epoch ms for fast comparison
      last_sync_commit: null,  // Git commit hash at last sync
    },
    objects: {
      tables: [],
      views: [],
      pages: [],
      triggers: [],
      roles: [],
      menu: [],
      settings: [],
    },
    excluded: {
      users: true,
      sessions: true,
      logs: true,
      transactional_data: true,
      secrets: true,
    },
  };
}

function loadManifest(projectDir = process.cwd()) {
  const file = path.join(projectDir, MANIFEST_FILE);
  return parseJson(fs.readFileSync(file, "utf8"), file);
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") errors.push("manifest must be an object");
  if (!manifest.name) errors.push("name is required");
  if (!manifest.slug) errors.push("slug is required");
  // Accept both format_version 1 (legacy) and 2 (current)
  if (manifest.format_version && manifest.format_version > CURRENT_FORMAT_VERSION) {
    errors.push(`format_version ${manifest.format_version} is newer than supported ${CURRENT_FORMAT_VERSION}`);
  }
  if (!manifest.objects || typeof manifest.objects !== "object") {
    errors.push("objects section is required");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Read sync metadata from manifest, with fallbacks for v1 manifests.
 */
function readSyncMeta(manifest) {
  return manifest.sync || {
    last_sync: null,
    last_sync_epoch: null,
    last_sync_commit: null,
  };
}

/**
 * Update sync metadata in the manifest after a full deploy/sync.
 * Sets last_sync to now and captures git info if available.
 */
function stampSyncMeta(manifest, projectDir) {
  const now = new Date();
  const gitInfo = readGitInfo(projectDir);
  manifest.sync = {
    last_sync: now.toISOString(),
    last_sync_epoch: now.getTime(),
    last_sync_commit: gitInfo ? gitInfo.commit : null,
    last_sync_branch: gitInfo ? gitInfo.branch : null,
  };
  return manifest;
}

/**
 * Enrich a manifest with git info (branch, commit, dirty) without mutating the file.
 * Used for display purposes.
 */
function enrichWithGitInfo(manifest, projectDir) {
  const git = readGitInfo(projectDir);
  return { ...manifest, git };
}

/**
 * Bump the patch version of a semver string.
 * Returns the new version string, or null if input is not valid semver.
 */
function bumpPatch(version) {
  const { parseVersion } = require("./compatibility");
  const parts = parseVersion(version);
  if (!parts) return null;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * Bump the minor version of a semver string, resetting patch to 0.
 * Returns the new version string, or null if input is not valid semver.
 */
function bumpMinor(version) {
  const { parseVersion } = require("./compatibility");
  const parts = parseVersion(version);
  if (!parts) return null;
  return `${parts[0]}.${parts[1] + 1}.0`;
}

/**
 * Read the version from git HEAD (last committed manifest).
 * Returns null if not a git repo or no previous commit.
 */
function lastCommittedVersion(projectDir = process.cwd()) {
  try {
    const content = execSync(
      `git show HEAD:${MANIFEST_FILE}`,
      { cwd: projectDir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const manifest = JSON.parse(content);
    return manifest.version || null;
  } catch {
    return null;
  }
}

module.exports = {
  MANIFEST_FILE,
  CURRENT_FORMAT_VERSION,
  defaultManifest,
  loadManifest,
  validateManifest,
  readSyncMeta,
  stampSyncMeta,
  enrichWithGitInfo,
  readGitInfo,
  computeFileSyncStatus,
  bumpPatch,
  bumpMinor,
  lastCommittedVersion,
};
