/**
 * Sync API routes — pull, push, full-pull, stamp-sync, add-to-scope.
 */
const {
  api, apiLocal, sendJson,
  configuredProjectRoot,
  summarizeDiff, diffCount, nativeAdapterOrError, loadScopeSet,
  normalizePack, VERSIONED_KINDS, loadProjectState,
  readJsonIfExists, pullObjectToDisk, deleteObjectFromDisk, safeFileName, writeCanonicalJson,
  loadChangeIntents, writeDropIntent, planProject,
  loadManifest, readSyncMeta, computeFileSyncStatus, stampSyncMeta, versionedScopeFromState,
  resolveContext, resolveProjectRootFromRequest,
  path, fs,
} = require("./_shared");

async function projectContext(req) {
  const ctx = await resolveProjectRootFromRequest(req);
  if (!ctx.projectRoot) return { errorSent: true, payload: { ok: false, error: ctx.error || "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" } };
  const adapter = await nativeAdapterOrError();
  if (adapter.error) return { errorSent: true, payload: { ok: false, adapter: "native", error: adapter.error } };
  return { ...ctx, adapter };
}

const routes = [
  {
    url: "/project-sync/api/pull",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;
        const body = req.body || {};
        const kind = body.kind;
        const name = body.name;
        const properties = body.properties;
        if (!kind || !name) return { ok: false, error: "kind and name are required" };
        if (!VERSIONED_KINDS.includes(kind) && kind !== "plugins") return { ok: false, error: `invalid kind: ${kind}` };

        const livePack = normalizePack(await ctx.adapter.exportProject());
        const collection = kind === "plugins" ? (livePack.plugins || []) : (livePack[kind] || []);
        const liveObj = collection.find((o) => (o.name || o.role) === name);
        if (!liveObj) return { ok: false, error: `${kind}/${name} not found in live export` };

        const result = pullObjectToDisk(ctx.projectRoot, kind, liveObj, properties);
        return { ok: true, ...result };
      }),
  },
  {
    url: "/project-sync/api/set-version",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;
        const version = (req.body || {}).version;
        if (!version || typeof version !== "string") return { ok: false, error: "version is required" };
        const manifestPath = path.join(ctx.projectRoot, "saltcorn.project.json");
        const manifest = readJsonIfExists(manifestPath);
        if (!manifest) return { ok: false, error: "saltcorn.project.json not found" };
        manifest.version = version.trim();
        writeCanonicalJson(manifestPath, manifest);
        return { ok: true, version: manifest.version };
      }),
  },
  {
    url: "/project-sync/api/stamp-sync",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;
        const manifestPath = path.join(ctx.projectRoot, "saltcorn.project.json");
        const manifest = readJsonIfExists(manifestPath);
        if (!manifest) return { ok: false, error: "saltcorn.project.json not found" };
        stampSyncMeta(manifest, ctx.projectRoot);
        writeCanonicalJson(manifestPath, manifest);
        return { ok: true, sync: manifest.sync };
      }),
  },
  {
    url: "/project-sync/api/full-pull",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;

        const scopeSet = await loadScopeSet(ctx.projectRoot);
        const livePack = normalizePack(await ctx.adapter.exportProject());

        const { ensureProjectDirs, safeFileName: sfName, stripObjectNoise: stripNoise } = require("../../project-io");
        ensureProjectDirs(ctx.projectRoot);

        const counts = {};
        for (const kind of VERSIONED_KINDS) {
          const allObjects = livePack[kind] || [];
          const objects = scopeSet
            ? allObjects.filter((obj) => scopeSet.has(`${kind}::${obj.name || obj.role}`))
            : allObjects;
          const objDir = path.join(ctx.projectRoot, "objects", kind);
          if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
          for (const f of fs.readdirSync(objDir).filter((f) => f.endsWith(".json"))) {
            fs.unlinkSync(path.join(objDir, f));
          }
          for (const obj of objects) {
            writeCanonicalJson(path.join(objDir, sfName(obj.name || obj.role) + ".json"), stripNoise({ ...obj }, kind));
          }
          counts[kind] = objects.length;
        }

        const allPlugins = livePack.plugins || [];
        const plugins = scopeSet
          ? allPlugins.filter((p) => scopeSet.has(`plugins::${p.name}`))
          : allPlugins;
        if (plugins.length > 0) {
          writeCanonicalJson(path.join(ctx.projectRoot, "plugins.lock.json"), { plugins });
          counts.plugins = plugins.length;
        }

        const manifestPath = path.join(ctx.projectRoot, "saltcorn.project.json");
        const existing = readJsonIfExists(manifestPath) || {};
        const writtenState = loadProjectState(ctx.projectRoot);
        const manifest = {
          ...existing,
          object_types: Object.keys(counts).filter((k) => counts[k] > 0),
          scope: require("../../manifest").versionedScopeFromState({
            ...writtenState,
            plugins,
          }),
        };
        stampSyncMeta(manifest, ctx.projectRoot);
        writeCanonicalJson(manifestPath, manifest);
        return { ok: true, counts, sync: manifest.sync };
      }),
  },
  {
    url: "/project-sync/api/pull-drift",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;

        const desired = loadProjectState(ctx.projectRoot);
        const actual = normalizePack(await ctx.adapter.exportProject());
        const scopeSet = await loadScopeSet(ctx.projectRoot);
        const diff = summarizeDiff(desired, actual, scopeSet);

        const { safeFileName: sfName, stripObjectNoise: stripNoise } = require("../../project-io");
        const pulled = [];
        const pullTargets = [];

        for (const item of (diff.tables?.tables?.orphaned || [])) pullTargets.push({ kind: "tables", name: item.name });
        for (const item of (diff.tables?.tables?.updated || [])) pullTargets.push({ kind: "tables", name: item.key });
        for (const [kind, kindDiff] of Object.entries(diff.kinds || {})) {
          for (const item of (kindDiff?.orphaned || [])) pullTargets.push({ kind, name: item.name });
          for (const item of (kindDiff?.updated || [])) pullTargets.push({ kind, name: item.key });
        }
        for (const item of (diff.plugins?.orphaned || [])) pullTargets.push({ kind: "plugins", name: item.name });
        for (const item of (diff.plugins?.updated || [])) pullTargets.push({ kind: "plugins", name: item.key });

        if (!pullTargets.length) return { ok: true, pulled: [], message: "No drift to pull" };

        for (const { kind, name } of pullTargets) {
          const collection = kind === "plugins" ? (actual.plugins || []) : (actual[kind] || []);
          const liveObj = collection.find((o) => (o.name || o.role) === name);
          if (!liveObj) continue;

          if (kind === "plugins") {
            const lockPath = path.join(ctx.projectRoot, "plugins.lock.json");
            const lock = readJsonIfExists(lockPath, { plugins: [] });
            const idx = (lock.plugins || []).findIndex((p) => p.name === name);
            if (idx >= 0) lock.plugins[idx] = liveObj;
            else (lock.plugins = lock.plugins || []).push(liveObj);
            writeCanonicalJson(lockPath, lock);
          } else {
            const objDir = path.join(ctx.projectRoot, "objects", kind);
            if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
            writeCanonicalJson(path.join(objDir, sfName(name) + ".json"), stripNoise({ ...liveObj }, kind));
          }
          pulled.push(`${kind}/${name}`);
        }
        return { ok: true, pulled, count: pulled.length };
      }),
  },
  {
    url: "/project-sync/api/push-drift",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;

        const desired = loadProjectState(ctx.projectRoot);
        const actual = normalizePack(await ctx.adapter.exportProject());
        const scopeSet = await loadScopeSet(ctx.projectRoot);
        const diff = summarizeDiff(desired, actual, scopeSet);

        const pushTargets = [];
        const fileStatus = (() => {
          try {
            const manifest = loadManifest(ctx.projectRoot);
            const sync = readSyncMeta(manifest);
            if (sync.last_sync_epoch) return computeFileSyncStatus(ctx.projectRoot, sync.last_sync_epoch);
          } catch { /* ok */ }
          return null;
        })();

        for (const item of (diff.tables?.tables?.created || [])) pushTargets.push({ kind: "tables", name: item.name });
        for (const item of (diff.tables?.tables?.updated || [])) {
          const safeKey = `tables::${safeFileName(item.key)}`;
          if (fileStatus && fileStatus.get(safeKey)?.modified_after_sync) pushTargets.push({ kind: "tables", name: item.key });
        }
        for (const [kind, kindDiff] of Object.entries(diff.kinds || {})) {
          for (const item of (kindDiff?.created || [])) pushTargets.push({ kind, name: item.name });
          for (const item of (kindDiff?.updated || [])) {
            const safeKey = `${kind}::${safeFileName(item.key)}`;
            if (fileStatus && fileStatus.get(safeKey)?.modified_after_sync) pushTargets.push({ kind, name: item.key });
          }
        }
        for (const item of (diff.plugins?.created || [])) pushTargets.push({ kind: "plugins", name: item.name });
        for (const item of (diff.plugins?.updated || [])) pushTargets.push({ kind: "plugins", name: item.key });

        if (!pushTargets.length) {
          const dbg = {};
          for (const [k, v] of Object.entries(diff.kinds || {})) dbg[k] = { created: (v?.created || []).map(i => i.name), updated: (v?.updated || []).map(i => i.key), orphaned: (v?.orphaned || []).map(i => i.name) };
          return { ok: true, pushed: [], applied: [], skipped: [], message: "No drift to push", debug: dbg };
        }

        const intents = loadChangeIntents(ctx.projectRoot);
        const env = process.env.SALTCORN_PROJECT_SYNC_ENV || process.env.SALTCORN_PROJECT_SYNC_ENVIRONMENT || "dev";
        const fullPlan = planProject({ desired, actual, intents, env, backup: false });

        const filteredOps = (fullPlan.operations || []).filter((op) => {
          const opName = op.table || op.view || op.page || op.trigger || op.role || op.name;
          if (!opName) return false;
          for (const t of pushTargets) {
            if (opName === t.name) return true;
          }
          return false;
        });

        if (!filteredOps.length) {
          const desiredSummary = {};
          const actualSummary = {};
          for (const k of [...VERSIONED_KINDS, 'plugins']) {
            desiredSummary[k] = (desired[k] || []).length;
            actualSummary[k] = (actual[k] || []).length;
          }
          return { ok: true, pushed: pushTargets.map(t => t.kind + '/' + t.name), applied: [], skipped: [], message: "No matching plan ops",
            debug: { pushTargets: pushTargets.map(t => t.kind + '::' + t.name), totalPlanOps: (fullPlan.operations || []).length, planWarnings: (fullPlan.warnings || []).length, planBlocked: (fullPlan.blocked || []).length, desiredViews: (desired.views || []).length, actualViews: (actual.views || []).length, desiredTables: (desired.tables || []).length, actualTables: (actual.tables || []).length, desiredKeys: Object.keys(desired).join(','), actualKeys: Object.keys(actual).join(',') } };
        }

        let applyResult;
        try {
          applyResult = await ctx.adapter.applyPlan({ desired, plan: { ...fullPlan, operations: filteredOps } });
        } catch (applyErr) {
          return { ok: false, error: applyErr.message, pushed: pushTargets.map(t => t.kind + '/' + t.name) };
        }
        const pushed = pushTargets.map((t) => `${t.kind}/${t.name}`);
        const appliedNames = (applyResult.applied || []).map((op) => op.view || op.page || op.trigger || op.role || op.table || op.name || JSON.stringify(op.action));
        const skippedNames = (applyResult.skipped || []).map((s) => `${s.op?.action}: ${s.reason}`);
        return { ok: true, pushed, count: pushed.length, applied: appliedNames, skipped: skippedNames };
      }),
  },
  {
    url: "/project-sync/api/delete-object",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      api(req, res, async () => {
        const ctx = await projectContext(req);
        if (ctx.errorSent) return ctx.payload;
        const { kind, name } = req.body || {};
        if (!kind || !name) return { ok: false, error: "kind and name are required" };
        if (!VERSIONED_KINDS.includes(kind)) return { ok: false, error: `invalid kind: ${kind}` };

        const result = deleteObjectFromDisk(ctx.projectRoot, kind, name);

        // Recompute the portable manifest scope from the on-disk state
        // so saltcorn.project.json stops listing the removed object.
        const manifestPath = path.join(ctx.projectRoot, "saltcorn.project.json");
        const existing = readJsonIfExists(manifestPath) || {};
        existing.scope = versionedScopeFromState(loadProjectState(ctx.projectRoot));
        writeCanonicalJson(manifestPath, existing);

        // Authorize the destructive drop on deployment: stamp a drop_<kind>
        // change intent carrying the current manifest version. Once a tenant
        // reaches that version, loadChangeIntents' sinceVersion filter retires
        // the intent automatically — it stays in Git as an audit record but
        // stops being re-evaluated on every subsequent deploy.
        let intent = null;
        try {
          const version = existing.version || null;
          const reason = req.body && req.body.reason ? String(req.body.reason) : null;
          const written = writeDropIntent(ctx.projectRoot, kind, name, { version, reason });
          intent = written.intent;
        } catch (intentErr) {
          // Non-fatal: the file was already removed from disk; the intent is a
          // deployment-time authorization, not a precondition for the delete.
          console.error("[scps-delete-object] failed to write change intent:", intentErr.message);
        }

        // Mark the scope DB entry as excluded (reversible), mirroring add-to-scope.
        const ps = require("../../project-setup");
        const projectId = ctx.projectId || ctx.project?.id;
        if (projectId) {
          await ps.updateScopeEntry(projectId, kind, name, false);
        } else {
          const projectRoot = configuredProjectRoot();
          if (projectRoot) {
            const projects = await ps.listProjects();
            const project = projects.find((p) => p.root_path === projectRoot);
            if (project) await ps.updateScopeEntry(project.id, kind, name, false);
          }
        }

        return { ok: true, kind, name, removed: result.removed, intent, scope: existing.scope };
      }),
  },
  {
    url: "/project-sync/api/add-to-scope",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const { kind, name } = req.body || {};
        if (!kind || !name) return { ok: false, error: "kind and name required" };
        const ps = require("../../project-setup");
        const projectId = req.query?.project_id || req.query?.projectId || req.body?.project_id || req.body?.projectId;
        if (projectId) {
          await ps.updateScopeEntry(projectId, kind, name, true);
          return { ok: true, project_id: projectId };
        }
        const projectRoot = configuredProjectRoot();
        if (!projectRoot) return { ok: false, error: "project_id is required when no global project root is configured" };
        const projects = await ps.listProjects();
        const project = projects.find((p) => p.root_path === projectRoot);
        if (!project) return { ok: false, error: "No project found for configured project root" };
        await ps.updateScopeEntry(project.id, kind, name, true);
        return { ok: true, project_id: project.id };
      }),
  },
];

module.exports = routes;
