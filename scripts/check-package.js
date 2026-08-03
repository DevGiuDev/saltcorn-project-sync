#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

function packMetadata() {
  const stdout = execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) return parsed[0];
  if (parsed && parsed.name && Array.isArray(parsed.files)) return parsed;
  const entries = Object.values(parsed || {});
  return entries.find((entry) => entry && Array.isArray(entry.files));
}

const metadata = packMetadata();
if (!metadata) throw new Error("npm pack did not return package metadata");

const files = metadata.files.map((entry) => entry.path).sort();
const fileSet = new Set(files);
const required = [
  "package.json",
  "index.js",
  "bin/saltcorn-project-sync.js",
  "lib/plugin/index.js",
  "lib/plugin/deployment-ledger.js",
  "lib/tenant-adapters.js",
  "viewtemplates/project-sync-console.js",
  "scripts/install-clone-schema.js",
  "vendor/clone_schema.sql",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
];
const forbidden = [
  /^\.env(?:\.|$)/,
  /^\.github\//,
  /^AGENTS\.md$/,
  /^TODO\.md$/,
  /^test\//,
  /^examples\//,
  /^objects\//,
  /^changes\//,
  /^migrations\//,
  /^seeds\//,
  /^environments\//,
  /^docker-compose(?:\.|$)/,
  /^saltcorn\.project\.json$/,
  /^plugins\.lock\.json$/,
  /^docs\/(?:TODO|deployment-workflow-plan|mvp-plan|remaining-plan|ui-markup-migration-plan)\.md$/,
];

const missing = required.filter((file) => !fileSet.has(file));
const unexpected = files.filter((file) => forbidden.some((pattern) => pattern.test(file)));
const errors = [];
if (missing.length) errors.push(`Missing required package files: ${missing.join(", ")}`);
if (unexpected.length) errors.push(`Forbidden package files: ${unexpected.join(", ")}`);
// Phase 4/4.5 add setup, token/health/transport support and the interactive
// deployment service, UI, request store, tests excluded from npm, and operator
// documentation. Keep a tight budget around those runtime additions.
if (metadata.unpackedSize > 925_000) errors.push(`Unpacked package is too large: ${metadata.unpackedSize} bytes`);
if (errors.length) throw new Error(errors.join("\n"));

console.log(`Package check passed: ${files.length} files, ${metadata.unpackedSize} unpacked bytes.`);
