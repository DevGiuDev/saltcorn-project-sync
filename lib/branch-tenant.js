/**
 * Branch → Tenant operations.
 *
 * Clones a Saltcorn tenant (PostgreSQL schema) to enable parallel Git branch
 * work. The clone is a full copy: structure + data + sequences. No merge-back
 * of schemas is needed — merge happens at the git/file level, then the plugin
 * applies changes to the target branch's tenant.
 *
 * Requires:
 *  - The `clone_schema` PL/pgSQL function installed in the database.
 *    (see scripts/install-clone-schema.js or the SQL in scripts/clone_schema.sql)
 *  - Saltcorn running in multi-tenant mode.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// ─── Helpers ──────────────────────────────────────────────

/**
 * Convert a git branch name to a valid Saltcorn tenant/schema name.
 * Rules: lowercase, no dots, no slashes, only [a-z0-9_], max 63 chars.
 */
function branchToSchema(branchName) {
  return branchName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 63);
}

/**
 * Try to require a Saltcorn module, return null if not available.
 */
function optionalRequire(modules) {
  for (const mod of modules) {
    try { return require(mod); } catch { /* next */ }
  }
  return null;
}

/**
 * Get the Saltcorn db module.
 */
function getDb() {
  const db = optionalRequire([
    "@saltcorn/data/db",
    "@saltcorn/data/dist/db",
  ]);
  if (!db) throw new Error("Saltcorn data module not available");
  return db;
}

/**
 * Get tenant management functions.
 */
function getTenantModule() {
  const mod = optionalRequire([
    "@saltcorn/admin-models/models/tenant",
    "@saltcorn/admin-models/dist/models/tenant",
  ]);
  if (!mod) throw new Error("Saltcorn admin-models tenant module not available");
  return mod;
}

/**
 * Get state management functions.
 */
function getStateModule() {
  const mod = optionalRequire([
    "@saltcorn/data/db/state",
    "@saltcorn/data/dist/db/state",
  ]);
  if (!mod) throw new Error("Saltcorn state module not available");
  return mod;
}

/**
 * Get config functions.
 */
function getConfigModule() {
  const mod = optionalRequire([
    "@saltcorn/data/models/config",
    "@saltcorn/data/dist/models/config",
  ]);
  if (!mod) throw new Error("Saltcorn config module not available");
  return mod;
}

// ─── Resolve Active Schema ──────────────────────────────

/**
 * Resolve which schema the plugin should operate on based on the current git branch.
 *
 * Logic:
 *   1. Read current git branch from projectRoot
 *   2. Look up branch in branches.json
 *   3. If mapped → return that tenant schema
 *   4. If not mapped (main/master) → return defaultSchema (usually "public")
 *
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {string} [opts.defaultSchema] - Schema for the default branch (default: "public")
 * @param {string[]} [opts.defaultBranches] - Branch names treated as default (default: ["main","master"])
 * @returns {{ schema: string, branch: string, isDefaultBranch: boolean, isMapped: boolean, mapping: object|null }}
 */
function resolveActiveSchema(projectRoot, opts) {
  const { defaultSchema = "public", defaultBranches = ["main", "master"] } = opts || {};

  // Read current branch
  let branch = null;
  try {
    const gitOps = require("./git-ops");
    if (gitOps.isGitRepo(projectRoot)) {
      const branches = gitOps.gitBranches(projectRoot);
      if (branches.ok) branch = branches.current;
    }
  } catch { /* not a git repo */ }

  if (!branch) {
    return { schema: defaultSchema, branch: null, isDefaultBranch: true, isMapped: false, mapping: null };
  }

  const isDefaultBranch = defaultBranches.includes(branch);

  // Look up mapping
  let mapping = null;
  try {
    const map = loadBranchMapSync(projectRoot);
    mapping = map.branches?.[branch] || null;
  } catch { /* no mapping file */ }

  if (isDefaultBranch && !mapping) {
    return { schema: defaultSchema, branch, isDefaultBranch: true, isMapped: false, mapping: null };
  }

  if (mapping) {
    return { schema: mapping.tenant, branch, isDefaultBranch: false, isMapped: true, mapping };
  }

  // Feature branch without mapping — schema derived from branch name
  return { schema: branchToSchema(branch), branch, isDefaultBranch: false, isMapped: false, mapping: null };
}

/**
 * Ensure the current request's tenant matches the active git branch's tenant.
 * Returns { ok, error, expected, actual } or { ok: true }.
 *
 * @param {string} projectRoot
 * @param {string} requestTenant - The tenant resolved from the HTTP request (subdomain)
 * @param {object} [opts] - Same opts as resolveActiveSchema
 * @returns {{ ok: boolean, error?: string, expected?: string, actual?: string }}
 */
