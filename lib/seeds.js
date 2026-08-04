const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readJsonIfExists, writeCanonicalJson, safeFileName, ensureProjectDirs } = require("./project-io");
const { canonicalStringify } = require("./canonical-json");

const PHASES = ["pre-deploy", "post-deploy", "manual"];
const RUN_MODES = ["once", "always"];
const DEFAULT_MIGRATION_RUN = "once";
const DEFAULT_SEED_RUN = "always";
const DEFAULT_PHASE = "manual";

/**
 * Seeds directory layout:
 *
 *   seeds/
 *     001-core-countries.json
 *     002-demo-data.json
 *
 * Each seed file:
 *
 *   {
 *     "name": "core-countries",
 *     "mode": "upsert",
 *     "tables": [
 *       {
 *         "table": "countries",
 *         "key": "code",
 *         "rows": [ { "code": "ES", "name": "Spain" } ]
 *       }
 *     ]
 *   }
 *
 * Migrations directory layout:
 *
 *   migrations/
 *     001-add-status-field.json
 *
 * Each migration file:
 *
 *   {
 *     "name": "add-status-field",
 *     "steps": [
 *       { "action": "ensure_table", "table": "invoices" },
 *       { "action": "ensure_field", "table": "invoices", "field": "status", "type": "String", "default": "pending" }
 *     ]
 *   }
 */

const SEEDS_DIR = "seeds";
const MIGRATIONS_DIR = "migrations";

function seedsDir(projectDir = process.cwd()) {
  return path.join(projectDir, SEEDS_DIR);
}

function migrationsDir(projectDir = process.cwd()) {
  return path.join(projectDir, MIGRATIONS_DIR);
}

function validateSeedFile(seed, filePath) {
  const errors = [];
  if (!seed || typeof seed !== "object") {
    errors.push(`${filePath}: seed must be a JSON object`);
    return errors;
  }
  if (!seed.name) errors.push(`${filePath}: seed requires a "name" field`);
  if (!Array.isArray(seed.tables)) {
    errors.push(`${filePath}: seed requires a "tables" array`);
    return errors;
  }
  for (let i = 0; i < seed.tables.length; i++) {
    const entry = seed.tables[i];
    if (!entry.table) errors.push(`${filePath}: tables[${i}] missing "table"`);
    if (!Array.isArray(entry.rows)) errors.push(`${filePath}: tables[${i}] missing "rows" array`);
    if (!entry.key) errors.push(`${filePath}: tables[${i}] missing "key" (unique key column name)`);
  }
  const mode = seed.mode || "upsert";
  if (!["upsert", "replace", "truncate"].includes(mode)) errors.push(`${filePath}: mode must be "upsert", "replace", or "truncate", got "${mode}"`);
  if (seed.phase !== undefined && !PHASES.includes(seed.phase)) errors.push(`${filePath}: phase must be one of ${PHASES.map((p) => `"${p}"`).join(", ")}, got "${seed.phase}"`);
  if (seed.run !== undefined && !RUN_MODES.includes(seed.run)) errors.push(`${filePath}: run must be "once" or "always", got "${seed.run}"`);
  return errors;
}

function validateMigrationFile(migration, filePath) {
  const errors = [];
  if (!migration || typeof migration !== "object") {
    errors.push(`${filePath}: migration must be a JSON object`);
    return errors;
  }
  if (!migration.name) errors.push(`${filePath}: migration requires a "name" field`);
  if (!Array.isArray(migration.steps)) {
    errors.push(`${filePath}: migration requires a "steps" array`);
    return errors;
  }
  const validActions = ["ensure_table", "ensure_field", "ensure_view", "ensure_page", "ensure_trigger", "ensure_role", "raw_sql", "raw_command"];
  for (let i = 0; i < migration.steps.length; i++) {
    const step = migration.steps[i];
    if (!step.action) errors.push(`${filePath}: steps[${i}] missing "action"`);
    else if (!validActions.includes(step.action)) errors.push(`${filePath}: steps[${i}] unknown action "${step.action}"`);
  }
  if (migration.phase !== undefined && !PHASES.includes(migration.phase)) errors.push(`${filePath}: phase must be one of ${PHASES.map((p) => `"${p}"`).join(", ")}, got "${migration.phase}"`);
  if (migration.run !== undefined && !RUN_MODES.includes(migration.run)) errors.push(`${filePath}: run must be "once" or "always", got "${migration.run}"`);
  return errors;
}

