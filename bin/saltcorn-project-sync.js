#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { canonicalStringify, parseJson } = require("../lib/canonical-json");
const { defaultManifest, MANIFEST_FILE, loadManifest } = require("../lib/manifest");
const { ensureProjectDirs, writeCanonicalJson, readJsonIfExists } = require("../lib/project-io");
const { loadChangeIntents } = require("../lib/change-intents");
const { planProject } = require("../lib/planner");
const { VERSIONED_KINDS, normalizePack, normalizeProjectExport } = require("../lib/normalizer");
const { loadProjectState } = require("../lib/project-state");
const { applyProject } = require("../lib/apply-engine");
const { writeProjectExport } = require("../lib/export-writer");
const { createBackupRecord, currentGitCommit } = require("../lib/backup");
const { appendDeploymentRecord, appendRollbackRecord, findDeploymentRecord } = require("../lib/deployments");
const { getTenantAdapter } = require("../lib/tenant-adapters");
const { analyzeDependencies } = require("../lib/dependencies");
const { writeReferenceTable } = require("../lib/reference-data");
const { validateSeeds, loadSeedFiles, loadMigrationFiles, planSeeds, planMigrations, writeSeedFile, writeMigrationFile } = require("../lib/seeds");
const { validateProject } = require("../lib/validator");
const { checkPluginCompatibility, checkSaltcornCompatibility } = require("../lib/compatibility");
const { checkSequences, fixSequences } = require("../lib/postgres-sequences");

function usage() {
  console.log(`Saltcorn Project Sync

Usage:
  saltcorn-project-sync init [--name NAME] [--slug SLUG] [--git]
  saltcorn-project-sync validate
  saltcorn-project-sync deps
  saltcorn-project-sync import-pack --pack FILE
  saltcorn-project-sync import-reference --table TABLE --rows FILE [--key KEY]
  saltcorn-project-sync diff --tenant-export FILE
  saltcorn-project-sync plan [--env ENV] [--backup] --tenant-export FILE
  saltcorn-project-sync report [--env ENV] [--backup] --tenant-export FILE [--out FILE]
  saltcorn-project-sync preflight [--env ENV] [--backup] --tenant-export FILE
  saltcorn-project-sync apply-file [--env ENV] [--backup] --tenant-export FILE --out FILE
  saltcorn-project-sync backup [--env ENV] [--source FILE]
  saltcorn-project-sync record-deployment --env ENV --status STATUS
  saltcorn-project-sync doctor
  saltcorn-project-sync doctor-live [--adapter command|rest|native]
  saltcorn-project-sync check-live [--adapter command|native]
  saltcorn-project-sync check-sequences [--table-like PATTERN]
  saltcorn-project-sync fix-sequences [--table-like PATTERN]
  saltcorn-project-sync list-seeds
  saltcorn-project-sync list-migrations
  saltcorn-project-sync apply-seeds [--adapter ADAPTER] [--env ENV]
  saltcorn-project-sync apply-migrations [--adapter ADAPTER] [--env ENV]
  saltcorn-project-sync add-seed --name NAME [--order N]
  saltcorn-project-sync add-migration --name NAME [--order N]
  saltcorn-project-sync git-status
  saltcorn-project-sync git-commit -m MESSAGE
  saltcorn-project-sync git-pull
  saltcorn-project-sync git-push
  saltcorn-project-sync export [--adapter command|rest|native] --out DIR
  saltcorn-project-sync apply [--adapter command|rest|native] [--env ENV] [--allow-destructive]
  saltcorn-project-sync restore [--adapter command|rest|native] [--deployment ID|last]
  saltcorn-project-sync list-seeds
  saltcorn-project-sync list-migrations
  saltcorn-project-sync apply-seeds [--adapter command|rest|native] [--env ENV]
  saltcorn-project-sync apply-migrations [--adapter command|rest|native] [--env ENV]
  saltcorn-project-sync add-seed --name NAME [--order N]
  saltcorn-project-sync add-migration --name NAME [--order N]
  saltcorn-project-sync reset [--adapter command|rest|native] [--env ENV] --yes-reset-everything

Live export/apply is adapter-backed. Use 'command' for wrappers or 'native' inside a Saltcorn runtime with @saltcorn/data available.
`);
}

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function has(flag) {
  return process.argv.includes(flag);
}