function guardBranchTenant(projectRoot, requestTenant, opts) {
  const resolved = resolveActiveSchema(projectRoot, opts);

  // Normalize: Saltcorn may use empty string or "public" for the default tenant
  const expected = resolved.schema;
  const actual = requestTenant || "public";

  if (expected === actual) {
    return { ok: true, expected, actual, branch: resolved.branch };
  }

  // Check if we're on the default branch and request is on the default tenant
  if (resolved.isDefaultBranch && (actual === "public" || actual === "")) {
    return { ok: true, expected: "public", actual, branch: resolved.branch };
  }

  // Find which branch matches the current tenant (so user can switch)
  const suggestedBranch = findBranchForTenant(projectRoot, actual, opts);

  return {
    ok: false,
    error: `Branch/tenant mismatch: git branch "${resolved.branch}" expects tenant "${expected}", but request is for tenant "${actual}"`,
    expected,
    actual,
    branch: resolved.branch,
    suggested_branch: suggestedBranch,
  };
}

/**
 * Given a tenant name, find which git branch maps to it.
 * Returns the branch name or null.
 */
function findBranchForTenant(projectRoot, tenant, opts) {
  const { defaultSchema = "public", defaultBranches = ["main", "master"] } = opts || {};

  // If tenant is the default, suggest the default branch
  if (tenant === defaultSchema || tenant === "") {
    try {
      const gitOps = require("./git-ops");
      if (gitOps.isGitRepo(projectRoot)) {
        const branches = gitOps.gitBranches(projectRoot);
        if (branches.ok) {
          for (const db of defaultBranches) {
            if (branches.local.includes(db)) return db;
          }
        }
      }
    } catch { /* not a git repo */ }
    return defaultBranches[0];
  }

  // Search branch map for a mapping to this tenant
  try {
    const map = loadBranchMapSync(projectRoot);
    for (const [branchName, mapping] of Object.entries(map.branches || {})) {
      if (mapping.tenant === tenant) return branchName;
    }
  } catch { /* no map */ }

  // Fallback: try to derive branch name from tenant schema (reverse of branchToSchema)
  // This is a best-effort guess
  return null;
}

/** Synchronous version of loadBranchMap for use in guards */
function loadBranchMapSync(projectRoot) {
  const file = path.join(projectRoot, ".saltcorn-project-sync", "branches.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { branches: {} };
  }
}

// ─── Clone Schema (SQL-level) ─────────────────────────────

/**
 * Clone a PostgreSQL schema.
 *
 * Uses a hybrid approach to handle edge cases like user-defined enum types
 * that confuse pg_get_tabledef():
 *   1. Clone types and sequences via clone_schema(DDLONLY)
 *   2. Create tables with CREATE TABLE ... LIKE (avoids the enum type resolution bug)
 *   3. Copy data with INSERT ... SELECT
 *   4. Reset sequences
 *   5. Clone FKs, indexes, constraints
 *
 * @param {string} sourceSchema - e.g. "public"
 * @param {string} targetSchema - e.g. "feature_x"
 */
