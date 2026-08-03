/**
 * Project Setup API routes — CRUD, scope, auto-detect, download, write-disk.
 * Settings API route.
 */
const {
  apiLocal, sendJson,
  fs, path,
} = require("./_shared");

const routes = [
  // ─── Projects CRUD ───────────────────────────────────
  {
    url: "/project-sync/api/projects",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const adopted = await ps.ensureDefaultProjectFromRoot();
        return { ok: true, adopted, projects: await ps.listProjects() };
      }),
  },
  {
    url: "/project-sync/api/projects",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const body = req.body || {};
        if (!body.name) return sendJson(res, { ok: false, error: "name is required" }, 400);
        const project = await ps.createProject(body);
        const scopeEntries = await ps.seedScope(project.id);
        return { ok: true, project, scope_entries: scopeEntries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);
        const scope = await ps.getScope(project.id);
        return { ok: true, project, scope };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/environment",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const store = require("../operational-config");
        const environment = req.query?.environment || req.query?.env || "dev";
        return { ok: true, config: await store.getOperationalConfig(req.params.id, environment) };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/environment",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const store = require("../operational-config");
        const body = req.body || {};
        const environment = body.environment || "dev";
        const config = await store.saveOperationalConfig(req.params.id, environment, body);
        await store.activateOperationalConfig(req.params.id, environment);
        return { ok: true, config };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/setup-health",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const store = require("../operational-config");
        const { resolveEnvironmentConfig } = require("../../environment");
        const { runSetupHealth } = require("../setup-health");
        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);
        const environment = req.query?.environment || req.query?.env || "dev";
        const uiConfig = await store.getOperationalConfig(project.id, environment);
        const resolved = resolveEnvironmentConfig({ projectDir: project.root_path || process.cwd(), env: environment, uiConfig, defaults: { adapter: "native", transport: "direct" } });
        return { ok: true, ...(await runSetupHealth({ project, resolved })), resolved: { config: resolved.config, sources: resolved.sources } };
      }),
  },
  {
    url: "/project-sync/api/tokens",
    method: "get",
    callback: async (req, res) => apiLocal(req, res, async () => ({ ok: true, tokens: await require("../token-store").listTokens() })),
  },
  {
    url: "/project-sync/api/tokens",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => apiLocal(req, res, async () => ({ ok: true, token: await require("../token-store").generateToken(req.body?.name) })),
  },
  {
    url: "/project-sync/api/tokens/:id/revoke",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => apiLocal(req, res, async () => {
      const token = await require("../token-store").revokeToken(req.params.id);
      return token ? { ok: true, token } : sendJson(res, { ok: false, error: "Token not found" }, 404);
    }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const project = await ps.updateProject(req.params.id, req.body || {});
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);
        return { ok: true, project };
      }),
  },
  {
    url: "/project-sync/api/projects/:id",
    method: "delete",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        await ps.deleteProject(req.params.id);
        return { ok: true };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/tenant-objects",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const scoped = await ps.getScopedTenantObjects(req.params.id);
        return { ok: true, ...scoped };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope",
    method: "get",
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        return { ok: true, scope: await ps.getScope(req.params.id) };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const entries = req.body;
        if (!Array.isArray(entries)) return sendJson(res, { ok: false, error: "Expected array of scope entries" }, 400);
        await ps.setScope(req.params.id, entries);
        return { ok: true, count: entries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/scope/:objectType/:objectName",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const { included } = req.body || {};
        await ps.updateScopeEntry(req.params.id, req.params.objectType, req.params.objectName, included);
        return { ok: true };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/auto-detect",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        const entries = await ps.seedScope(req.params.id);
        return { ok: true, scope_entries: entries.length };
      }),
  },
  {
    url: "/project-sync/api/projects/:id/download",
    method: "post",
    noCsrf: true,
    callback: async (req, res) => {
      try {
        const ps = require("../../project-setup");
        const { zipToBuffer } = require("../../zip");

        const project = await ps.getProject(req.params.id);
        if (!project) return sendJson(res, { ok: false, error: "Project not found" }, 404);

        const os = require("node:os");
        const tmpDir = path.join(os.tmpdir(), `scps-export-${project.slug}-${Date.now()}`);
        await ps.writeProjectToDir(req.params.id, tmpDir);

        const files = {};
        function walk(dir, prefix) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
            else files[rel] = fs.readFileSync(path.join(dir, entry.name));
          }
        }
        walk(tmpDir, project.slug);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const zipBuf = zipToBuffer(files);
        const zipName = `${project.slug}-v0.1.0.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
        res.setHeader("Content-Length", zipBuf.length);
        res.end(zipBuf);
      } catch (err) {
        return sendJson(res, { ok: false, error: err.message }, 500);
      }
    },
  },
  {
    url: "/project-sync/api/projects/:id/write-disk",
    method: "post",
    noCsrf: true,
    callback: async (req, res) =>
      apiLocal(req, res, async () => {
        const ps = require("../../project-setup");
        return ps.writeProjectToDisk(req.params.id);
      }),
  },
];

module.exports = routes;
