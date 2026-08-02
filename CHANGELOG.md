# Changelog

All notable changes to this project will be documented in this file.

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
