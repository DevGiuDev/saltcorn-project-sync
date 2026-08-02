#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scps-package-"));
const childEnv = { ...process.env };
delete childEnv.npm_config_dry_run;
delete childEnv.NPM_CONFIG_DRY_RUN;

function packageFileFrom(output) {
  const parsed = JSON.parse(output);
  const metadata = Array.isArray(parsed)
    ? parsed[0]
    : Object.values(parsed || {}).find((entry) => entry && entry.filename);
  if (!metadata || !metadata.filename) throw new Error("npm pack did not return a package filename");
  return path.join(tempDir, metadata.filename);
}

try {
  const packOutput = execFileSync(
    npm,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", tempDir],
    { cwd: path.join(__dirname, ".."), env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const packageFile = packageFileFrom(packOutput);
  const consumerDir = path.join(tempDir, "consumer");
  fs.mkdirSync(consumerDir);
  fs.writeFileSync(path.join(consumerDir, "package.json"), '{"name":"scps-package-smoke","private":true}\n');
  execFileSync(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", packageFile],
    { cwd: consumerDir, env: childEnv, stdio: "inherit" }
  );

  const installedRoot = path.join(consumerDir, "node_modules", "saltcorn-project-sync");
  const plugin = require(installedRoot);
  assert.equal(plugin.name, "saltcorn-project-sync");
  assert.equal(plugin.sc_plugin_api_version, 1);
  assert.equal(typeof plugin.routes, "function");

  const cli = path.join(installedRoot, "bin", "saltcorn-project-sync.js");
  const help = execFileSync(node, [cli, "--help"], { cwd: consumerDir, encoding: "utf8" });
  assert.match(help, /saltcorn-project-sync/);
  assert.match(help, /doctor-live/);
  console.log(`Package smoke test passed: ${path.basename(packageFile)}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
