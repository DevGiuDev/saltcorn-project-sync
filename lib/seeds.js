const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists, writeCanonicalJson, safeFileName, ensureProjectDirs } = require("./project-io");

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
    for (const step of migration.steps) {
      if (step.action === "ensure_table") {
        operations.push({ action: "create_table", table: step.table, safe: true, source: migration.name });
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
        });
      } else if (step.action === "ensure_view" || step.action === "ensure_page" || step.action === "ensure_trigger" || step.action === "ensure_role") {
        const kind = step.action.replace("ensure_", "") + "s";
        operations.push({
          action: `create_${step.action.replace("ensure_", "")}`,
          [step.action.replace("ensure_", "")]: step.name,
          safe: true,
          source: migration.name,
        });
      } else if (step.action === "raw_sql") {
        operations.push({ action: "raw_sql", sql: step.sql, safe: false, source: migration.name });
        warnings.push({ type: "raw_sql", migration: migration.name, message: "raw_sql steps are not portable across databases" });
      } else if (step.action === "raw_command") {
        operations.push({ action: "raw_command", command: step.command, safe: false, source: migration.name });
        warnings.push({ type: "raw_command", migration: migration.name, message: "raw_command steps execute arbitrary shell commands" });
      }
    }
  }
  return { operations, warnings };
}

function writeSeedFile(projectDir, seed) {
  ensureProjectDirs(projectDir);
  const dir = seedsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = String(seed._order || 0).padStart(3, "0");
  const file = path.join(dir, `${prefix}-${safeFileName(seed.name)}.json`);
  const data = { name: seed.name, mode: seed.mode || "upsert", tables: seed.tables };
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
  writeSeedFile,
  writeMigrationFile,
};
