const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { restAdapter } = require("../lib/tenant-adapters");

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

test("restAdapter exports project via HTTP", async () => {
  let requestUrl = "";
  const { server, url } = await withServer((req, res) => {
    requestUrl = req.url;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ tables: [] }));
  });
  const old = process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
  process.env.SALTCORN_PROJECT_SYNC_BASE_URL = url;
  try {
    assert.deepEqual(await restAdapter().exportProject({ referenceTables: [{ table: "countries" }] }), { tables: [] });
    assert.match(requestUrl, /reference_tables=countries/);
  } finally {
    server.close();
    if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
    else process.env.SALTCORN_PROJECT_SYNC_BASE_URL = old;
  }
});

test("restAdapter sends project and environment when requesting backup", async () => {
  let body = "";
  const { server, url } = await withServer((req, res) => {
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, id: "backup-1" }));
    });
  });
  const old = process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
  process.env.SALTCORN_PROJECT_SYNC_BASE_URL = url;
  try {
    await restAdapter().backup({ project_slug: "buyapp", env: "prod-test" });
    assert.deepEqual(JSON.parse(body), { project_slug: "buyapp", env: "prod-test" });
  } finally {
    server.close();
    if (old === undefined) delete process.env.SALTCORN_PROJECT_SYNC_BASE_URL;
    else process.env.SALTCORN_PROJECT_SYNC_BASE_URL = old;
  }
});
