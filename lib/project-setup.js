/**
 * Project setup — create project definitions from an existing Saltcorn tenant.
 *
 * Tables in Saltcorn DB:
 *   _sc_ps_projects  — project definitions
 *   _sc_ps_scope     — per-object inclusion/exclusion per project
 *
 * Workflow:
 *   1. User creates project (name, slug, description) from plugin UI
 *   2. Plugin auto-detects scope from tenant objects
 *   3. User toggles individual objects in/out
 *   4. User downloads ZIP (or CLI exports to disk)
 */

const fs = require("node:fs");
const path = require("node:path");
const { writeCanonicalJson, ensureProjectDirs, readJsonIfExists, safeFileName, stripObjectNoise } = require("./project-io");
const { normalizePack, normalizeFieldDef } = require("./normalizer");
const { stampSyncMeta, readSyncMeta, enrichWithGitInfo, readGitInfo } = require("./manifest");

// ─── Table DDL ─────────────────────────────────────────────

const PROJECTS_TABLE = "_sc_ps_projects";
const SCOPE_TABLE = "_sc_ps_scope";

const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  min_version TEXT DEFAULT '1.6.0',
  root_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)`;

const CREATE_SCOPE_TABLE = `
CREATE TABLE IF NOT EXISTS ${SCOPE_TABLE} (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES ${PROJECTS_TABLE}(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_name TEXT NOT NULL,
  included BOOLEAN DEFAULT TRUE,
  auto_detected TEXT DEFAULT '',
  UNIQUE(project_id, object_type, object_name)
)`;

// ─── Built-in view templates (not plugin-owned) ────────────

const BUILTIN_VIEW_TEMPLATES = new Set([
  "list", "show", "edit", "filter", "listshow", "listedit",
  "editablelist", "feed", "kanban", "calendar", "map",
  "zoom", "pageview", "card", "dashboard",
]);

// ─── Dev/admin plugin patterns → auto-excluded ─────────────

const DEV_PLUGIN_PATTERNS = [
  /copilot/i,
  /db.code/i,
  /dbcode/i,
  /mcp-server/i,
  /dev-mcp/i,
  /saltcorn-project-sync/i,
];

function isDevPlugin(name) {
  return DEV_PLUGIN_PATTERNS.some((re) => re.test(name));
}

function isDevView(view = {}) {
  return DEV_PLUGIN_PATTERNS.some((re) => re.test(view.name || "") || re.test(view.viewtemplate || ""));
}

function scopeKey(entry = {}) {
  return `${entry.object_type}::${entry.object_name}`;
}

function dedupeScopeEntries(entries = []) {
  const byKey = new Map();
  for (const entry of entries || []) {
    if (!entry || !entry.object_type || !entry.object_name) continue;
    byKey.set(scopeKey(entry), entry);
  }
  return Array.from(byKey.values());
}

function dedupeNamedObjects(items = []) {
  const byName = new Map();
  for (const item of items || []) {
    if (!item || !item.name) continue;
    if (!byName.has(item.name)) byName.set(item.name, item);
  }
  return Array.from(byName.values());
}

function dedupeTenantObjects(tenantObjects = {}) {
  for (const kind of ["tables", "views", "pages", "triggers", "roles", "plugins", "menu", "settings"]) {
    tenantObjects[kind] = dedupeNamedObjects(tenantObjects[kind] || []);
  }
  return tenantObjects;
}

// ─── Saltcorn tags ───────────────────────────────────────

/**
 * Load all Saltcorn tags and their entries from the DB.
 * Returns a Map keyed by `"<kind>::<db_id>"` → array of tag name strings.
 *
 * Example entry: `"tables::42" => ["Commerce", "Core"]`
 */
async function loadObjectTags() {
  const db = getDb();
  if (!db || typeof db.select !== "function") return new Map();

  let tagRows = [];
  let entryRows = [];
  try {
    tagRows = await db.select("_sc_tags");
    entryRows = await db.select("_sc_tag_entries");
  } catch (_e) {
    // Tags not available in this Saltcorn version or not yet migrated.
    return new Map();
  }

  const tagNames = new Map();        // tag_id → tag_name
  for (const t of tagRows) tagNames.set(t.id, t.name);

  const byObject = new Map();        // "kind::id" → [tag_name, ...]
  const kindMap = [
    { col: "table_id", kind: "tables" },
    { col: "view_id", kind: "views" },
    { col: "page_id", kind: "pages" },
    { col: "trigger_id", kind: "triggers" },
  ];
  for (const entry of entryRows) {
    for (const { col, kind } of kindMap) {
      const objId = entry[col];
      if (!objId) continue;
      const key = `${kind}::${objId}`;
      const tagName = tagNames.get(entry.tag_id);
      if (!tagName) continue;
      if (!byObject.has(key)) byObject.set(key, []);
      byObject.get(key).push(tagName);
    }
  }
  return byObject;
}

/**
 * Build a name→tags lookup from a map of id→tags plus an array of named objects.
 */
function resolveTagsByName(objectTags, objects, kind) {
  const result = new Map();           // name → [tag, ...]
  for (const obj of objects) {
    if (obj.id == null) continue;
    const tags = objectTags.get(`${kind}::${obj.id}`);
    if (tags && tags.length) result.set(obj.name, tags);
  }
  return result;
}

function tenantObjectsFromState(state = {}) {
  return dedupeTenantObjects({
    tables: (state.tables || []).map((table) => ({
      name: table.name,
      is_system: table.name === "users",
      field_count: Array.isArray(table.fields) ? table.fields.length : 0,
      id: table.id,
    })),
    views: (state.views || []).map((view) => ({
      name: view.name,
      viewtemplate: typeof view.viewtemplate === "string" ? view.viewtemplate : (view.viewtemplate?.name || ""),
      is_plugin_owned: false,
      is_dev_view: isDevView(view),
      table_name: view.table_name || "",
      id: view.id,
    })),
    pages: (state.pages || []).map((page) => ({ name: page.name, title: page.title || "", id: page.id })),
    triggers: (state.triggers || []).map((trigger) => ({
      name: trigger.name,
      action: trigger.action || "",
      table_name: trigger.table_name || "",
      id: trigger.id,
    })),
    roles: (state.roles || []).map((role) => ({
      name: role.role || role.name,
      id: role.id,
    })),
    plugins: (state.plugins || []).map((plugin) => ({
      name: plugin.name,
      version: plugin.version || "",
      is_dev_plugin: isDevPlugin(plugin.name || ""),
      source: plugin.source || plugin.location || "",
    })),
    menu: (state.menu || []).map((item) => ({
      name: item.name,
      item_count: Array.isArray(item.items) ? item.items.length : 0,
    })),
    // Values are intentionally omitted: the native adapter has already
    // filtered non-exportable settings, and the scope UI only needs names.
    settings: (state.settings || []).map((setting) => ({
      name: setting.name || setting.key,
    })),
  });
}

async function nativeTenantState() {
  const { nativeSaltcornAdapter } = require("./tenant-adapters");
  const adapter = nativeSaltcornAdapter();
  return normalizePack(await adapter.exportProject());
}

// ─── DB helpers ────────────────────────────────────────────

function getDb() {
  for (const mod of ["@saltcorn/data/db", "@saltcorn/data/dist/db"]) {
    try { return require(mod); } catch (_e) { /* next */ }
  }
  return null;
}

async function ensureTables() {
  const db = getDb();
  if (!db || typeof db.query !== "function") throw new Error("Cannot access Saltcorn database module");
  await db.query(CREATE_PROJECTS_TABLE);
  await db.query(CREATE_SCOPE_TABLE);
}

async function dbQuery(sql, params = []) {
  const db = getDb();
  if (!db) throw new Error("Saltcorn database not available");
  return db.query(sql, params);
}

// ─── Optional model requires ───────────────────────────────

function requireModel(names) {
  for (const mod of names) {
    try { return require(mod); } catch (_e) { /* next */ }
  }
  return null;
}

async function findOne(Model, criteria) {
  if (!Model || typeof Model.findOne !== "function") return null;
  try { return await Model.findOne(criteria); } catch (_e) { return null; }
}

// ─── Project CRUD ──────────────────────────────────────────

async function listProjects() {
  await ensureTables();
  const rows = await dbQuery(`SELECT * FROM ${PROJECTS_TABLE} ORDER BY id`);
  return rows.rows || rows;
}

async function getProject(id) {
  await ensureTables();
  const rows = await dbQuery(`SELECT * FROM ${PROJECTS_TABLE} WHERE id = $1`, [id]);
  const list = rows.rows || rows;
  return list[0] || null;
}

async function createProject({ name, slug, description, min_version, root_path }) {
  await ensureTables();
  const safeSlug = (slug || name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  const rows = await dbQuery(
    `INSERT INTO ${PROJECTS_TABLE} (name, slug, description, min_version, root_path) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, safeSlug, description || "", min_version || "1.6.0", root_path || null]
  );
  const list = rows.rows || rows;
  return list[0];
}

