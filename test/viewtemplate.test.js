const { describe, it } = require("node:test");
const assert = require("node:assert");
const vt = require("../viewtemplates/project-sync-console");

describe("project-sync viewtemplate", () => {
  it("exports metadata and workflow", () => {
    assert.equal(vt.name, "ProjectSyncConsole");
    assert.equal(vt.tableless, true);
    assert.equal(typeof vt.configuration_workflow, "function");
    const wf = vt.configuration_workflow();
    assert.ok(wf);
  });

  it("rejects non-admin users", async () => {
    const html = await vt.run(null, null, null, null, { req: { user: { role_id: 2 } } });
    assert.match(html, /administrators only/i);
  });
});
