const { describe, it } = require("node:test");
const assert = require("node:assert");
const { zipToBuffer } = require("../lib/zip");
const { autoDetectScope, tenantObjectsFromState, dedupeScopeEntries, BUILTIN_VIEW_TEMPLATES, DEV_PLUGIN_PATTERNS } = require("../lib/project-setup");
const { canonicalStringify } = require("../lib/canonical-json");

describe("zip", () => {
  it("generates a valid ZIP with one file", () => {
    const files = { "hello.txt": "Hello, world!" };
    const buf = zipToBuffer(files);
    // ZIP magic number
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
    assert.ok(buf.length > 30);
  });

  it("handles multiple files with nested paths", () => {
    const files = {
      "project/saltcorn.project.json": '{"name":"test"}',
      "project/objects/tables/users.json": "[]",
    };
    const buf = zipToBuffer(files);
    assert.ok(buf.length > 100);
    // Verify end of central directory signature
    const endSig = buf.readUInt32LE(buf.length - 22);
    assert.equal(endSig, 0x06054b50);
  });

  it("handles binary content", () => {
    const files = { "data.bin": Buffer.from([0, 1, 2, 255, 254]) };
    const buf = zipToBuffer(files);
    assert.ok(buf.length > 30);
  });

  it("handles empty file", () => {
    const files = { "empty.txt": "" };
    const buf = zipToBuffer(files);
    assert.ok(buf.length > 22);
  });
});

describe("project-setup auto-detect", () => {
  it("includes app views, including plugin-template views, and excludes dev views", () => {
    const tenant = {
      tables: [{ name: "invoices", is_system: false, field_count: 3 }],
      views: [
        { name: "invoice_list", viewtemplate: "List", table_name: "invoices" },
        { name: "invoice_chart", viewtemplate: "Chart", table_name: "invoices" },
        { name: "copilot_chat", viewtemplate: "SaltcornCopilot", is_dev_view: true, table_name: "" },
      ],
      pages: [],
      triggers: [],
      roles: [],
      plugins: [],
    };
    const scope = autoDetectScope(tenant);
    const included = new Set(scope.filter((e) => e.included).map((e) => `${e.object_type}::${e.object_name}`));
    assert.ok(included.has("views::invoice_list"));
    assert.ok(included.has("views::invoice_chart"));
    assert.ok(!included.has("views::copilot_chat"));
    assert.ok(included.has("tables::invoices"));
  });

  it("excludes dev plugins", () => {
    const tenant = {
      tables: [],
      views: [],
      pages: [],
      triggers: [],
      roles: [],
      plugins: [
        { name: "base", version: "latest", is_dev_plugin: false, source: "" },
        { name: "sbadmin2", version: "latest", is_dev_plugin: false, source: "" },
        { name: "saltcorn-copilot", version: "0.1", is_dev_plugin: true, source: "npm" },
        { name: "saltcorn-mcp-server", version: "0.1", is_dev_plugin: true, source: "local" },
      ],
    };
    const scope = autoDetectScope(tenant);
    const pluginScope = scope.filter((e) => e.object_type === "plugins");
    const included = pluginScope.filter((e) => e.included).map((e) => e.object_name);
    const excluded = pluginScope.filter((e) => !e.included).map((e) => e.object_name);
    assert.deepStrictEqual(included.sort(), ["base", "sbadmin2"]);
    assert.ok(excluded.includes("saltcorn-copilot"));
    assert.ok(excluded.includes("saltcorn-mcp-server"));
  });

  it("builtin view templates are recognized", () => {
    assert.ok(BUILTIN_VIEW_TEMPLATES.has("list"));
    assert.ok(BUILTIN_VIEW_TEMPLATES.has("edit"));
    assert.ok(BUILTIN_VIEW_TEMPLATES.has("show"));
    assert.ok(!BUILTIN_VIEW_TEMPLATES.has("SaltcornCopilot"));
  });

  it("DEV_PLUGIN_PATTERNS match known dev plugins", () => {
    assert.ok(DEV_PLUGIN_PATTERNS.some((re) => re.test("saltcorn-copilot")));
    assert.ok(DEV_PLUGIN_PATTERNS.some((re) => re.test("saltcorn-mcp-server")));
    assert.ok(DEV_PLUGIN_PATTERNS.some((re) => re.test("saltcorn-project-sync")));
    assert.ok(!DEV_PLUGIN_PATTERNS.some((re) => re.test("base")));
    assert.ok(!DEV_PLUGIN_PATTERNS.some((re) => re.test("sbadmin2")));
  });

  it("builds scope candidates from normalized native export state", () => {
    const tenant = tenantObjectsFromState({
      tables: [{ name: "invoices", fields: [{ name: "total" }] }],
      views: [{ name: "Invoice Chart", viewtemplate: "Chart", table_name: "invoices" }],
      pages: [{ name: "dashboard", title: "Dashboard" }],
      triggers: [{ name: "nightly", action: "run_js" }],
      roles: [{ name: "admin", role: "admin", id: 1 }],
      plugins: [{ name: "saltcorn-project-sync", version: "0.1.0" }, { name: "charts", version: "0.1.0" }],
    });
    assert.equal(tenant.tables[0].field_count, 1);
    assert.equal(tenant.roles[0].name, "admin");
    const scope = autoDetectScope(tenant);
    assert.ok(scope.some((e) => e.object_type === "roles" && e.object_name === "admin"));
    assert.ok(scope.some((e) => e.object_type === "plugins" && e.object_name === "charts" && e.included));
    assert.ok(scope.some((e) => e.object_type === "plugins" && e.object_name === "saltcorn-project-sync" && !e.included));
  });

  it("deduplicates tenant objects and posted scope entries by type/name", () => {
    const tenant = tenantObjectsFromState({
      triggers: [
        { name: "Saltcorn Copilot", action: "Agent" },
        { name: "Saltcorn Copilot", action: "Agent" },
      ],
      plugins: [
        { name: "saltcorn-project-sync", version: "0.1.0" },
        { name: "saltcorn-project-sync", version: "0.1.0" },
      ],
    });
    assert.equal(tenant.triggers.length, 1);
    assert.equal(tenant.plugins.length, 1);

    const entries = dedupeScopeEntries([
      { object_type: "views", object_name: "dashboard", included: true },
      { object_type: "views", object_name: "dashboard", included: false },
    ]);
    assert.deepStrictEqual(entries, [{ object_type: "views", object_name: "dashboard", included: false }]);
  });
});
