const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateEnvironmentConfig, resolveEnvironmentConfig, activateEnvironmentConfig, applyEnvironmentOverlay } = require("../lib/environment");

test("validateEnvironmentConfig rejects secrets", () => {
  const result = validateEnvironmentConfig({ api_key: "nope", bearer_auth: "nope" });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => /api_key/.test(error)));
  assert(result.errors.some((error) => /bearer_auth/.test(error)));
});

test("validateEnvironmentConfig allows secret references but not secret values", () => {
  assert.equal(validateEnvironmentConfig({ token_env: "DEPLOY_TOKEN", backup_hook_env: "BACKUP_COMMAND" }).valid, true);
  assert.equal(validateEnvironmentConfig({ token: "plaintext" }).valid, false);
});

test("environment precedence is process, profile, UI, then defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-env-"));
  fs.mkdirSync(path.join(dir, "environments"));
  fs.writeFileSync(path.join(dir, "environments", "test.json"), JSON.stringify({ environment: "test", adapter: "rest", base_url: "https://profile.test", transport: "direct", token_env: "PROFILE_TOKEN" }));
  const processEnv = { SALTCORN_PROJECT_SYNC_BASE_URL: "https://process.test", PROFILE_TOKEN: "not-exported" };
  const resolved = resolveEnvironmentConfig({ projectDir: dir, env: "test", uiConfig: { adapter: "native", base_url: "https://ui.test" }, processEnv });
  assert.equal(resolved.config.adapter, "rest");
  assert.equal(resolved.config.base_url, "https://process.test");
  assert.equal(resolved.sources.adapter, "environment_profile");
  assert.equal(resolved.sources.base_url, "process_environment");
  assert.equal(JSON.stringify(resolved).includes("not-exported"), false);
});

test("activateEnvironmentConfig resolves runtime references without persisting values", () => {
  const processEnv = { DEPLOY_TOKEN: "one-time-secret", BACKUP_HOOK: "backup-tool --json" };
  const resolved = { config: { environment: "test", adapter: "rest", token_env: "DEPLOY_TOKEN", backup_hook_env: "BACKUP_HOOK" } };
  activateEnvironmentConfig(resolved, processEnv);
  assert.equal(processEnv.SALTCORN_PROJECT_SYNC_API_TOKEN, "one-time-secret");
  assert.equal(processEnv.SALTCORN_PROJECT_SYNC_BACKUP_CMD, "backup-tool --json");
});

test("applyEnvironmentOverlay merges non-secret settings", () => {
  const result = applyEnvironmentOverlay({ settings: { a: 1 } }, { settings: { b: 2 } });
  assert.deepEqual(result.settings, { a: 1, b: 2 });
});