async function cloneSchemaData(sourceSchema, targetSchema) {
  const db = getDb();

  // Step 1: Create target schema
  await db.query(`CREATE SCHEMA IF NOT EXISTS "${targetSchema}"`);

  // Step 2: Copy enum types from source to target (skip clone_schema internals)
  const enumResult = await db.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = $1
      AND t.typtype = 'e'
      AND t.typname NOT IN ('cloneparms', 'tabledefs')
    ORDER BY t.typname, e.enumsortorder
  `, [sourceSchema]);

  // Group labels by type name
  const enumTypes = {};
  for (const row of enumResult.rows) {
    if (!enumTypes[row.typname]) enumTypes[row.typname] = [];
    enumTypes[row.typname].push(row.enumlabel);
  }

  for (const [name, labels] of Object.entries(enumTypes)) {
    const lbls = labels.map(l => `'${l}'`).join(', ');
    await db.query(`CREATE TYPE "${targetSchema}"."${name}" AS ENUM (${lbls})`)
      .catch(() => { /* may already exist */ });
  }

  // Step 3: Get tables ordered by FK dependencies (topological sort)
  const tablesResult = await db.query(`
    SELECT c.table_name
    FROM information_schema.tables c
    WHERE c.table_schema = $1
      AND c.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `, [sourceSchema]);
  const tables = tablesResult.rows.map(r => r.table_name);
  const sorted = await topoSortTables(sourceSchema, tables, db);

  // Step 4: Create tables with LIKE + copy data
  for (const tableName of sorted) {
    await db.query(
      `CREATE TABLE IF NOT EXISTS "${targetSchema}"."${tableName}" ` +
      `(LIKE "${sourceSchema}"."${tableName}" INCLUDING ALL)`
    );
    await db.query(
      `INSERT INTO "${targetSchema}"."${tableName}" ` +
      `SELECT * FROM "${sourceSchema}"."${tableName}"`
    );
  }

  // Step 5: Reset sequences to max(id)+1
  const seqsResult = await db.query(`
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1
  `, [targetSchema]);
  for (const { sequence_name } of seqsResult.rows) {
    try {
      // Try to find the associated table.column
      const assocResult = await db.query(`
        SELECT t.relname AS table_name, a.attname AS column_name
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid
        JOIN pg_class t ON d.refobjid = t.oid
        JOIN pg_attribute a ON (a.attrelid = t.oid AND a.attnum = d.refobjsubid)
        WHERE s.relkind = 'S' AND s.relnamespace = (
          SELECT oid FROM pg_namespace WHERE nspname = $1
        ) AND s.relname = $2
      `, [targetSchema, sequence_name]);
      if (assocResult.rows.length > 0) {
        const { table_name, column_name } = assocResult.rows[0];
        await db.query(`
          SELECT setval('"${targetSchema}"."${sequence_name}"',
            coalesce((SELECT max("${column_name}") FROM "${targetSchema}"."${table_name}"), 0) + 1,
            false)`);
      } else {
        // Fallback: just set to current last_value
        await db.query(`
          SELECT setval('"${targetSchema}"."${sequence_name}"',
            coalesce((SELECT last_value FROM "${targetSchema}"."${sequence_name}"), 1),
            true)`);
      }
    } catch { /* skip sequences we can't reset */ }
  }

  // Step 6: Recreate FK constraints
  // LIKE INCLUDING ALL should have copied constraints, but if not, add them
  // (already handled by INCLUDING ALL — this is a safety net)

  // Step 7: Update base_url in the cloned config if present
  try {
    const configMod = getConfigModule();
    await db.runWithTenant(targetSchema, async () => {
      const baseUrl = configMod.getConfig?.("base_url");
      if (baseUrl) {
        const domain = baseUrl.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
        const parts = domain.split(".");
        let newDomain;
        if (parts.length >= 2) {
          parts[0] = targetSchema;
          newDomain = parts.join(".");
        } else {
          newDomain = `${targetSchema}.${domain}`;
        }
        const newUrl = baseUrl.replace(domain, newDomain);
        await configMod.setConfig("base_url", newUrl);
      }
    });
  } catch { /* best effort — base_url update is non-critical */ }
}

/**
 * Topological sort of tables based on FK dependencies.
 * Tables without FK deps first, then tables that reference them.
 */
async function topoSortTables(schema, tables, db) {
  const fkResult = await db.query(`
    SELECT
      tc.table_name AS from_table,
      ccu.table_name AS to_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = $1`,
    [schema]
  );

  // Build adjacency: from_table depends on to_table
  const deps = {};
  for (const t of tables) deps[t] = new Set();
  for (const { from_table, to_table } of fkResult.rows) {
    if (deps[from_table] && from_table !== to_table) {
      deps[from_table].add(to_table);
    }
  }

  // Kahn's algorithm
  const sorted = [];
  const visited = new Set();

  function visit(table) {
    if (visited.has(table)) return;
    visited.add(table);
    for (const dep of deps[table] || []) visit(dep);
    sorted.push(table);
  }

  for (const t of tables) visit(t);
  return sorted;
}

// ─── Clone File Store ─────────────────────────────────────

/**
 * Copy the Saltcorn file store directory for a tenant.
 */
function cloneFileStore(sourceTenant, targetTenant) {
  const db = getDb();
  const fileStore = db.connectObj.file_store;
  if (!fileStore) return;

  const srcDir = path.join(fileStore, sourceTenant);
  const dstDir = path.join(fileStore, targetTenant);

  if (!fs.existsSync(srcDir)) return; // no files to clone

  fs.cpSync(srcDir, dstDir, { recursive: true });
}

// ─── High-level: Create Branch Tenant ─────────────────────

/**
 * Create a branch: git branch + clone tenant schema + register.
 *
 * @param {object} opts
 * @param {string} opts.branchName - Git branch name
 * @param {string} opts.projectRoot - Project root path
 * @param {string} [opts.sourceSchema] - Source schema (default: current tenant)
 * @param {boolean} [opts.skipGit] - Skip git operations (for testing)
 * @returns {Promise<{ok: boolean, branch: string, schema: string, url: string}>}
 */
async function createBranchTenant({ branchName, projectRoot, sourceSchema, skipGit }) {
  const db = getDb();
  const tenantMod = getTenantModule();
  const stateMod = getStateModule();

  const targetSchema = branchToSchema(branchName);
  const source = sourceSchema || db.connectObj.default_schema || "public";

  // Validate schema name
  if (!targetSchema) throw new Error("Invalid branch name: produces empty schema name");

  // Check target schema doesn't already exist
  const existing = await db.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
    [targetSchema]
  );
  if (existing.rows.length > 0) {
    throw new Error(`Schema "${targetSchema}" already exists`);
  }

  // 1. Git: create and checkout branch
  if (!skipGit && projectRoot) {
    const gitOps = require("./git-ops");
    const branchResult = gitOps.git(["checkout", "-b", branchName], projectRoot);
    if (!branchResult.ok) {
      throw new Error(`Git branch creation failed: ${branchResult.error}`);
    }
  }

  // 2–7: Create tenant, clone data, initialize — with rollback on failure
  let registered = false;
  try {
    // 2. Register tenant in _sc_tenants
    await tenantMod.insertTenant(targetSchema, "", `Branch: ${branchName}`, null);
    registered = true;

    // 3. Clone schema (structure + data + sequences)
    await cloneSchemaData(source, targetSchema);

    // 4. Clone file store
    try {
      cloneFileStore(source, targetSchema);
    } catch (err) {
      console.error("[branch-tenant] file store clone warning:", err.message);
    }

    // 5. Initialize Saltcorn State for the new tenant
    stateMod.add_tenant(targetSchema);
    // Load plugins for the new tenant
    const { loadAllPlugins } = optionalRequire([
      "../load_plugins",
      "@saltcorn/server/load_plugins",
    ]) || {};
    if (loadAllPlugins) {
      await db.runWithTenant(targetSchema, loadAllPlugins);
    }

    // 6. Build the tenant URL
    const baseUrl = stateMod.getRootState?.()?.getConfig?.("base_url") || "http://localhost:3000";
    const domain = baseUrl.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    const port = baseUrl.includes(":") ? ":" + baseUrl.split(":").pop().split("/")[0] : "";
    const tenantUrl = `http://${targetSchema}.${domain}${port}`;

    // 7. Store branch mapping
    await saveBranchMapping(projectRoot, branchName, targetSchema, source);

    return {
      ok: true,
      branch: branchName,
      schema: targetSchema,
      url: tenantUrl,
    };
  } catch (err) {
    // Rollback: clean up partial state so Saltcorn doesn't crash on restart
    console.error("[branch-tenant] createBranchTenant failed, rolling back:", err.message);
    try {
      // Remove from _sc_tenants if registered
      if (registered) {
        await db.query(`DELETE FROM public._sc_tenants WHERE subdomain = $1`, [targetSchema]);
      }
      // Drop schema if it exists (may be empty from failed clone)
      await db.query(`DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`);
      // Remove branch mapping if saved
      await removeBranchMapping(projectRoot, branchName);
    } catch (cleanupErr) {
      console.error("[branch-tenant] rollback also failed:", cleanupErr.message);
    }
    // Roll back git branch if we created it
    if (!skipGit && projectRoot) {
      try {
        const gitOps = require("./git-ops");
        gitOps.git(["checkout", source === "public" ? "main" : source], projectRoot);
        gitOps.git(["branch", "-D", branchName], projectRoot);
      } catch { /* best effort */ }
    }
    throw err;
  }
}