async function updateProject(id, fields) {
  const sets = [];
  const params = [];
  let n = 1;
  for (const key of ["name", "slug", "description", "min_version", "root_path"]) {
    if (fields[key] !== undefined) { sets.push(`${key} = $${n++}`); params.push(fields[key]); }
  }
  if (!sets.length) return getProject(id);
  sets.push(`updated_at = now()`);
  params.push(id);
  await dbQuery(`UPDATE ${PROJECTS_TABLE} SET ${sets.join(", ")} WHERE id = $${n}`, params);
  return getProject(id);
}

async function deleteProject(id) {
  await dbQuery(`DELETE FROM ${PROJECTS_TABLE} WHERE id = $1`, [id]);
}

// ─── Scope CRUD ────────────────────────────────────────────

async function getScope(projectId) {
  await ensureTables();
  const rows = await dbQuery(
    `SELECT * FROM ${SCOPE_TABLE} WHERE project_id = $1 ORDER BY object_type, object_name`,
    [projectId]
  );
  return rows.rows || rows;
}

async function setScope(projectId, entries) {
  await ensureTables();
  const uniqueEntries = dedupeScopeEntries(entries);
  await dbQuery(`DELETE FROM ${SCOPE_TABLE} WHERE project_id = $1`, [projectId]);
  for (const e of uniqueEntries) {
    await dbQuery(
      `INSERT INTO ${SCOPE_TABLE} (project_id, object_type, object_name, included, auto_detected) VALUES ($1, $2, $3, $4, $5)`,
      [projectId, e.object_type, e.object_name, e.included !== false, e.auto_detected || ""]
    );
  }
}

