# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 - 2026-08-02

### Added

- `plan-live`: export live state and compute a plan directly through the
  selected adapter, without a manually generated `--tenant-export` file.
- `verify-live`: scriptable post-apply convergence check reusing the plugin's
  live-diff semantics; exits non-zero when real drift is detected and treats
  tenant-only objects as preserved orphans, never as drift.

### Changed

- `apply` now prints a compact deployment receipt by default (status,
  deployment ID, version, commit, operation/warning counts, minimal backup
  receipt, and whether Saltcorn state was refreshed) instead of the complete
  plan and resulting project state. Add `--full-output` to restore the
  previous full output.

## 0.2.0 - 2026-08-02

### Added

- Authoritative target-side deployment ledger with sanitized, idempotent REST
  list/detail/write endpoints.
- Deployment receipts for project/version/commit, operation and warning
  summaries, backup evidence, status, rollback relation, and convergence.
- Target-backed Deployments panel with explicit local-cache fallback.

### Fixed

- Redact credentials from Git output and remote URLs.
- Preserve quoted commit messages and return actionable noninteractive Git
  authentication errors.
- Reject credentials embedded in Git remote URLs.

## 0.1.1 - 2026-08-02

### Fixed

- Correct Saltcorn npm installation instructions: Saltcorn 1.6/1.7 requires a
  bare package name and does not accept `package@version` in `--npm`.
- Document registry-version verification and the pinned Git rollback path.

## 0.1.0 - 2026-08-02

Initial public preview.

### Added

- Deterministic export of Saltcorn tables, fields, views, pages, triggers, roles, plugins, menu, stable settings, and reference data.
- Git-backed project scopes, live diff, plan previews, branch-to-tenant workflows, and project health views.
- Companion CLI with command, native, and authenticated REST adapters.
- Non-destructive planning that preserves tenant-only objects by default.
- Explicit change intents for destructive schema operations.
- Required backup gates for test and production applies.
- Post-apply Saltcorn state refresh and deployment receipt metadata.
- PostgreSQL sequence checks, seed files, migrations, rollback records, and Docker integration coverage.

### Safety

- Absence from Git never authorizes an implicit drop.
- Secret-like and environment-specific settings are excluded from project exports.
- Production and test applies require verifiable backup metadata.

### Known limitations

- REST deployment still requires several manual CLI steps; one-command deployment is planned.
- The Deployments panel does not yet use an authoritative target-side ledger.
- Backup/restore tooling must be matched and validated for each target PostgreSQL version.
