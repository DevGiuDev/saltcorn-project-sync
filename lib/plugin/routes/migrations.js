/**
 * Migrations & Seeds API routes — list, create, edit, delete, validate.
 * All operations write to the project root_path. Read endpoints use the
 * session/token auth wrapper; mutating endpoints require applyAuthorized.
 */
const fs = require("node:fs");
const path = require("node:path");
const { api, apiLocal, authorized, applyAuthorized, sendJson } = require("../auth");
const { resolveProjectRootFromRequest } = require("./_shared");
const {
  loadSeedFiles,
  loadMigrationFiles,
  validateSeedFile,
  validateMigrationFile,
  writeSeedFile,
  writeMigrationFile,
  migrationsDir,
  seedsDir,
} = require("../../seeds");
const { ensureProjectDirs } = require("../../project-io");
const { canonicalStringify } = require("../../canonical-json");
const { normalizePack } = require("../../normalizer");
const { nativeAdapterOrError } = require("../helpers");

/**
 * Reduce a full tenant export pack to a compact list of tables with their
 * fields, suitable for wizard dropdowns. Field types are collapsed to their
 * name string so the client does not need to understand Saltcorn's type
 * objects.
 */
function tablesForWizard(pack) {
  return (pack.tables || []).map((table) => ({
    name: table.name,
    fields: (table.fields || [])
      .filter((f) => f && f.name)
      .map((f) => ({
        name: f.name,
        type: typeof f.type === "string" ? f.type : f.type?.name || String(f.type || ""),
        reftable_name: f.reftable_name || null,
      })),
  }));
}

function parseBody(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_e) { return null; }
  }
  return null;
}

function nextOrder(files, dir) {
  const existing = files.map((f) => parseInt(String(f).match(/^(\d+)/)?.[1] || "0", 10));
  const max = existing.length ? Math.max(...existing) : 0;
  return max + 1;
}