async function updateScopeEntry(projectId, object_type, object_name, included) {
  await ensureTables();
  await dbQuery(
    `INSERT INTO ${SCOPE_TABLE} (project_id, object_type, object_name, included, auto_detected)
     VALUES ($1, $2, $3, $4, '') ON CONFLICT (project_id, object_type, object_name) DO UPDATE SET included = $4`,
    [projectId, object_type, object_name, included]
  );
}

// ─── Enumerate tenant objects ──────────────────────────────

async function getTenantObjects() {
  let result;

  try {
    result = tenantObjectsFromState(await nativeTenantState());
  } catch (_err) {
    // Fallback for older/incomplete Saltcorn runtimes where the native adapter
    // cannot be constructed. Keep the legacy model-by-model enumeration path.
    result = await getTenantObjectsLegacy();
  }

  // Enrich objects with Saltcorn tags from _sc_tags / _sc_tag_entries
  try {
    const objectTags = await loadObjectTags();
    if (objectTags.size > 0) {
      const taggableKinds = ["tables", "views", "pages", "triggers"];
      // For state-based path we need to resolve DB IDs by name
      // Load models to get id→name mapping
      const idMaps = await buildIdMaps(taggableKinds);
      for (const kind of taggableKinds) {
        const nameToId = idMaps[kind] || new Map(); // name → id
        const idToTags = new Map(); // id → [tag_name, ...]
        for (const [key, tags] of objectTags.entries()) {
          if (key.startsWith(kind + "::")) {
            const id = Number(key.split("::")[1]);
            idToTags.set(id, tags);
          }
        }
        for (const obj of result[kind] || []) {
          // Try direct id match (legacy path sets obj.id)
          const id = obj.id || nameToId.get(obj.name);
          if (id != null) {
            const tags = idToTags.get(Number(id));
            if (tags && tags.length) obj.tags = tags;
          }
        }
      }
    }
  } catch (_e) {
    // Tags enrichment is best-effort; don't break if unavailable.
  }

  return dedupeTenantObjects(result);
}

