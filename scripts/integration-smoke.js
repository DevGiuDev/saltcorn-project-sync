#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "bin", "saltcorn-project-sync.js");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  return {
    command: `saltcorn-project-sync ${args.join(" ")}`,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ok: result.status === 0,
  };
}

function parseJsonOutput(step) {
  try {
    return JSON.parse(step.stdout || "null");
  } catch (err) {
    throw new Error(`${step.command} did not print JSON: ${err.message}`);
  }
}

function assertStep(step) {
  if (!step.ok) {
    throw new Error(`${step.command} failed with ${step.status}\n${step.stderr || step.stdout}`);
  }
  return step;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const adapter = process.env.SALTCORN_PROJECT_SYNC_ADAPTER || "rest";
  const baseUrl = process.env.SALTCORN_PROJECT_SYNC_BASE_URL || process.env.SALTCORN_BASE_URL;
  if (adapter === "rest" && !baseUrl) {
    printResult({ ok: true, skipped: true, reason: "SALTCORN_PROJECT_SYNC_BASE_URL is not configured" });
    return;
  }

  const projectDir = process.env.SCPS_INTEGRATION_PROJECT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "scps-integration-"));
  fs.mkdirSync(projectDir, { recursive: true });
  const tenantExport = path.join(projectDir, "tenant-export.json");
  const appliedFile = path.join(projectDir, "applied.json");
  const checks = [];

  try {
    checks.push(assertStep(run(["init", "--name", "Integration", "--slug", "integration"], { cwd: projectDir })));
    checks.push(assertStep(run(["export", "--adapter", adapter, "--out", projectDir], { cwd: projectDir })));

    const exportStep = assertStep(run(["export", "--adapter", adapter, "--out", path.join(projectDir, ".live-export")], { cwd: projectDir }));
    checks.push(exportStep);

    const rawExport = assertStep(run(["check-live", "--adapter", adapter], { cwd: projectDir }));
    checks.push(rawExport);

    const exported = assertStep(run(["export", "--adapter", adapter, "--out", projectDir], { cwd: projectDir }));
    checks.push(exported);

    const live = assertStep(run(["doctor-live", "--adapter", adapter], { cwd: projectDir }));
    checks.push(live);

    // Capture tenant export through the adapter command path by using REST directly when available.
    // The CLI diff/plan commands intentionally consume a file to match deployment pipeline usage.
    const url = `${String(baseUrl || "").replace(/\/$/, "")}/project-sync/api/export`;
    if (adapter === "rest") {
      const headers = process.env.SALTCORN_PROJECT_SYNC_API_TOKEN ? { authorization: `Bearer ${process.env.SALTCORN_PROJECT_SYNC_API_TOKEN}` } : {};
      const response = await fetch(url, { headers });
      const text = await response.text();
      if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
      fs.writeFileSync(tenantExport, text);
    } else {
      // Non-REST adapters can still use the exported project state as the tenant file.
      const state = {};
      for (const kind of ["tables", "views", "pages", "triggers", "roles", "menu", "settings"]) state[kind] = [];
      fs.writeFileSync(tenantExport, JSON.stringify(state));
    }

    checks.push(assertStep(run(["validate"], { cwd: projectDir })));

    // Seed and migration checks
    checks.push(assertStep(run(["list-seeds"], { cwd: projectDir })));
    checks.push(assertStep(run(["list-migrations"], { cwd: projectDir })));
    // Create a seed and migration in the integration project to verify round-trip
    checks.push(assertStep(run(["add-seed", "--name", "integration-test", "--order", "1"], { cwd: projectDir })));
    checks.push(assertStep(run(["add-migration", "--name", "integration-setup", "--order", "1"], { cwd: projectDir })));
    checks.push(assertStep(run(["validate"], { cwd: projectDir })));

    checks.push(assertStep(run(["diff", "--tenant-export", tenantExport], { cwd: projectDir })));
    const planStep = assertStep(run(["plan", "--env", "dev", "--tenant-export", tenantExport], { cwd: projectDir }));
    checks.push(planStep);
    const plan = parseJsonOutput(planStep);
    if ((plan.blocked || []).length) throw new Error(`integration plan has blocked operations: ${JSON.stringify(plan.blocked)}`);

    checks.push(assertStep(run(["apply-file", "--env", "dev", "--tenant-export", tenantExport, "--out", appliedFile], { cwd: projectDir })));

    let liveApply = { skipped: true, reason: "set SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1 to run guarded live apply" };
    if (process.env.SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY === "1") {
      liveApply = assertStep(run(["apply", "--adapter", adapter, "--env", "dev"], { cwd: projectDir }));
      checks.push(liveApply);
    }

    printResult({
      ok: true,
      skipped: false,
      adapter,
      project_dir: projectDir,
      checks: checks.map((step) => ({ command: step.command, ok: step.ok, status: step.status })),
      plan: { operations: (plan.operations || []).length, warnings: (plan.warnings || []).length, blocked: (plan.blocked || []).length },
      live_apply: liveApply.skipped ? liveApply : { command: liveApply.command, ok: liveApply.ok, status: liveApply.status },
    });
  } catch (err) {
    printResult({
      ok: false,
      adapter,
      project_dir: projectDir,
      error: err.message,
      checks: checks.map((step) => ({ command: step.command, ok: step.ok, status: step.status })),
    });
    process.exit(1);
  }
}

main();