// ─── High-level: Switch Branch ─────────────────────────────

/**
 * Switch to an existing branch.
 * This is purely a git checkout — the tenant already exists.
 *
 * @param {object} opts
 * @param {string} opts.branchName
 * @param {string} opts.projectRoot
 * @returns {Promise<{ok: boolean, url: string}>}
 */
async function switchBranch({ branchName, projectRoot }) {
  const gitOps = require("./git-ops");
  const stateMod = getStateModule();
  const db = getDb();

  const targetSchema = branchToSchema(branchName);

  // Git checkout
  if (projectRoot) {
    const result = gitOps.git(["checkout", branchName], projectRoot);
    if (!result.ok) {
      throw new Error(`Git checkout failed: ${result.error}`);
    }
  }

  // Build URL — default branch goes to bare domain (no subdomain)
  const defaultBranches = ["main", "master"];
  const isDefault = defaultBranches.includes(branchName);
  const baseUrl = stateMod.getRootState?.()?.getConfig?.("base_url") || "http://localhost:3000";
  const domain = baseUrl.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  const port = baseUrl.includes(":") ? ":" + baseUrl.split(":").pop().split("/")[0] : "";
  let tenantUrl;
  if (isDefault) {
    tenantUrl = `http://${domain}${port}`;
  } else {
    tenantUrl = `http://${targetSchema}.${domain}${port}`;
  }

  return { ok: true, url: tenantUrl, schema: targetSchema };
}