/**
 * Build name→id maps for taggable kinds using Saltcorn models.
 */
async function buildIdMaps(kinds) {
  const maps = {};
  const modelPaths = {
    tables: ["@saltcorn/data/models/table", "@saltcorn/data/dist/models/table"],
    views: ["@saltcorn/data/models/view", "@saltcorn/data/dist/models/view"],
    pages: ["@saltcorn/data/models/page", "@saltcorn/data/dist/models/page"],
    triggers: ["@saltcorn/data/models/trigger", "@saltcorn/data/dist/models/trigger"],
  };
  for (const kind of kinds) {
    maps[kind] = new Map();
    const Model = requireModel(modelPaths[kind] || []);
    if (!Model || typeof Model.find !== "function") continue;
    try {
      for (const obj of await Model.find()) {
        if (obj.name && obj.id != null) maps[kind].set(obj.name, obj.id);
      }
    } catch (_e) { /* best effort */ }
  }
  return maps;
}

async function getTenantObjectsLegacy() {
  const Table = requireModel(["@saltcorn/data/models/table", "@saltcorn/data/dist/models/table"]);
  const View = requireModel(["@saltcorn/data/models/view", "@saltcorn/data/dist/models/view"]);
  const Page = requireModel(["@saltcorn/data/models/page", "@saltcorn/data/dist/models/page"]);
  const Trigger = requireModel(["@saltcorn/data/models/trigger", "@saltcorn/data/dist/models/trigger"]);
  const Role = requireModel(["@saltcorn/data/models/role", "@saltcorn/data/dist/models/role"]);
  const Plugin = requireModel(["@saltcorn/data/models/plugin", "@saltcorn/data/dist/models/plugin"]);

  const result = { tables: [], views: [], pages: [], triggers: [], roles: [], plugins: [] };

  if (Table) {
    try {
      for (const t of await (typeof Table.find === "function" ? Table.find() : [])) {
        result.tables.push({
          name: t.name,
          is_system: t.name === "users",
          field_count: Array.isArray(t.fields) ? t.fields.length : 0,
          id: t.id,
        });
      }
    } catch (_e) {}
  }

  if (View) {
    try {
      for (const v of await (typeof View.find === "function" ? View.find() : [])) {
        const vt = typeof v.viewtemplate === "string" ? v.viewtemplate : (v.viewtemplate?.name || "");
        result.views.push({
          name: v.name,
          viewtemplate: vt,
          is_plugin_owned: false,
          is_dev_view: isDevView({ name: v.name, viewtemplate: vt }),
          table_name: v.table?.name || v.table_name || "",
          id: v.id,
        });
      }
    } catch (_e) {}
  }

  if (Page) {
    try {
      for (const p of await (typeof Page.find === "function" ? Page.find() : [])) {
        result.pages.push({ name: p.name, title: p.title || "", id: p.id });
      }
    } catch (_e) {}
  }

  if (Trigger) {
    try {
      for (const t of await (typeof Trigger.find === "function" ? Trigger.find() : [])) {
        result.triggers.push({
          name: t.name,
          action: t.action || "",
          table_name: t.table?.name || t.table_name || "",
          id: t.id,
        });
      }
    } catch (_e) {}
  }

  if (Role) {
    try {
      for (const r of await (typeof Role.find === "function" ? Role.find() : [])) {
        result.roles.push({ name: r.role, id: r.id });
      }
    } catch (_e) {}
  }

  if (Plugin) {
    try {
      for (const p of await (typeof Plugin.find === "function" ? Plugin.find() : [])) {
        const name = p.name || "";
        result.plugins.push({
          name,
          version: p.version || "",
          is_dev_plugin: isDevPlugin(name),
          source: p.source || p.location || "",
        });
      }
    } catch (_e) {}
  }

  return dedupeTenantObjects(result);
}

// ─── Auto-detect scope from tenant ─────────────────────────

