const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { prepareDeployment, executeDeployment, backupPolicy, digest } = require("../lib/deploy-orchestrator");
const { validateGitRef, scopedSafeGitArgs, resolveGitCommit, withGitCommitCheckout } = require("../lib/git-source");
const { assertTargetTenant } = require("../lib/plugin/deploy-service");

function projectFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-orchestrator-"));
  fs.mkdirSync(path.join(dir, "objects", "tables"), { recursive: true });
  fs.mkdirSync(path.join(dir, "changes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "saltcorn.project.json"), JSON.stringify({
    format_version: 2, name: "Orchestrator", slug: "orchestrator", version: "1.2.3",
    saltcorn: { min_version: "1.6.0" }, objects: { tables: ["customers"] },
  }));
  fs.writeFileSync(path.join(dir, "plugins.lock.json"), JSON.stringify({ plugins: [] }));
  fs.writeFileSync(path.join(dir, "objects", "tables", "customers.json"), JSON.stringify({ name: "customers", fields: [{ name: "id", type: "Integer" }] }));
  return dir;
}

function mutableAdapter() {
  let actual = { tables: [], views: [], pages: [], triggers: [], roles: [], menu: [], settings: [], plugins: [] };
  let backups = 0;
  return {
    name: "memory",
    capabilities: { methods: { backup: true } },
    async info() { return { saltcorn_version: "1.6.1", capabilities: this.capabilities }; },
    async exportProject() { return actual; },
    async backup() { backups += 1; return { ok: true, id: `backup-${backups}`, created_at: "2026-08-03T12:00:00Z" }; },
    async applyPlan(payload) { actual = payload.desired; return { ok: true }; },
    get backups() { return backups; },
  };
}

test("backup policy is optional for dev and required for test/prod", () => {
  assert.equal(backupPolicy("dev"), "optional");
  assert.equal(backupPolicy("test"), "required");
  assert.equal(backupPolicy("prod", "optional"), "required");
});

test("interactive deployment refuses a non-native target adapter", () => {
  assert.throws(() => assertTargetTenant({ resolved: { config: { adapter: "rest" } } }), /adapter=native/);
});

test("shared orchestrator previews, applies, refreshes and verifies", async () => {
  const dir = projectFixture();
  const adapter = mutableAdapter();
  const prepared = await prepareDeployment({ sourceDir: dir, adapter, env: "dev", backupRequested: false });
  assert.equal(prepared.summary.count, 1);
  assert.equal(prepared.summary.blockers, 0);
  const events = [];
  const result = await executeDeployment({ prepared, adapter, refresh: async () => ["tables"], onStep: async (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(adapter.backups, 0);
  assert(events.some((event) => event.step === "backup" && event.status === "skipped"));
  assert(events.some((event) => event.step === "verify" && event.status === "complete"));
});

test("required backup is performed and must be verifiable", async () => {
  const dir = projectFixture();
  const adapter = mutableAdapter();
  const prepared = await prepareDeployment({ sourceDir: dir, adapter, env: "prod" });
  assert.equal(prepared.backup_policy, "required");
  assert.equal(prepared.plan.blocked.length, 0);
  await executeDeployment({ prepared, adapter, refresh: async () => [] });
  assert.equal(adapter.backups, 1);
});

test("orchestrator identifies the failed execution stage", async () => {
  const dir = projectFixture();
  const adapter = mutableAdapter();
  const prepared = await prepareDeployment({ sourceDir: dir, adapter, env: "dev", backupRequested: false });
  await assert.rejects(
    () => executeDeployment({ prepared, adapter, refresh: async () => { throw new Error("refresh unavailable"); } }),
    (error) => error.deploymentStep === "refresh"
  );
});

test("plan digest changes with reviewed operations", () => {
  assert.notEqual(digest({ operations: [] }), digest({ operations: [{ action: "create_table" }] }));
});

test("Git source resolves an exact commit in an isolated checkout", async () => {
  const dir = projectFixture();
  execFileSync("git", ["init", "-b", "develop"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: dir, stdio: "ignore" });
  const source = resolveGitCommit(dir, "develop", { preferRemote: false });
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  await withGitCommitCheckout(dir, source.commit, async (checkout) => {
    assert.equal(fs.existsSync(path.join(checkout, "saltcorn.project.json")), true);
    assert.notEqual(checkout, dir);
  });
  assert.throws(() => validateGitRef("--upload-pack=evil"), /invalid/);
});

test("Git source scopes safe.directory to the configured repository", () => {
  const dir = projectFixture();
  fs.mkdirSync(path.join(dir, ".git"));
  const args = scopedSafeGitArgs(dir, ["status", "--short"]);
  const root = fs.realpathSync(dir);
  assert.deepEqual(args.slice(0, 4), [
    "-c", `safe.directory=${root}`,
    "-c", `safe.directory=${path.join(root, ".git")}`,
  ]);
  assert.deepEqual(args.slice(4), ["status", "--short"]);
});