function loadSeedFiles(projectDir = process.cwd()) {
  const dir = seedsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const filePath = path.join(dir, file);
      const seed = readJsonIfExists(filePath);
      const errors = validateSeedFile(seed, filePath);
      return { file, filePath, seed, errors, valid: errors.length === 0 };
    });
}

function loadMigrationFiles(projectDir = process.cwd()) {
  const dir = migrationsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const filePath = path.join(dir, file);
      const migration = readJsonIfExists(filePath);
      const errors = validateMigrationFile(migration, filePath);
      return { file, filePath, migration, errors, valid: errors.length === 0 };
    });
}

function validateSeeds(projectDir = process.cwd()) {
  const seedResults = loadSeedFiles(projectDir);
  const migrationResults = loadMigrationFiles(projectDir);
  const errors = [
    ...seedResults.flatMap((r) => r.errors),
    ...migrationResults.flatMap((r) => r.errors),
  ];
  const warnings = [];
  if (seedResults.length === 0 && migrationResults.length === 0) {
    warnings.push("No seed or migration files found");
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    seeds: seedResults.map((r) => ({ file: r.file, valid: r.valid })),
    migrations: migrationResults.map((r) => ({ file: r.file, valid: r.valid })),
  };
}

/**
 * Build plan operations from seed files.
 * Seeds produce upsert_reference_row / truncate_table / seed_row operations
 * that the adapter executes against the Saltcorn tenant.
 *
 * Modes:
 *   - "upsert"   : insert or update each row by key (safe)
 *   - "replace"  : truncate table first, then insert rows (destructive)
 *   - "truncate" : delete all rows only, no inserts (destructive)
 */
function planSeeds(seeds = []) {
  const operations = [];
  const warnings = [];
  for (const { seed, file } of seeds) {
    if (!seed || !seed.tables) continue;
    const mode = seed.mode || "upsert";
    const phase = seed.phase || DEFAULT_PHASE;
    const run = seed.run || DEFAULT_SEED_RUN;
    for (const entry of seed.tables) {
      // Destructive modes: truncate first
      if (mode === "replace" || mode === "truncate") {
        operations.push({
          action: "truncate_table",
          seed: seed.name,
          table: entry.table,
          mode,
          safe: false,
          destructive: true,
          phase,
          run,
          source: seed.name,
        });
        warnings.push({ type: "destructive_seed", seed: seed.name, table: entry.table, mode, message: `seed "${seed.name}" will truncate table "${entry.table}" (mode: ${mode})` });
      }

      // truncate mode: no rows to insert
      if (mode === "truncate") continue;

      for (const row of entry.rows || []) {
        operations.push({
          action: "seed_row",
          seed: seed.name,
          table: entry.table,
          key: entry.key || "id",
          mode,
          row,
          safe: mode === "upsert",
          phase,
          run,
          source: seed.name,
        });
      }
    }
  }
  return { operations, warnings };
}

/**
 * Build plan operations from migration files.
 * Each step maps to an adapter action.
 */