function autoDetectScope(tenantObjects) {
  const entries = [];

  for (const t of tenantObjects.tables) {
    entries.push({ object_type: "tables", object_name: t.name, included: true, auto_detected: "" });
  }

  for (const v of tenantObjects.views) {
    const devView = Boolean(v.is_dev_view);
    entries.push({
      object_type: "views", object_name: v.name,
      included: !devView,
      auto_detected: devView ? "dev_view" : "",
    });
  }

  for (const p of tenantObjects.pages) {
    entries.push({ object_type: "pages", object_name: p.name, included: true, auto_detected: "" });
  }

  for (const t of tenantObjects.triggers) {
    entries.push({ object_type: "triggers", object_name: t.name, included: true, auto_detected: "" });
  }

  for (const r of tenantObjects.roles) {
    entries.push({ object_type: "roles", object_name: r.name, included: true, auto_detected: r.id <= 100 ? "builtin" : "" });
  }

  for (const p of tenantObjects.plugins) {
    entries.push({
      object_type: "plugins", object_name: p.name,
      included: !p.is_dev_plugin,
      auto_detected: p.is_dev_plugin ? "dev_plugin" : "",
    });
  }

  for (const m of tenantObjects.menu || []) {
    entries.push({ object_type: "menu", object_name: m.name, included: true, auto_detected: "" });
  }

  // nativeTenantState only exposes stable, exportable settings after secret
  // and environment-specific configuration filtering in the adapter.
  for (const s of tenantObjects.settings || []) {
    entries.push({ object_type: "settings", object_name: s.name, included: true, auto_detected: "stable_setting" });
  }

  return dedupeScopeEntries(entries);
}

// ─── Build export pack from scope ──────────────────────────