const routes = [
  // GET tables inventory — feeds wizard dropdowns (table + field selects).
  {
    url: "/project-sync/api/tables",
    method: "get",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const adapter = await nativeAdapterOrError();
        if (adapter.error) return { ok: false, error: adapter.error };
        try {
          const pack = normalizePack(await adapter.exportProject());
          return { ok: true, tables: tablesForWizard(pack) };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },

  // GET list / individual
  {
    url: "/project-sync/api/migrations",
    method: "get",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "project root not configured" };
        const kind = req.query?.kind || req.query?.file ? null : null; // unused, kept for clarity
        const file = req.query?.file;
        try {
          if (file) {
            // Load a single file by name + kind
            const requestedKind = req.query?.kind;
            const dir = requestedKind === "seed" ? seedsDir(ctx.projectRoot) : migrationsDir(ctx.projectRoot);
            const filePath = path.join(dir, file);
            if (!fs.existsSync(filePath)) return { ok: false, error: `file not found: ${file}` };
            const raw = fs.readFileSync(filePath, "utf8");
            try {
              return { ok: true, data: JSON.parse(raw), file, kind: requestedKind };
            } catch (err) {
              return { ok: false, error: `invalid JSON in ${file}: ${err.message}` };
            }
          }
          const seeds = loadSeedFiles(ctx.projectRoot).map((s) => ({
            file: s.file,
            name: s.seed?.name,
            phase: s.seed?.phase || "manual",
            run: s.seed?.run || "always",
            mode: s.seed?.mode || "upsert",
            tables: (s.seed?.tables || []).length,
            valid: s.valid,
          }));
          const migrations = loadMigrationFiles(ctx.projectRoot).map((m) => ({
            file: m.file,
            name: m.migration?.name,
            phase: m.migration?.phase || "manual",
            run: m.migration?.run || "once",
            steps: (m.migration?.steps || []).length,
            valid: m.valid,
            ledger_status: null, // populated when a ledger context is available
          }));
          // Enrich with ledger status (best-effort, native-only)
          try {
            const ledger = require("../../migration-ledger");
            const projectId = ctx.project?.slug || ctx.project?.name || "default";
            const env = req.query?.environment || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
            const applied = await ledger.listApplied(projectId, env);
            const byName = new Map(applied.map((row) => [row.migration_name, row.status]));
            for (const m of migrations) {
              if (m.name && byName.has(m.name)) m.ledger_status = byName.get(m.name);
            }
          } catch (_ledgerErr) {
            // Ledger unavailable (non-native); leave ledger_status null.
          }
          return { ok: true, seeds, migrations };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }),
  },

  // POST create
  {
    url: "/project-sync/api/migrations",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "apply authorization required" }, 403);
      return apiLocal(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "project root not configured" };
        const body = parseBody(req.body);
        if (!body) return { ok: false, error: "invalid JSON body" };
        const kind = body.kind;
        const data = body.data;
        if (!kind || !data) return { ok: false, error: "kind and data are required" };

        ensureProjectDirs(ctx.projectRoot);
        if (kind === "seed") {
          const errors = validateSeedFile(data, body.original_file || "(new)");
          if (errors.length) return { ok: false, errors };
          const order = nextOrder(loadSeedFiles(ctx.projectRoot).map((s) => s.file), seedsDir(ctx.projectRoot));
          const file = writeSeedFile(ctx.projectRoot, { ...data, _order: order });
          return { ok: true, file, kind };
        }
        if (kind === "migration") {
          const errors = validateMigrationFile(data, body.original_file || "(new)");
          if (errors.length) return { ok: false, errors };
          const order = nextOrder(loadMigrationFiles(ctx.projectRoot).map((m) => m.file), migrationsDir(ctx.projectRoot));
          const file = writeMigrationFile(ctx.projectRoot, { ...data, _order: order });
          return { ok: true, file, kind };
        }
        return { ok: false, error: `unknown kind: ${kind}` };
      });
    },
  },

  // POST update (edit existing)
  {
    url: "/project-sync/api/migrations/update",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "apply authorization required" }, 403);
      return apiLocal(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "project root not configured" };
        const body = parseBody(req.body);
        if (!body) return { ok: false, error: "invalid JSON body" };
        const { kind, data, original_file } = body;
        if (!kind || !data || !original_file) return { ok: false, error: "kind, data and original_file are required" };

        const dir = kind === "seed" ? seedsDir(ctx.projectRoot) : migrationsDir(ctx.projectRoot);
        const oldPath = path.join(dir, original_file);
        if (!fs.existsSync(oldPath)) return { ok: false, error: `file not found: ${original_file}` };

        // Validate
        const errors = kind === "seed"
          ? validateSeedFile(data, original_file)
          : validateMigrationFile(data, original_file);
        if (errors.length) return { ok: false, errors };

        // Preserve the order prefix of the original file
        const orderMatch = String(original_file).match(/^(\d+)/);
        const order = orderMatch ? parseInt(orderMatch[1], 10) : 0;
        const dataWithOrder = { ...data, _order: order };

        // Remove the old file and write the new one (name may have changed)
        fs.unlinkSync(oldPath);
        const file = kind === "seed"
          ? writeSeedFile(ctx.projectRoot, dataWithOrder)
          : writeMigrationFile(ctx.projectRoot, dataWithOrder);
        return { ok: true, file, kind, original_file };
      });
    },
  },

  // POST delete
  {
    url: "/project-sync/api/migrations/delete",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      if (!applyAuthorized(req)) return sendJson(res, { ok: false, error: "apply authorization required" }, 403);
      return apiLocal(req, res, async () => {
        const ctx = await resolveProjectRootFromRequest(req);
        if (!ctx.projectRoot) return { ok: false, error: ctx.error || "project root not configured" };
        const body = parseBody(req.body);
        if (!body) return { ok: false, error: "invalid JSON body" };
        const { kind, file } = body;
        if (!kind || !file) return { ok: false, error: "kind and file are required" };
        // Prevent path traversal: only allow simple filenames
        if (/[\/\\]/.test(file)) return { ok: false, error: "invalid filename" };
        const dir = kind === "seed" ? seedsDir(ctx.projectRoot) : migrationsDir(ctx.projectRoot);
        const filePath = path.join(dir, file);
        if (!fs.existsSync(filePath)) return { ok: false, error: `file not found: ${file}` };
        fs.unlinkSync(filePath);
        return { ok: true, file, kind };
      });
    },
  },

  // POST test (validate without writing)
  {
    url: "/project-sync/api/migrations/test",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const body = parseBody(req.body);
        if (!body) return { ok: false, error: "invalid JSON body" };
        const { kind, data } = body;
        if (!kind || !data) return { ok: false, error: "kind and data are required" };
        const errors = kind === "seed"
          ? validateSeedFile(data, "(validation)")
          : validateMigrationFile(data, "(validation)");
        if (errors.length) return { ok: false, errors };
        return { ok: true };
      }),
  },
];

module.exports = routes;