function commandInit() {
  const projectDir = process.cwd();
  ensureProjectDirs(projectDir);
  const manifestFile = path.join(projectDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) {
    writeCanonicalJson(
      manifestFile,
      defaultManifest({ name: arg("--name", "Saltcorn Project"), slug: arg("--slug", "saltcorn-project") })
    );
  }
  for (const env of ["local", "dev", "test", "prod"]) {
    const file = path.join(projectDir, "environments", `${env}.json`);
    if (!fs.existsSync(file)) writeCanonicalJson(file, { environment: env, destructive_policy: env === "prod" || env === "test" ? "intent_required" : "confirm" });
  }
  if (!fs.existsSync(path.join(projectDir, "plugins.lock.json"))) {
    writeCanonicalJson(path.join(projectDir, "plugins.lock.json"), { plugins: [] });
  }
  if (has("--git") && !fs.existsSync(path.join(projectDir, ".git"))) {
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "inherit" });
  }
  console.log(`Initialized ${MANIFEST_FILE}`);
}

function commandValidate() {
  const result = validateProject(process.cwd(), loadManifest(), loadChangeIntents());
  if (result.errors.length) {
    console.error(result.errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  if (result.warnings.length) console.warn(result.warnings.map((e) => `- ${e}`).join("\n"));
  const seedValidation = validateSeeds();
  if (seedValidation.errors.length) {
    for (const e of seedValidation.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  if (seedValidation.warnings.length) console.warn(seedValidation.warnings.map((e) => `- ${e}`).join("\n"));
  console.log("Project is valid");
}

function validateTenantExportShape(actualRaw, tenantFile) {
  if (!actualRaw || typeof actualRaw !== "object") throw new Error(`${tenantFile} is not a JSON object`);
  if (actualRaw.ok === false || actualRaw.error) {
    throw new Error(`${tenantFile} is an error response, not a tenant export: ${actualRaw.error || JSON.stringify(actualRaw)}`);
  }
  const exportKeys = ["tables", "views", "pages", "triggers", "roles", "menu", "settings", "plugins", "reference_data"];
  if (!exportKeys.some((key) => Object.prototype.hasOwnProperty.call(actualRaw, key))) {
    throw new Error(`${tenantFile} does not look like a Saltcorn tenant export`);
  }
}

function loadDesiredAndActual() {
  const desired = loadProjectState();
  const tenantFile = arg("--tenant-export");
  if (!tenantFile) throw new Error("--tenant-export FILE is required");
  const actualRaw = readJsonIfExists(path.resolve(tenantFile));
  validateTenantExportShape(actualRaw, tenantFile);
  const actual = normalizeProjectExport(actualRaw || {});
  return { desired, actual };
}

function commandImportPack() {
  const packFile = arg("--pack");
  if (!packFile) throw new Error("--pack FILE is required");
  ensureProjectDirs(process.cwd());
  const pack = parseJson(fs.readFileSync(path.resolve(packFile), "utf8"), packFile);
  const normalized = normalizePack(pack);
  const written = writeProjectExport(process.cwd(), normalized);
  console.log(`Imported ${written.length} files`);
  for (const file of written) console.log(path.relative(process.cwd(), file));
}

function commandImportReference() {
  const table = arg("--table");
  const rowsFile = arg("--rows");
  if (!table) throw new Error("--table TABLE is required");
  if (!rowsFile) throw new Error("--rows FILE is required");
  const parsed = parseJson(fs.readFileSync(path.resolve(rowsFile), "utf8"), rowsFile);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) throw new Error("reference rows file must be an array or { rows: [] }");
  const file = writeReferenceTable(process.cwd(), table, rows, { key: arg("--key", "id") });
  console.log(path.relative(process.cwd(), file));
}

function commandDeps() {
  process.stdout.write(canonicalStringify(analyzeDependencies(loadProjectState())));
}

function commandDiff() {
  const { desired, actual } = loadDesiredAndActual();
  const { diffNamedCollections, diffTables } = require("../lib/diff");
  const diff = { tables: diffTables(desired.tables, actual.tables) };
  for (const kind of VERSIONED_KINDS.filter((kind) => kind !== "tables")) {
    diff[kind] = diffNamedCollections(desired[kind], actual[kind]);
  }
  process.stdout.write(canonicalStringify(diff));
}

function commandPlan() {
  const { desired, actual } = loadDesiredAndActual();
  const intents = loadChangeIntents();
  const env = arg("--env", "dev");
  process.stdout.write(canonicalStringify(planProject({ desired, actual, intents, env, backup: has("--backup") })));
}

function markdownReport({ env, plan, validation }) {
  const lines = [
    `# Saltcorn Project Sync report`,
    ``,
    `- Environment: ${env}`,
    `- Operations: ${plan.operations.length}`,
    `- Warnings: ${plan.warnings.length}`,
    `- Blocked: ${plan.blocked.length}`,
    `- Backup required: ${plan.backup_required ? "yes" : "no"}`,
    `- Backup present: ${plan.backup_present ? "yes" : "no"}`,
    ``,
    `## Validation`,
    ``,
    validation.errors.length ? validation.errors.map((e) => `- ❌ ${e}`).join("\n") : `- ✅ No validation errors`,
    validation.warnings.length ? validation.warnings.map((e) => `- ⚠️ ${e}`).join("\n") : `- ✅ No validation warnings`,
    ``,
    `## Blocked operations`,
    ``,
    plan.blocked.length ? plan.blocked.map((b) => `- ❌ ${b.code || "blocked"}: ${b.reason || JSON.stringify(b)}`).join("\n") : `- ✅ None`,
    ``,
    `## Warnings`,
    ``,
    plan.warnings.length ? plan.warnings.map((w) => `- ⚠️ ${w.type}: ${w.message || ""} ${w.table || ""} ${w.field || ""}`).join("\n") : `- ✅ None`,
    ``,
    `## Operations`,
    ``,
    plan.operations.length ? plan.operations.map((op) => `- ${op.safe ? "✅" : "⚠️"} ${op.action} ${op.table || op.view || op.page || op.trigger || op.role || ""} ${op.field || op.from || ""}`).join("\n") : `- None`,
    ``,
  ];
  return `${lines.join("\n")}\n`;
}

function commandPreflight() {
  const { desired, actual } = loadDesiredAndActual();
  const intents = loadChangeIntents();
  const env = arg("--env", "dev");
  const validation = validateProject(process.cwd(), loadManifest(), intents);
  const plan = planProject({ desired, actual, intents, env, backup: has("--backup") });
  const result = {
    ok: validation.errors.length === 0 && plan.blocked.length === 0,
    env,
    validation: { errors: validation.errors, warnings: validation.warnings },
    plan: {
      operations: plan.operations.length,
      warnings: plan.warnings.length,
      blocked: plan.blocked,
      backup_required: plan.backup_required,
      backup_present: plan.backup_present,
    },
  };
  process.stdout.write(canonicalStringify(result));
  if (!result.ok) process.exit(5);
}

function commandReport() {
  const { desired, actual } = loadDesiredAndActual();
  const intents = loadChangeIntents();
  const env = arg("--env", "dev");
  const plan = planProject({ desired, actual, intents, env, backup: has("--backup") });
  const validation = validateProject(process.cwd(), loadManifest(), intents);
  const report = markdownReport({ env, plan, validation });
  const out = arg("--out");
  if (out) fs.writeFileSync(path.resolve(out), report);
  else process.stdout.write(report);
}

function commandApplyFile() {
  const { desired, actual } = loadDesiredAndActual();
  const intents = loadChangeIntents();
  const env = arg("--env", "dev");
  const out = arg("--out");
  if (!out) throw new Error("--out FILE is required");
  const result = applyProject({ desired, actual, intents, env, backup: has("--backup"), force: has("--force") });
  if (!result.applied) {
    process.stdout.write(canonicalStringify(result));
    process.exit(3);
  }
  writeCanonicalJson(path.resolve(out), result.state);
  appendDeploymentRecord(process.cwd(), {
    env,
    status: "applied-file",
    commit: currentGitCommit(),
    operations: result.plan.operations.length,
    warnings: result.plan.warnings.length,
    output: path.resolve(out),
  });
  process.stdout.write(canonicalStringify(result));
}

function commandBackup() {
  const env = arg("--env", "dev");
  const result = createBackupRecord({ projectDir: process.cwd(), env, commit: currentGitCommit(), source: arg("--source") });
  console.log(path.relative(process.cwd(), result.dir));
}

function commandRecordDeployment() {
  const record = appendDeploymentRecord(process.cwd(), {
    env: arg("--env", "dev"),
    status: arg("--status", "unknown"),
    commit: currentGitCommit(),
  });
  process.stdout.write(canonicalStringify(record));
}

async function commandCheckLive() {
  const result = await runLiveChecks(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const compact = {
    ok: result.ok,
    info: result.info,
    saltcorn: result.saltcorn,
    plugins: result.plugins,
  };
  process.stdout.write(canonicalStringify(compact));
  if (!compact.ok) process.exit(4);
}

function checkOk(checks, name, details = {}) {
  checks.push({ name, ok: true, ...details });
}

function checkFail(checks, name, err, details = {}) {
  checks.push({ name, ok: false, errors: [err && err.message ? err.message : String(err)], ...details });
}

async function runOptionalSequenceCheck(checks) {
  const cmd = process.env.SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD;
  if (cmd) {
    try {
      const out = execFileSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
      const parsed = out.trim() ? parseJson(out, "SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD") : { ok: true };
      checks.push({ name: "postgres sequence health", ok: parsed.ok !== false, result: parsed });
    } catch (err) {
      checkFail(checks, "postgres sequence health", err);
    }
    return;
  }
  if (!process.env.PGDATABASE && !process.env.DATABASE_URL) {
    checks.push({ name: "postgres sequence health", ok: true, skipped: true, warnings: ["PGDATABASE or DATABASE_URL is not configured"] });
    return;
  }
  try {
    const result = checkSequences({ tableLike: arg("--table-like", process.env.SALTCORN_PROJECT_SYNC_SEQUENCE_TABLE_LIKE || "\\_sc\\_%") });
    checks.push({ name: "postgres sequence health", ok: result.ok, result });
  } catch (err) {
    checkFail(checks, "postgres sequence health", err);
  }
}

async function runLiveChecks(adapterName) {
  const checks = [];
  let adapter;
  let info = null;
  let exported = null;
  let saltcorn = { ok: false, errors: ["not checked"] };
  let plugins = { ok: false, errors: ["not checked"] };

  try {
    adapter = getTenantAdapter(adapterName);
    checkOk(checks, "adapter load", { adapter: adapter.name || adapterName });
  } catch (err) {
    checkFail(checks, "adapter load", err, { adapter: adapterName });
    return { ok: false, adapter: adapterName, checks, info, saltcorn, plugins };
  }

  try {
    info = adapter.info ? await adapter.info() : { adapter: adapter.name || "unknown", capabilities: adapter.capabilities || null };
    if (!info.capabilities && adapter.capabilities) info.capabilities = adapter.capabilities;
    checkOk(checks, "REST/plugin reachability", { info });
  } catch (err) {
    checkFail(checks, "REST/plugin reachability", err);
  }

  try {
    const manifest = loadManifest();
    saltcorn = checkSaltcornCompatibility(manifest, info && info.saltcorn_version);
    checks.push({ name: "Saltcorn version", ok: saltcorn.ok, result: saltcorn });
  } catch (err) {
    checkFail(checks, "Saltcorn version", err);
  }

  try {
    exported = normalizeProjectExport(await adapter.exportProject());
    checkOk(checks, "live export", {
      counts: VERSIONED_KINDS.reduce((acc, kind) => {
        acc[kind] = (exported[kind] || []).length;
        return acc;
      }, { plugins: (exported.plugins || []).length }),
    });
  } catch (err) {
    checkFail(checks, "live export", err);
  }

  try {
    const pluginLock = readJsonIfExists(path.join(process.cwd(), "plugins.lock.json"), { plugins: [] });
    plugins = checkPluginCompatibility(pluginLock.plugins || [], (exported && exported.plugins) || []);
    checks.push({ name: "required plugins", ok: plugins.ok, result: plugins });
  } catch (err) {
    checkFail(checks, "required plugins", err);
  }

  const capabilities = (info && info.capabilities) || adapter.capabilities || null;
  checks.push({ name: "adapter capabilities", ok: Boolean(capabilities), capabilities, errors: capabilities ? [] : ["adapter did not report capabilities"] });

  const adapterIsRest = (adapter.name || adapterName) === "rest" || adapterName === "http";
  const tokenConfigured = Boolean(process.env.SALTCORN_PROJECT_SYNC_API_TOKEN);
  checks.push({
    name: "token/auth configuration",
    ok: !adapterIsRest || tokenConfigured,
    warnings: adapterIsRest && !tokenConfigured ? ["SALTCORN_PROJECT_SYNC_API_TOKEN is not configured; endpoint must allow unauthenticated access"] : [],
  });

  await runOptionalSequenceCheck(checks);
  return { ok: checks.every((check) => check.ok), adapter: adapter.name || adapterName, info, saltcorn, plugins, checks };
}

async function commandDoctorLive() {
  const result = await runLiveChecks(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  process.stdout.write(canonicalStringify(result));
  if (!result.ok) process.exit(4);
}

function commandDoctor() {
  const checks = [];
  const validation = (() => {
    try {
      return validateProject(process.cwd(), loadManifest(), loadChangeIntents());
    } catch (err) {
      return { valid: false, errors: [err.message], warnings: [] };
    }
  })();
  checks.push({ name: "project validation", ok: validation.valid, errors: validation.errors, warnings: validation.warnings });
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    checks.push({ name: "git repository", ok: true });
  } catch (err) {
    checks.push({ name: "git repository", ok: false, errors: ["not inside a Git repository"] });
  }
  try {
    const status = execFileSync("git", ["status", "--short"], { encoding: "utf8" });
    checks.push({ name: "git clean", ok: status.trim().length === 0, warnings: status.trim() ? ["working tree has changes"] : [] });
  } catch (_err) {
    // already reported above
  }
  process.stdout.write(canonicalStringify({ ok: checks.every((check) => check.ok), checks }));
}

function isVerifiableBackupMetadata(result) {
  if (!result || result.ok === false || result.skipped) return false;
  return Boolean(
    result.id ||
      result.backup_id ||
      result.snapshot_id ||
      result.path ||
      result.file ||
      result.artifact ||
      result.created_at ||
      result.completed_at ||
      result.metadata
  );
}

function commandCheckSequences() {
  const result = checkSequences({ tableLike: arg("--table-like", process.env.SALTCORN_PROJECT_SYNC_SEQUENCE_TABLE_LIKE || "\\_sc\\_%") });
  process.stdout.write(canonicalStringify(result));
  if (!result.ok) process.exit(7);
}

function commandFixSequences() {
  const result = fixSequences({ tableLike: arg("--table-like", process.env.SALTCORN_PROJECT_SYNC_SEQUENCE_TABLE_LIKE || "\\_sc\\_%") });
  process.stdout.write(canonicalStringify(result));
}

function commandGitStatus() {
  const out = execFileSync("git", ["status", "--short"], { encoding: "utf8" });
  process.stdout.write(out || "clean\n");
}

function commandGitCommit() {
  const message = arg("-m") || arg("--message");
  if (!message) throw new Error("-m MESSAGE is required");
  execFileSync("git", ["add", "saltcorn.project.json", "plugins.lock.json", "objects", "changes", "environments", "docs", "README.md"], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", message], { stdio: "inherit" });
}

function commandGitPull() {
  execFileSync("git", ["pull", "--ff-only"], { stdio: "inherit" });
}

function commandGitPush() {
  execFileSync("git", ["push"], { stdio: "inherit" });
}

async function commandExportLive() {
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const exported = normalizePack(await adapter.exportProject());
  const outDir = path.resolve(arg("--out", process.cwd()));
  ensureProjectDirs(outDir);
  const written = writeProjectExport(outDir, exported);
  console.log(`Exported ${written.length} files`);
  for (const file of written) console.log(path.relative(outDir, file));
}

async function commandRestoreLive() {
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const record = findDeploymentRecord(process.cwd(), arg("--deployment", "last"));
  if (!record) throw new Error("deployment record not found");
  const backup = record.backup || record.backup_result || record.backup_metadata;
  if (!backup) throw new Error(`deployment ${record.id} has no backup metadata`);
  if (!adapter.restore) throw new Error(`adapter ${adapter.name || "<unknown>"} does not support restore`);
  const result = await adapter.restore(backup);
  appendRollbackRecord(process.cwd(), {
    env: record.env,
    status: "restored-live",
    rollback_of: record.id,
    restored_from: record.id,
    commit: currentGitCommit(),
    restore_result: result,
  });
  process.stdout.write(canonicalStringify({ restored_from: record.id, result }));
}

async function commandApplyLive() {
  const adapterName = arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command");
  const adapter = getTenantAdapter(adapterName);
  const env = arg("--env", "dev");
  const desired = loadProjectState();
  const actual = normalizeProjectExport(await adapter.exportProject());
  const intents = loadChangeIntents();
  let backup = has("--backup");
  let backupResult = null;
  if (backup || env === "prod" || env === "test") {
    backupResult = await adapter.backup();
    backup = isVerifiableBackupMetadata(backupResult);
    if ((env === "prod" || env === "test") && !backup) {
      process.stdout.write(canonicalStringify({
        applied: false,
        errors: ["verifiable backup metadata is required for test/prod apply"],
        backup_result: backupResult,
      }));
      process.exit(3);
    }
  }
  const result = applyProject({ desired, actual, intents, env, backup, force: has("--force") });
  if (!result.applied) {
    process.stdout.write(canonicalStringify(result));
    process.exit(3);
  }
  const adapterResult = adapter.applyPlan
    ? await adapter.applyPlan({
        desired,
        actual,
        plan: result.plan,
        state: result.state,
        env,
        backup,
        allow_destructive: has("--allow-destructive"),
      })
    : await adapter.applyProject(result.state);
  if (adapterResult && adapterResult.ok === false) {
    process.stdout.write(canonicalStringify({ ...result, adapter_result: adapterResult }));
    process.exit(6);
  }
  appendDeploymentRecord(process.cwd(), {
    env,
    status: "applied-live",
    commit: currentGitCommit(),
    backup: backupResult,
    adapter_result: adapterResult,
    operations: result.plan.operations.length,
    warnings: result.plan.warnings.length,
  });
  // After a successful REST apply, trigger state refresh on all Saltcorn workers
  // so that views/pages render correctly without requiring a server restart.
  if (adapterName === "rest") {
    try {
      const baseUrl = process.env.SALTCORN_PROJECT_SYNC_BASE_URL || "";
      const token = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN || "";
      const resp = await fetch(`${baseUrl}/project-sync/api/refresh-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      });
      const refreshResult = await resp.json();
      if (refreshResult.refreshed) adapterResult._state_refreshed = refreshResult.refreshed;
    } catch (_e) { /* non-critical */ }
  }
  process.stdout.write(canonicalStringify({ ...result, adapter_result: adapterResult }));
}

function commandListSeeds() {
  const seeds = loadSeedFiles();
  if (!seeds.length) { console.log("No seed files found"); return; }
  for (const s of seeds) console.log(`${s.valid ? "✅" : "❌"} ${s.file} (${s.seed ? s.seed.name : "?"}, ${s.seed ? (s.seed.tables || []).length : 0} tables)`);
}

function commandListMigrations() {
  const migrations = loadMigrationFiles();
  if (!migrations.length) { console.log("No migration files found"); return; }
  for (const m of migrations) console.log(`${m.valid ? "✅" : "❌"} ${m.file} (${m.migration ? m.migration.name : "?"}, ${m.migration ? (m.migration.steps || []).length : 0} steps)`);
}

async function commandApplySeeds() {
  const adapterName = arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command");
  const env = arg("--env", "dev");
  const seeds = loadSeedFiles();
  const invalid = seeds.filter((s) => !s.valid);
  if (invalid.length) {
    for (const s of invalid) for (const e of s.errors) console.error(e);
    process.exit(1);
  }
  if (!seeds.length) { console.log("No seed files to apply"); return; }
  const plan = planSeeds(seeds.map((s) => ({ seed: s.seed, file: s.file })));
  if (!plan.operations.length) { console.log("Seed plan is empty"); return; }

  const hasDestructive = plan.operations.some((op) => op.destructive);
  if (hasDestructive && !has("--allow-destructive")) {
    const tables = [...new Set(plan.operations.filter((op) => op.destructive).map((op) => op.table))];
    process.stdout.write(canonicalStringify({
      ok: false,
      error: "seed plan contains destructive operations (truncate/replace)",
      destructive_tables: tables,
      hint: "add --allow-destructive to confirm",
    }));
    process.exit(3);
  }

  const adapter = getTenantAdapter(adapterName);
  const adapterResult = adapter.applyPlan ? await adapter.applyPlan({ desired: {}, plan }) : { ok: false, error: "adapter does not support applyPlan" };
  process.stdout.write(canonicalStringify({ ok: adapterResult.ok !== false, operations: plan.operations.length, warnings: plan.warnings, adapter_result: adapterResult }));
  if (adapterResult.ok === false) process.exit(6);
}

async function commandApplyMigrations() {
  const adapterName = arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command");
  const env = arg("--env", "dev");
  const migrations = loadMigrationFiles();
  const invalid = migrations.filter((m) => !m.valid);
  if (invalid.length) {
    for (const m of invalid) for (const e of m.errors) console.error(e);
    process.exit(1);
  }
  if (!migrations.length) { console.log("No migration files to apply"); return; }
  const plan = planMigrations(migrations.map((m) => ({ migration: m.migration, file: m.file })));
  if (!plan.operations.length) { console.log("Migration plan is empty"); return; }
  const adapter = getTenantAdapter(adapterName);
  const adapterResult = adapter.applyPlan ? await adapter.applyPlan({ desired: {}, plan }) : { ok: false, error: "adapter does not support applyPlan" };
  process.stdout.write(canonicalStringify({ ok: adapterResult.ok !== false, operations: plan.operations.length, warnings: plan.warnings, adapter_result: adapterResult }));
  if (adapterResult.ok === false) process.exit(6);
}

function commandAddSeed() {
  const name = arg("--name");
  if (!name) throw new Error("--name NAME is required");
  const order = arg("--order", "0");
  const seed = { name, mode: "upsert", tables: [], _order: Number(order) };
  const file = writeSeedFile(process.cwd(), seed);
  console.log(path.relative(process.cwd(), file));
}

function commandAddMigration() {
  const name = arg("--name");
  if (!name) throw new Error("--name NAME is required");
  const order = arg("--order", "0");
  const migration = { name, steps: [], _order: Number(order) };
  const file = writeMigrationFile(process.cwd(), migration);
  console.log(path.relative(process.cwd(), file));
}

async function commandReset() {
  const adapterName = arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command");
  const env = arg("--env", "dev");
  const destructive = has("--yes-reset-everything");
  if (!destructive) throw new Error("reset requires --yes-reset-everything to confirm destructive intent. This will erase all tenant data and recreate from project files.");

  const adapter = getTenantAdapter(adapterName);
  const phases = [];

  // Phase 1: Reset schema
  try {
    const resetResult = await adapter.resetSchema();
    phases.push({ phase: "reset-schema", ok: resetResult.ok !== false, result: resetResult });
  } catch (err) {
    phases.push({ phase: "reset-schema", ok: false, error: err.message });
    process.stdout.write(canonicalStringify({ ok: false, phases }));
    process.exit(6);
  }

  // Phase 2: Install plugins from plugins.lock.json
  const pluginsLock = readJsonIfExists(path.join(process.cwd(), "plugins.lock.json"), null);
  if (pluginsLock && Array.isArray(pluginsLock.plugins)) {
    for (const plugin of pluginsLock.plugins) {
      if (plugin.source === "unknown" || plugin.source === "bundled") continue;
      try {
        const installResult = adapter.installPlugin ? await adapter.installPlugin(plugin) : { ok: true, skipped: true };
        phases.push({ phase: "install-plugin", plugin: plugin.name, ok: installResult.ok !== false, result: installResult });
      } catch (err) {
        phases.push({ phase: "install-plugin", plugin: plugin.name, ok: false, error: err.message });
      }
    }
  }

  // Phase 3: Apply project (tables, views, pages, triggers, roles, settings, menu)
  const desired = loadProjectState();
  const emptyActual = normalizeProjectExport({});
  const intents = loadChangeIntents();
  const applyResult = applyProject({ desired, actual: emptyActual, intents, env, backup: false, force: false });
  if (!applyResult.applied) {
    phases.push({ phase: "apply-project", ok: false, errors: applyResult.errors });
    process.stdout.write(canonicalStringify({ ok: false, phases }));
    process.exit(6);
  }

  let adapterApplyResult = null;
  try {
    adapterApplyResult = adapter.applyPlan
      ? await adapter.applyPlan({ desired, actual: emptyActual, plan: applyResult.plan, state: applyResult.state, env, backup: false, allow_destructive: true })
      : await adapter.applyProject(applyResult.state);
    phases.push({ phase: "apply-project", ok: adapterApplyResult && adapterApplyResult.ok !== false, operations: applyResult.plan.operations.length });
  } catch (err) {
    phases.push({ phase: "apply-project", ok: false, error: err.message });
    process.stdout.write(canonicalStringify({ ok: false, phases, adapter_result: adapterApplyResult }));
    process.exit(6);
  }

  // Phase 4: Apply seeds
  const seedFiles = loadSeedFiles();
  if (seedFiles.length) {
    const invalidSeeds = seedFiles.filter((s) => !s.valid);
    if (invalidSeeds.length) {
      phases.push({ phase: "seeds", ok: false, error: `${invalidSeeds.length} invalid seed file(s)` });
    } else {
      const seedPlan = planSeeds(seedFiles.map((s) => ({ seed: s.seed, file: s.file })));
      if (seedPlan.operations.length) {
        try {
          const seedResult = adapter.applyPlan ? await adapter.applyPlan({ desired: {}, plan: seedPlan }) : { ok: false, error: "adapter does not support applyPlan" };
          phases.push({ phase: "seeds", ok: seedResult.ok !== false, operations: seedPlan.operations.length, result: seedResult });
        } catch (err) {
          phases.push({ phase: "seeds", ok: false, error: err.message });
        }
      } else {
        phases.push({ phase: "seeds", ok: true, operations: 0 });
      }
    }
  } else {
    phases.push({ phase: "seeds", ok: true, operations: 0, note: "no seed files" });
  }

  // Phase 5: Apply migrations
  const migrationFiles = loadMigrationFiles();
  if (migrationFiles.length) {
    const invalidMigrations = migrationFiles.filter((m) => !m.valid);
    if (invalidMigrations.length) {
      phases.push({ phase: "migrations", ok: false, error: `${invalidMigrations.length} invalid migration file(s)` });
    } else {
      const migPlan = planMigrations(migrationFiles.map((m) => ({ migration: m.migration, file: m.file })));
      if (migPlan.operations.length) {
        try {
          const migResult = adapter.applyPlan ? await adapter.applyPlan({ desired: {}, plan: migPlan }) : { ok: false, error: "adapter does not support applyPlan" };
          phases.push({ phase: "migrations", ok: migResult.ok !== false, operations: migPlan.operations.length, warnings: migPlan.warnings.length, result: migResult });
        } catch (err) {
          phases.push({ phase: "migrations", ok: false, error: err.message });
        }
      } else {
        phases.push({ phase: "migrations", ok: true, operations: 0 });
      }
    }
  } else {
    phases.push({ phase: "migrations", ok: true, operations: 0, note: "no migration files" });
  }

  // Record deployment
  const allOk = phases.every((p) => p.ok !== false);
  appendDeploymentRecord(process.cwd(), {
    env,
    status: allOk ? "reset-complete" : "reset-partial",
    commit: currentGitCommit(),
    phases: phases.map((p) => ({ phase: p.phase, ok: p.ok })),
    operations: applyResult.plan.operations.length,
  });

  process.stdout.write(canonicalStringify({ ok: allOk, phases, adapter_result: adapterApplyResult }));
  if (!allOk) process.exit(6);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || has("--help") || has("-h")) usage();
  else if (cmd === "init") commandInit();
  else if (cmd === "validate") commandValidate();
  else if (cmd === "deps") commandDeps();
  else if (cmd === "import-pack") commandImportPack();
  else if (cmd === "import-reference") commandImportReference();
  else if (cmd === "diff") commandDiff();
  else if (cmd === "plan") commandPlan();
  else if (cmd === "report") commandReport();
  else if (cmd === "preflight") commandPreflight();
  else if (cmd === "apply-file") commandApplyFile();
  else if (cmd === "backup") commandBackup();
  else if (cmd === "record-deployment") commandRecordDeployment();
  else if (cmd === "doctor") commandDoctor();
  else if (cmd === "doctor-live") await commandDoctorLive();
  else if (cmd === "check-live") await commandCheckLive();
  else if (cmd === "check-sequences") commandCheckSequences();
  else if (cmd === "fix-sequences") commandFixSequences();
  else if (cmd === "git-status") commandGitStatus();
  else if (cmd === "git-commit") commandGitCommit();
  else if (cmd === "git-pull") commandGitPull();
  else if (cmd === "git-push") commandGitPush();
  else if (cmd === "export") await commandExportLive();
  else if (cmd === "apply") await commandApplyLive();
  else if (cmd === "restore") await commandRestoreLive();
  else if (cmd === "list-seeds") commandListSeeds();
  else if (cmd === "list-migrations") commandListMigrations();
  else if (cmd === "apply-seeds") await commandApplySeeds();
  else if (cmd === "apply-migrations") await commandApplyMigrations();
  else if (cmd === "add-seed") commandAddSeed();
  else if (cmd === "add-migration") commandAddMigration();
  else if (cmd === "reset") await commandReset();
  else {
    usage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