function planMigrations(migrations = []) {
  const operations = [];
  const warnings = [];
  for (const { migration, file } of migrations) {
    if (!migration || !migration.steps) continue;
    const phase = migration.phase || DEFAULT_PHASE;
    const run = migration.run || DEFAULT_MIGRATION_RUN;
    for (const step of migration.steps) {
      if (step.action === "ensure_table") {
        operations.push({ action: "create_table", table: step.table, safe: true, source: migration.name, phase, run, migration_name: migration.name });
      } else if (step.action === "ensure_field") {
        operations.push({
          action: "ensure_field",
          table: step.table,
          field: step.field,
          type: step.type || "String",
          default: step.default,
          required: step.required || false,
          safe: true,
          source: migration.name,
          phase,
          run,
          migration_name: migration.name,
        });
      } else if (step.action === "ensure_view" || step.action === "ensure_page" || step.action === "ensure_trigger" || step.action === "ensure_role") {
        const kind = step.action.replace("ensure_", "") + "s";
        operations.push({
          action: `create_${step.action.replace("ensure_", "")}`,
          [step.action.replace("ensure_", "")]: step.name,
          safe: true,
          source: migration.name,
          phase,
          run,
          migration_name: migration.name,
        });
      } else if (step.action === "raw_sql") {
        operations.push({ action: "raw_sql", sql: step.sql, safe: false, source: migration.name, phase, run, migration_name: migration.name });
        warnings.push({ type: "raw_sql", migration: migration.name, message: "raw_sql steps are not portable across databases" });
      } else if (step.action === "raw_command") {
        operations.push({ action: "raw_command", command: step.command, safe: false, source: migration.name, phase, run, migration_name: migration.name });
        warnings.push({ type: "raw_command", migration: migration.name, message: "raw_command steps execute arbitrary shell commands" });
      }
    }
  }
  return { operations, warnings };
}

/**
 * Split a flat operations array into deployment phases.
 * Operations without a phase (or phase "manual") are only run via the
 * explicit apply-seeds / apply-migrations CLI commands and never during a
 * deploy.
 */
function partitionByPhase(operations = []) {
  const preDeploy = [];
  const postDeploy = [];
  const manual = [];
  for (const op of operations || []) {
    const phase = op.phase || DEFAULT_PHASE;
    if (phase === "pre-deploy") preDeploy.push(op);
    else if (phase === "post-deploy") postDeploy.push(op);
    else manual.push(op);
  }
  return { preDeploy, postDeploy, manual };
}

/**
 * Compute a deterministic identity hash for a migration.
 * The hash covers name + steps only, so cosmetic edits (comments, phase
 * changes, ordering tweaks in unrelated fields) do NOT invalidate a
 * previously applied migration recorded in the ledger. A migration that
 * changes its actual effect must change its name or its steps.
 */
function migrationIdentity(migration = {}) {
  const identity = {
    name: migration.name,
    steps: Array.isArray(migration.steps) ? migration.steps : [],
  };
  return crypto.createHash("sha256").update(canonicalStringify(identity)).digest("hex");
}

function writeSeedFile(projectDir, seed) {
  ensureProjectDirs(projectDir);
  const dir = seedsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = String(seed._order || 0).padStart(3, "0");
  const file = path.join(dir, `${prefix}-${safeFileName(seed.name)}.json`);
  const data = { name: seed.name, mode: seed.mode || "upsert", tables: seed.tables };
  if (seed.phase !== undefined) data.phase = seed.phase;
  if (seed.run !== undefined) data.run = seed.run;
  writeCanonicalJson(file, data);
  return file;
}

function writeMigrationFile(projectDir, migration) {
  ensureProjectDirs(projectDir);
  const dir = migrationsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = String(migration._order || 0).padStart(3, "0");
  const file = path.join(dir, `${prefix}-${safeFileName(migration.name)}.json`);
  const data = { name: migration.name, steps: migration.steps };
  if (migration.phase !== undefined) data.phase = migration.phase;
  if (migration.run !== undefined) data.run = migration.run;
  writeCanonicalJson(file, data);
  return file;
}

module.exports = {
  seedsDir,
  migrationsDir,
  validateSeedFile,
  validateMigrationFile,
  loadSeedFiles,
  loadMigrationFiles,
  validateSeeds,
  planSeeds,
  planMigrations,
  partitionByPhase,
  migrationIdentity,
  writeSeedFile,
  writeMigrationFile,
  PHASES,
  RUN_MODES,
  DEFAULT_PHASE,
  DEFAULT_MIGRATION_RUN,
  DEFAULT_SEED_RUN,
};
