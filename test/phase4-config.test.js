const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { normalizeOperationalConfig } = require("../lib/plugin/operational-config");
const tokenStore = require("../lib/plugin/token-store");
const { buildSshArgs, withManagedTransport } = require("../lib/transport");
const { runSetupHealth } = require("../lib/plugin/setup-health");
const { applyAuthorized } = require("../lib/plugin/auth");
const { resolveBackupProvider, publicBackupProvider, runBackupProvider } = require("../lib/backup");

test("operational config accepts references and interface roles but rejects plaintext secrets", () => {
  assert.deepEqual(normalizeOperationalConfig({ adapter: "rest", base_url: "https://saltcorn.test", token_env: "SCPS_TEST_TOKEN", ui_mode: "deployment", ignored: "value" }), {
    adapter: "rest", base_url: "https://saltcorn.test", token_env: "SCPS_TEST_TOKEN", ui_mode: "deployment",
  });
  assert.throws(() => normalizeOperationalConfig({ base_url: "http://remote.test" }), /HTTPS/);
  assert.throws(() => normalizeOperationalConfig({ ui_mode: "mystery" }), /ui_mode/);
});

test("stored token hashes authorize without retaining plaintext", () => {
  const salt = "abcd";
  const hash = tokenStore.digestToken("scps_example", salt);
  tokenStore.setTokenCache([{ id: 1, token_salt: salt, token_hash: hash, revoked_at: null }]);
  assert.equal(tokenStore.verifyStoredToken("scps_example"), true);
  assert.equal(applyAuthorized({ headers: { authorization: "Bearer scps_example" } }), true);
  assert.equal(tokenStore.verifyStoredToken("wrong"), false);
  tokenStore.setTokenCache([]);
});

test("managed SSH transport uses argument arrays and always terminates tunnel", async () => {
  const built = buildSshArgs({ ssh_host: "bastion.test", ssh_user: "deploy", ssh_local_port: "4312", ssh_remote_port: "3000" });
  assert.deepEqual(built.args.slice(0, 5), ["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes"]);
  assert(built.args.includes("4312:127.0.0.1:3000"));
  assert.equal(built.args.at(-1), "deploy@bastion.test");

  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = (signal) => { child.killedWith = signal; child.exitCode = 0; };
  const oldBase = process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
  try {
    const value = await withManagedTransport({ transport: "ssh", ssh_host: "bastion.test", ssh_local_port: "4312", ssh_remote_port: "3000" }, async () => process.env.SALTCORN_PROJECT_SYNC_BASE_URL, {
      spawn: () => child,
      waitForPort: async () => {},
    });
    assert.equal(value, "http://127.0.0.1:4312");
    assert.equal(child.killedWith, "SIGTERM");
  } finally {
    if (oldBase === undefined) delete process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
    else process.env.SALTCORN_PROJECT_SYNC_BASE_URL = oldBase;
  }
});

test("setup health reports a clear not-ready aggregate", async () => {
  const health = await runSetupHealth({
    project: { root_path: "/definitely/missing/scps-project" },
    resolved: { config: { environment: "test", adapter: "rest", transport: "direct", base_url: "https://tenant.test" }, sources: {}, validation: { valid: true, errors: [] } },
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(health.ready, false);
  assert(health.checks.some((check) => check.id === "connection" && !check.ready));
  assert(health.checks.some((check) => check.id === "backup" && !check.ready));
});

test("backup provider resolves a VPS environment-variable reference without exposing its command", () => {
  const provider = resolveBackupProvider({ backup_hook_env: "SCPS_DEV_BACKUP" }, {
    SCPS_DEV_BACKUP: "printf '{\"ok\":true,\"id\":\"dev-snapshot\"}'",
  });
  assert.deepEqual(publicBackupProvider(provider), { type: "command", ready: true, reference: "SCPS_DEV_BACKUP" });
  assert.equal(publicBackupProvider(provider).command, undefined);
  assert.equal(runBackupProvider(provider).id, "dev-snapshot");
});
