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
const { appendDeploymentRecord, findDeploymentRecord } = require("../lib/deployments");
const { getTenantAdapter } = require("../lib/tenant-adapters");
const { analyzeDependencies } = require("../lib/dependencies");
const { writeReferenceTable } = require("../lib/reference-data");
const { validateProject } = require("../lib/validator");
const { checkPluginCompatibility, checkSaltcornCompatibility } = require("../lib/compatibility");

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
  saltcorn-project-sync check-live [--adapter command|native]
  saltcorn-project-sync git-status
  saltcorn-project-sync git-commit -m MESSAGE
  saltcorn-project-sync git-pull
  saltcorn-project-sync git-push
  saltcorn-project-sync export [--adapter command|rest|native] --out DIR
  saltcorn-project-sync apply [--adapter command|rest|native] [--env ENV] [--allow-destructive]
  saltcorn-project-sync restore [--adapter command|rest|native] [--deployment ID|last]

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
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const manifest = loadManifest();
  const pluginLock = readJsonIfExists(path.join(process.cwd(), "plugins.lock.json"), { plugins: [] });
  const info = adapter.info ? await adapter.info() : { adapter: adapter.name || "unknown" };
  const exported = normalizeProjectExport(await adapter.exportProject());
  const saltcorn = checkSaltcornCompatibility(manifest, info.saltcorn_version);
  const plugins = checkPluginCompatibility(pluginLock.plugins || [], exported.plugins || []);
  const result = { ok: saltcorn.ok && plugins.ok, info, saltcorn, plugins };
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
  appendDeploymentRecord(process.cwd(), {
    env: record.env,
    status: "restored-live",
    restored_from: record.id,
    commit: currentGitCommit(),
    restore_result: result,
  });
  process.stdout.write(canonicalStringify({ restored_from: record.id, result }));
}

async function commandApplyLive() {
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const env = arg("--env", "dev");
  const desired = loadProjectState();
  const actual = normalizeProjectExport(await adapter.exportProject());
  const intents = loadChangeIntents();
  let backup = has("--backup");
  let backupResult = null;
  if (backup || env === "prod" || env === "test") {
    backupResult = await adapter.backup();
    backup = true;
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
  appendDeploymentRecord(process.cwd(), {
    env,
    status: "applied-live",
    commit: currentGitCommit(),
    backup: backupResult,
    adapter_result: adapterResult,
    operations: result.plan.operations.length,
    warnings: result.plan.warnings.length,
  });
  process.stdout.write(canonicalStringify({ ...result, adapter_result: adapterResult }));
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
  else if (cmd === "check-live") await commandCheckLive();
  else if (cmd === "git-status") commandGitStatus();
  else if (cmd === "git-commit") commandGitCommit();
  else if (cmd === "git-pull") commandGitPull();
  else if (cmd === "git-push") commandGitPush();
  else if (cmd === "export") await commandExportLive();
  else if (cmd === "apply") await commandApplyLive();
  else if (cmd === "restore") await commandRestoreLive();
  else {
    usage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
