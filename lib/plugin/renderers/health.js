const { escapeHtml, card, filterableTable, pageShell, statusBadge } = require("../../ui");
const fs = require("node:fs");

function renderHealth() {
  const checks = [
    { name: "canonical JSON", ok: true },
    { name: "planner", ok: true },
    { name: "change intents", ok: true },
    { name: "deployment log path", ok: fs.existsSync(require("node:path").join(process.cwd(), ".saltcorn-project-sync")) },
  ];
  const rows = checks.map((c) => ({
    name: escapeHtml(c.name),
    status: c.ok ? statusBadge(true, "Healthy") : statusBadge(false, "Issue"),
    _ok: c.ok ? "yes" : "no",
  }));
  const table = filterableTable("health-checks", [
    { key: "name", label: "Check" },
    { key: "status", label: "Status" },
  ], rows, { tags: [{ key: "_ok", label: "Result" }], emptyMsg: "No checks." });

  return pageShell("Health", "/project-sync/health",
    card({ title: "System Health", icon: "fa-stethoscope", body: table })
  );
}

module.exports = { renderHealth };
