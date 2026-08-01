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
