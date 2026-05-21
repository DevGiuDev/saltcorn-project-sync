/**
 * Shared project-scoped navigation between Scope/Git/Live Diff/Plan/Approvals.
 */
const { button, buttonGroup } = require("../../ui");

function projectNav({ projectId = "", active = "scope" } = {}) {
  if (projectId === undefined || projectId === null || String(projectId) === "") return "";
  const id = encodeURIComponent(projectId);
  const tabs = [
    { key: "scope", label: "Scope", href: `/project-sync/projects/${id}`, icon: "fa-folder-open" },
    { key: "git", label: "Git", href: `/project-sync/git?project_id=${id}`, icon: "fa-code-branch" },
    { key: "live-diff", label: "Live Diff", href: `/project-sync/live-diff?project_id=${id}`, icon: "fa-exchange-alt" },
    { key: "plan", label: "Plan", href: `/project-sync/plan-preview?project_id=${id}`, icon: "fa-tasks" },
    { key: "approvals", label: "Approvals", href: `/project-sync/approvals?project_id=${id}`, icon: "fa-shield-alt" },
  ];
  return `<div class="mb-3">${buttonGroup(tabs.map((t) => button({
    href: t.href,
    color: t.key === active ? "primary" : "secondary",
    outline: t.key !== active,
    size: "sm",
    icon: t.icon,
    label: t.label,
  })))}</div>`;
}

module.exports = { projectNav };
