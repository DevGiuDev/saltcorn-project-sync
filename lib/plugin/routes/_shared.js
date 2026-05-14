/**
 * Common dependencies and helpers for API route modules.
 */
const fs = require("node:fs");
const path = require("node:path");

const { api, apiLocal, authorized, applyAuthorized, sendJson, requirePageAuth, requireRootTenant } = require("../auth");
const { configuredProjectRoot, getPluginConfig } = require("../config");
const {
  objectCounts, summarizeDiff, diffCount, isDestructiveOperation,
  validateApplyPayload, nativeAdapterOrError, approvalMatrix,
  loadScopeSet, filterPackByScope,
} = require("../helpers");
const { normalizePack, VERSIONED_KINDS } = require("../../normalizer");
const { loadProjectState } = require("../../project-state");
const { readJsonIfExists, pullObjectToDisk, safeFileName, writeCanonicalJson } = require("../../project-io");
const { loadChangeIntents } = require("../../change-intents");
const { planProject, ENV_POLICIES } = require("../../planner");
const { loadManifest, readSyncMeta, computeFileSyncStatus, stampSyncMeta } = require("../../manifest");
const { optionalRequire } = require("../../tenant-adapters");

/**
 * Wrapper that checks projectRoot + adapter in one shot.
 * Returns { projectRoot, adapter } on success, or { errorSent: true }
 * if an error response was already sent.
 */
async function resolveContext(res) {
  const projectRoot = configuredProjectRoot();
  if (!projectRoot) return { errorSent: true, payload: { ok: false, error: "SALTCORN_PROJECT_SYNC_PROJECT_ROOT is not configured" } };
  const adapter = await nativeAdapterOrError();
  if (adapter.error) return { errorSent: true, payload: { ok: false, adapter: "native", error: adapter.error } };
  return { projectRoot, adapter };
}

/**
 * Export live state via native adapter.
 */
async function exportLivePack() {
  const adapter = await nativeAdapterOrError();
  if (adapter.error) return { error: adapter.error };
  return { pack: normalizePack(await adapter.exportProject()) };
}

module.exports = {
  fs, path,
  api, apiLocal, authorized, applyAuthorized, sendJson, requirePageAuth, requireRootTenant,
  configuredProjectRoot, getPluginConfig,
  objectCounts, summarizeDiff, diffCount, isDestructiveOperation,
  validateApplyPayload, nativeAdapterOrError, approvalMatrix,
  loadScopeSet, filterPackByScope,
  normalizePack, VERSIONED_KINDS,
  loadProjectState, readJsonIfExists, pullObjectToDisk, safeFileName, writeCanonicalJson,
  loadChangeIntents, planProject, ENV_POLICIES,
  loadManifest, readSyncMeta, computeFileSyncStatus, stampSyncMeta,
  optionalRequire,
  resolveContext, exportLivePack,
};