// ─── High-level: Delete Branch Tenant ──────────────────────

/**
 * Delete a branch and its tenant.
 *
 * @param {object} opts
 * @param {string} opts.branchName
 * @param {string} opts.projectRoot
 * @param {boolean} [opts.force] - Force deletion even if unmerged
 * @param {boolean} [opts.skipGit] - Skip git operations
 */
async function deleteBranchTenant({ branchName, projectRoot, force, skipGit }) {
  const tenantMod = getTenantModule();
  const stateMod = getStateModule();
  const db = getDb();
  const targetSchema = branchToSchema(branchName);

  // 1. Delete tenant (schema + _sc_tenants row)
  try {
    await tenantMod.deleteTenant(targetSchema);
  } catch (err) {
    console.error("[branch-tenant] delete tenant warning:", err.message);
  }

  // 2. Remove file store
  const fileStore = db.connectObj.file_store;
  if (fileStore) {
    const dstDir = path.join(fileStore, targetSchema);
    if (fs.existsSync(dstDir)) {
      fs.rmSync(dstDir, { recursive: true, force: true });
    }
  }

  // 3. Remove from Saltcorn runtime State
  // (tenants object is module-internal, can't easily remove — but it's non-critical)

  // 4. Git: delete branch
  if (!skipGit && projectRoot) {
    const gitOps = require("./git-ops");
    // First switch to main if we're on this branch
    const current = gitOps.gitStatus(projectRoot);
    if (current.ok && current.branch === branchName) {
      gitOps.git(["checkout", "main"], projectRoot);
    }
    gitOps.git(["branch", force ? "-D" : "-d", branchName], projectRoot);
  }

  // 5. Remove branch mapping
  await removeBranchMapping(projectRoot, branchName);

  return { ok: true, branch: branchName, schema: targetSchema };
}

// ─── Branch Mapping Persistence ────────────────────────────

function branchMapPath(projectRoot) {
  return path.join(projectRoot, ".saltcorn-project-sync", "branches.json");
}

async function loadBranchMap(projectRoot) {
  const file = branchMapPath(projectRoot);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { branches: {} };
  }
}

async function saveBranchMapping(projectRoot, branchName, schema, sourceSchema) {
  const map = await loadBranchMap(projectRoot);
  map.branches[branchName] = {
    tenant: schema,
    created_from: sourceSchema,
    created_at: new Date().toISOString(),
  };
  const file = branchMapPath(projectRoot);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}

async function removeBranchMapping(projectRoot, branchName) {
  const map = await loadBranchMap(projectRoot);
  delete map.branches[branchName];
  const file = branchMapPath(projectRoot);
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}

// ─── List Branches with Tenant Status ──────────────────────

/**
 * List all git branches enriched with tenant mapping info.
 */
async function listBranchTenants(projectRoot) {
  const gitOps = require("./git-ops");
  const branchMap = await loadBranchMap(projectRoot);
  const branches = gitOps.gitBranches(projectRoot);

  if (!branches.ok) return { ok: false, error: branches.error };

  const current = branches.current;
  const result = branches.local.map((name) => {
    const mapping = branchMap.branches[name] || null;
    return {
      name,
      is_current: name === current,
      has_tenant: !!mapping,
      tenant: mapping ? mapping.tenant : null,
      created_from: mapping ? mapping.created_from : null,
      created_at: mapping ? mapping.created_at : null,
    };
  });

  return { ok: true, current, branches: result };
}

module.exports = {
  branchToSchema,
  cloneSchemaData,
  cloneFileStore,
  createBranchTenant,
  switchBranch,
  deleteBranchTenant,
  listBranchTenants,
  loadBranchMap,
  saveBranchMapping,
  removeBranchMapping,
  resolveActiveSchema,
  guardBranchTenant,
};
