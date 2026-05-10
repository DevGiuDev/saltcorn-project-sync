#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { canonicalStringify, parseJson } = require("../lib/canonical-json");
const { defaultManifest, MANIFEST_FILE, loadManifest, validateManifest } = require("../lib/manifest");
const { ensureProjectDirs, writeCanonicalJson, readJsonIfExists } = require("../lib/project-io");
const { loadChangeIntents, validateChangeIntent } = require("../lib/change-intents");
const { planProject } = require("../lib/planner");
const { VERSIONED_KINDS, normalizePack, normalizeProjectExport } = require("../lib/normalizer");
const { loadProjectState } = require("../lib/project-state");
const { applyProject } = require("../lib/apply-engine");
const { writeProjectExport } = require("../lib/export-writer");
const { createBackupRecord, currentGitCommit } = require("../lib/backup");
const { appendDeploymentRecord } = require("../lib/deployments");
const { getTenantAdapter } = require("../lib/tenant-adapters");
const { analyzeDependencies } = require("../lib/dependencies");

function usage() {
  console.log(`Saltcorn Project Sync

Usage:
  saltcorn-project-sync init [--name NAME] [--slug SLUG] [--git]
  saltcorn-project-sync validate
  saltcorn-project-sync deps
  saltcorn-project-sync import-pack --pack FILE
  saltcorn-project-sync diff --tenant-export FILE
  saltcorn-project-sync plan [--env ENV] [--backup] --tenant-export FILE
  saltcorn-project-sync apply-file [--env ENV] [--backup] --tenant-export FILE --out FILE
  saltcorn-project-sync backup [--env ENV] [--source FILE]
  saltcorn-project-sync record-deployment --env ENV --status STATUS
  saltcorn-project-sync git-status
  saltcorn-project-sync git-commit -m MESSAGE
  saltcorn-project-sync git-pull
  saltcorn-project-sync git-push
  saltcorn-project-sync export --out DIR
  saltcorn-project-sync apply [--env ENV]

Direct export/apply against a live Saltcorn tenant is still adapter-backed work in progress.
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
  const manifest = loadManifest();
  const manifestResult = validateManifest(manifest);
  const intents = loadChangeIntents();
  const intentErrors = intents.flatMap((intent) => {
    const res = validateChangeIntent(intent);
    return res.valid ? [] : res.errors.map((error) => `${intent.id || "<unknown>"}: ${error}`);
  });
  const depResult = fs.existsSync(path.join(process.cwd(), "objects")) ? analyzeDependencies(loadProjectState()) : { missing: [] };
  const depErrors = depResult.missing.map((dep) => `${dep.from.kind}/${dep.from.name} missing dependency ${dep.missing.kind}/${dep.missing.name}`);
  const errors = [...manifestResult.errors, ...intentErrors, ...depErrors];
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("Project is valid");
}

function loadDesiredAndActual() {
  const desired = loadProjectState();
  const tenantFile = arg("--tenant-export");
  if (!tenantFile) throw new Error("--tenant-export FILE is required");
  const actualRaw = readJsonIfExists(path.resolve(tenantFile));
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

function commandExportLive() {
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const exported = normalizePack(adapter.exportProject());
  const outDir = path.resolve(arg("--out", process.cwd()));
  ensureProjectDirs(outDir);
  const written = writeProjectExport(outDir, exported);
  console.log(`Exported ${written.length} files`);
  for (const file of written) console.log(path.relative(outDir, file));
}

function commandApplyLive() {
  const adapter = getTenantAdapter(arg("--adapter", process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "command"));
  const env = arg("--env", "dev");
  const desired = loadProjectState();
  const actual = normalizeProjectExport(adapter.exportProject());
  const intents = loadChangeIntents();
  let backup = has("--backup");
  let backupResult = null;
  if (backup || env === "prod" || env === "test") {
    backupResult = adapter.backup();
    backup = true;
  }
  const result = applyProject({ desired, actual, intents, env, backup, force: has("--force") });
  if (!result.applied) {
    process.stdout.write(canonicalStringify(result));
    process.exit(3);
  }
  const adapterResult = adapter.applyProject(result.state);
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

try {
  const cmd = process.argv[2];
  if (!cmd || has("--help") || has("-h")) usage();
  else if (cmd === "init") commandInit();
  else if (cmd === "validate") commandValidate();
  else if (cmd === "deps") commandDeps();
  else if (cmd === "import-pack") commandImportPack();
  else if (cmd === "diff") commandDiff();
  else if (cmd === "plan") commandPlan();
  else if (cmd === "apply-file") commandApplyFile();
  else if (cmd === "backup") commandBackup();
  else if (cmd === "record-deployment") commandRecordDeployment();
  else if (cmd === "git-status") commandGitStatus();
  else if (cmd === "git-commit") commandGitCommit();
  else if (cmd === "git-pull") commandGitPull();
  else if (cmd === "git-push") commandGitPush();
  else if (cmd === "export") commandExportLive();
  else if (cmd === "apply") commandApplyLive();
  else {
    usage();
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
