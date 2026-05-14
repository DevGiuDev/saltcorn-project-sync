#!/usr/bin/env node

/**
 * Install the clone_schema PL/pgSQL function into the Saltcorn database.
 *
 * Uses the pg-clone-schema project by Denish Patel:
 * https://github.com/denishpatel/pg-clone-schema
 *
 * Usage:
 *   node scripts/install-clone-schema.js
 *
 * Reads DB connection from Saltcorn config (~/.config/.saltcorn)
 * or from SALTCORN_PROJECT_SYNC_DB_* environment variables.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SQL_FILE = path.join(__dirname, "..", "vendor", "clone_schema.sql");

function getConfig() {
  // Try Saltcorn config file
  const configPaths = [
    path.join(process.env.XDG_CONFIG_HOME || path.join(require("os").homedir(), ".config"), ".saltcorn"),
    path.join(require("os").homedir(), ".saltcorn"),
  ];

  for (const p of configPaths) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch { /* next */ }
  }
  return null;
}

function main() {
  if (!fs.existsSync(SQL_FILE)) {
    console.error(`Error: ${SQL_FILE} not found.`);
    console.error("Clone the pg-clone-schema SQL file into vendor/clone_schema.sql");
    console.error("  mkdir -p vendor && curl -L https://raw.githubusercontent.com/denishpatel/pg-clone-schema/main/clone_schema.sql -o vendor/clone_schema.sql");
    process.exit(1);
  }

  const cfg = getConfig();
  if (!cfg) {
    console.error("Error: Could not find Saltcorn config file.");
    process.exit(1);
  }

  const host = cfg.host || "localhost";
  const port = cfg.port || 5432;
  const database = cfg.database;
  const user = cfg.user || "postgres";
  const password = cfg.password || "";

  if (!database) {
    console.error("Error: No database name found in Saltcorn config.");
    process.exit(1);
  }

  console.log(`Installing clone_schema into ${database} on ${host}:${port}...`);

  const env = { ...process.env };
  if (password) env.PGPASSWORD = password;

  try {
    const result = execFileSync(
      "psql",
      ["-h", host, "-p", String(port), "-U", user, "-d", database, "-f", SQL_FILE],
      { encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] }
    );
    // Count successful CREATEs
    const creates = (result.match(/CREATE (FUNCTION|TYPE)/g) || []).length;
    console.log(`✓ clone_schema installed successfully (${creates} objects created).`);
  } catch (err) {
    console.error("Error installing clone_schema:");
    console.error(err.stderr || err.message);
    process.exit(1);
  }
}

main();