async function buildExportPack(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const scope = await getScope(projectId);
  const included = new Set();
  for (const e of scope) {
    if (e.included) included.add(`${e.object_type}::${e.object_name}`);
  }

  try {
    const state = await nativeTenantState();
    const filterKind = (kind) => (state[kind] || []).filter((item) => included.has(`${kind}::${item.role || item.name}`));
    return {
      project,
      pack: {
        tables: filterKind("tables"),
        views: filterKind("views"),
        pages: filterKind("pages"),
        triggers: filterKind("triggers"),
        roles: filterKind("roles"),
        menu: filterKind("menu"),
        settings: filterKind("settings"),
        plugins: filterKind("plugins"),
      },
    };
  } catch (_err) {
    // Fallback to the legacy direct model export below.
  }

  const Table = requireModel(["@saltcorn/data/models/table", "@saltcorn/data/dist/models/table"]);
  const View = requireModel(["@saltcorn/data/models/view", "@saltcorn/data/dist/models/view"]);
  const Page = requireModel(["@saltcorn/data/models/page", "@saltcorn/data/dist/models/page"]);
  const Trigger = requireModel(["@saltcorn/data/models/trigger", "@saltcorn/data/dist/models/trigger"]);
  const Role = requireModel(["@saltcorn/data/models/role", "@saltcorn/data/dist/models/role"]);
  const Plugin = requireModel(["@saltcorn/data/models/plugin", "@saltcorn/data/dist/models/plugin"]);
  const tenantObjects = await getTenantObjects();
  const pack = {};

  // Tables
  if (Table) {
    pack.tables = [];
    for (const t of tenantObjects.tables) {
      if (!included.has(`tables::${t.name}`)) continue;
      const full = await findOne(Table, { name: t.name });
      if (!full) continue;
      const obj = { name: full.name };
      if (Array.isArray(full.fields)) obj.fields = full.fields.map(normalizeFieldDef);
      if (full.min_role !== undefined) obj.min_role = full.min_role;
      pack.tables.push(obj);
    }
  }

  // Views
  if (View) {
    pack.views = [];
    for (const v of tenantObjects.views) {
      if (!included.has(`views::${v.name}`)) continue;
      const full = await findOne(View, { name: v.name });
      if (!full) continue;
      const obj = {
        name: full.name,
        viewtemplate: typeof full.viewtemplate === "string" ? full.viewtemplate : (full.viewtemplate?.name || ""),
        configuration: full.configuration || {},
        min_role: full.min_role,
      };
      if (full.table?.name) obj.table_name = full.table.name;
      for (const key of ["default_render_page", "description", "slug", "attributes", "exttable_name"]) {
        if (full[key] !== undefined && full[key] !== null) obj[key] = full[key];
      }
      pack.views.push(obj);
    }
  }

  // Pages
  if (Page) {
    pack.pages = [];
    for (const p of tenantObjects.pages) {
      if (!included.has(`pages::${p.name}`)) continue;
      const full = await findOne(Page, { name: p.name });
      if (!full) continue;
      const obj = { name: full.name };
      for (const key of ["title", "description", "configuration", "layout", "fixed_states", "min_role"]) {
        if (full[key] !== undefined && full[key] !== null) obj[key] = full[key];
      }
      pack.pages.push(obj);
    }
  }

  // Triggers
  if (Trigger) {
    pack.triggers = [];
    for (const t of tenantObjects.triggers) {
      if (!included.has(`triggers::${t.name}`)) continue;
      const full = await findOne(Trigger, { name: t.name });
      if (!full) continue;
      const obj = { name: full.name };
      if (full.action) obj.action = full.action;
      if (full.table?.name) obj.table_name = full.table.name;
      if (full.view?.name) obj.view_name = full.view.name;
      if (full.configuration) obj.configuration = full.configuration;
      if (full.min_role !== undefined) obj.min_role = full.min_role;
      pack.triggers.push(obj);
    }
  }

  // Roles
  if (Role) {
    pack.roles = [];
    for (const r of tenantObjects.roles) {
      if (!included.has(`roles::${r.name}`)) continue;
      pack.roles.push({ role: r.name, id: r.id });
    }
  }

  // Plugins
  if (Plugin) {
    pack.plugins = [];
    for (const p of tenantObjects.plugins) {
      if (!included.has(`plugins::${p.name}`)) continue;
      pack.plugins.push({ name: p.name, version: p.version, source: p.source });
    }
  }

  // Menu — read from _sc_config (no model available)
  if (tenantObjects.menu?.length) {
    pack.menu = [];
    try {
      const db = getDb();
      if (db && typeof db.select === "function") {
        const rows = await db.select("_sc_config", { key: "menu_items" });
        if (rows.length) {
          const raw = rows[0].value;
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (parsed && Array.isArray(parsed.v)) {
            for (const m of tenantObjects.menu) {
              if (!included.has(`menu::${m.name}`)) continue;
              pack.menu.push({ name: m.name, items: parsed.v });
            }
          }
        }
      }
    } catch (_e) { /* menu export best-effort */ }
  }

  return { project, pack };
}

// ─── Write project to directory ────────────────────────────

// safeFileName imported from project-io (supports Unicode transliteration)

async function writeProjectToDir(projectId, dir) {
  const { project, pack } = await buildExportPack(projectId);

  ensureProjectDirs(dir);

  // Read existing manifest if present to preserve version and sync metadata
  const existingManifest = readJsonIfExists(path.join(dir, "saltcorn.project.json"), null);

  // Manifest
  const manifest = {
    name: project.name,
    slug: project.slug,
    description: project.description || "",
    version: (existingManifest && existingManifest.version) || "0.1.0",
    saltcorn: { min_version: project.min_version || "1.6.0" },
    object_types: Object.keys(pack).filter((k) => pack[k] && pack[k].length > 0),
  };
  // Stamp sync metadata (this IS a full export = sync point)
  stampSyncMeta(manifest, dir);
  writeCanonicalJson(path.join(dir, "saltcorn.project.json"), manifest);

  // Plugin lock
  if (pack.plugins && pack.plugins.length > 0) {
    writeCanonicalJson(path.join(dir, "plugins.lock.json"), { plugins: pack.plugins });
  }

  // Object collections
  const OBJECT_TYPES = ["tables", "views", "pages", "triggers", "roles", "menu", "settings"];
  for (const kind of OBJECT_TYPES) {
    const objects = pack[kind] || [];
    const objDir = path.join(dir, "objects", kind);
    if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
    // Remove stale files
    for (const f of fs.readdirSync(objDir).filter((f) => f.endsWith(".json"))) {
      fs.unlinkSync(path.join(objDir, f));
    }
    for (const obj of objects) {
      writeCanonicalJson(path.join(objDir, safeFileName(obj.name || obj.role) + ".json"), stripObjectNoise({ ...obj }, kind));
    }
  }

  // Environment defaults
  const envDir = path.join(dir, "environments");
  if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
  const devEnv = { destructive_policy: "confirm" };
  writeCanonicalJson(path.join(envDir, "dev.json"), devEnv);

  return {
    ok: true,
    path: dir,
    counts: Object.fromEntries(OBJECT_TYPES.map((k) => [k, (pack[k] || []).length]).concat([["plugins", (pack.plugins || []).length]])),
  };
}

