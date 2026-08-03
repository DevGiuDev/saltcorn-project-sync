const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  redactGitOutput,
  gitCommit,
  gitPush,
  gitRemoteUrl,
  syncPortableScope,
} = require("../lib/git-ops");

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Project Sync Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "project-sync@example.test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  return dir;
}

test("git output redacts credentials embedded in URLs and messages", () => {
  const output = redactGitOutput("fatal https://user:secret@example.test token=abc password:xyz");
  assert.doesNotMatch(output, /user:secret|abc|xyz/);
  assert.match(output, /\[redacted\]/);
});

test("git commit preserves quotes without shell escaping", () => {
  const dir = repo();
  const message = 'fix: preserve "quoted" text';
  const result = gitCommit(dir, message);
  assert.equal(result.ok, true);
  const actual = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf8" }).trim();
  assert.equal(actual, message);
});

test("commit can record portable scope from staged object files", () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, "objects", "views"), { recursive: true });
  fs.writeFileSync(path.join(dir, "saltcorn.project.json"), JSON.stringify({ name: "Demo", version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "objects", "views", "dashboard.json"), JSON.stringify({ name: "dashboard", viewtemplate: "List" }));
  execFileSync("git", ["add", "."], { cwd: dir });
  const result = gitCommit(dir, "feat: add dashboard", { syncScope: true });
  assert.equal(result.ok, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "saltcorn.project.json"), "utf8"));
  assert.deepEqual(manifest.scope.objects.views, ["dashboard"]);
  assert.ok(result.scope);
  assert.equal(syncPortableScope(dir).ok, true);
});

test("git remote output never exposes embedded credentials", () => {
  const dir = repo();
  execFileSync("git", ["remote", "add", "origin", "https://user:secret@example.test/private.git"], { cwd: dir });
  const remote = gitRemoteUrl(dir);
  assert.equal(remote.ok, true);
  assert.equal(remote.stdout, "https://[redacted]@example.test/private.git");
  const push = gitPush(dir);
  assert.equal(push.ok, false);
  assert.match(push.error, /must not contain embedded credentials/);
  assert.doesNotMatch(push.error, /secret/);
});