async function writeProjectToDisk(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.root_path) throw new Error("Project has no root_path; download as ZIP or set root_path first");
  return writeProjectToDir(projectId, project.root_path);
}

function slugFromName(name) {
  return String(name || "saltcorn-project").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "saltcorn-project";
}

function defaultProjectConfigFromRoot(rootPath) {
  const manifest = readJsonIfExists(path.join(rootPath, "saltcorn.project.json"), null) || {};
  const fallbackName = path.basename(rootPath).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Saltcorn Project";
  return {
    name: manifest.name || fallbackName,
    slug: manifest.slug || slugFromName(manifest.name || fallbackName),
    description: manifest.description || "Project auto-adopted from SALTCORN_PROJECT_SYNC_PROJECT_ROOT.",
    min_version: manifest.saltcorn?.min_version || manifest.min_version || "1.6.0",
    root_path: rootPath,
  };
}

async function seedScope(projectId) {
  const tenantObjects = await getTenantObjects();
  const scopeEntries = autoDetectScope(tenantObjects);
  await setScope(projectId, scopeEntries);
  return scopeEntries;
}

async function ensureDefaultProjectFromRoot(rootPath = process.env.SALTCORN_PROJECT_SYNC_PROJECT_ROOT || "") {
  if (!rootPath) return null;
  const existing = await listProjects();
  const byRoot = existing.find((project) => project.root_path === rootPath);
  if (byRoot) return { project: byRoot, created: false, adopted: true };
  if (existing.length) return null;

  const config = defaultProjectConfigFromRoot(rootPath);
  let project;
  try {
    project = await createProject(config);
  } catch (err) {
    if (!/duplicate|unicidad|unique/i.test(err.message || "")) throw err;
    const retry = await listProjects();
    project = retry.find((item) => item.slug === config.slug || item.root_path === rootPath);
    if (!project) throw err;
  }
  const scopeEntries = await seedScope(project.id);
  return { project, created: true, scope_entries: scopeEntries.length };
}

// ─── Scope + tenant objects for UI ─────────────────────────

function applyScopeToTenantObjects(tenantObjects = {}, scope = []) {
  const scopeMap = new Map();
  for (const e of scope) scopeMap.set(`${e.object_type}::${e.object_name}`, e);

  for (const kind of ["tables", "views", "pages", "triggers", "roles", "plugins", "menu", "settings"]) {
    for (const obj of tenantObjects[kind] || []) {
      const entry = scopeMap.get(`${kind}::${obj.name}`);
      obj.included = entry ? entry.included : true;
      obj.auto_detected = entry ? entry.auto_detected : "";
      obj.has_scope = Boolean(entry);
    }
  }

  return tenantObjects;
}

async function getScopedTenantObjects(projectId) {
  const scope = await getScope(projectId);
  const tenantObjects = await getTenantObjects();
  return applyScopeToTenantObjects(tenantObjects, scope);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getScope,
  setScope,
  updateScopeEntry,
  getTenantObjects,
  autoDetectScope,
  getScopedTenantObjects,
  buildExportPack,
  writeProjectToDir,
  writeProjectToDisk,
  ensureDefaultProjectFromRoot,
  defaultProjectConfigFromRoot,
  seedScope,
  tenantObjectsFromState,
  applyScopeToTenantObjects,
  dedupeScopeEntries,
  dedupeTenantObjects,
  ensureTables,
  loadObjectTags,
  buildIdMaps,
  BUILTIN_VIEW_TEMPLATES,
  DEV_PLUGIN_PATTERNS,
};
