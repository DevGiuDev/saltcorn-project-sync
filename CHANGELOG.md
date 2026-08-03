# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed

- Treat tenant objects without a persisted scope row as pending and unchecked;
  the Scope view now explains and highlights the required save decision.
- Warn before leaving Scope with unsaved checkbox changes and show a pending
  count for newly detected objects.
- Share the dark ink/cyan panel-header palette across project pages, including
  Git, Deploy, Live Diff, Settings and nested diff panels.
- Highlight pending pushes, optionally push immediately after a UI commit, and
  record portable deployment scope from staged project objects.
- Recognize an object file introduced by the selected legacy commit as an
  explicit scope addition while keeping earlier unmanaged Git objects excluded.
- Limit UI scope recording to the object files staged in that commit, preserving
  older legacy Git objects until they are explicitly selected.

## 0.5.0 - 2026-08-03

### Added

- Add full, workspace and deployment-server interface roles so target servers
  can expose a focused Deploy/Settings workflow without Git authoring tools.
- Offer configured branches, remote branches, tags and recent commits as safe
  deployment source choices instead of requiring free-text refs.

### Changed

- Redesign Git as a three-pane client with branches, grouped stage/unstage,
  commit composition, remote controls and compact history.
- Present the configured deployment source and target as explained defaults;
  alternate refs and environments are selected from known values.
- Fast-forward a clean matching target checkout after fetch so Live Diff and
  Deploy use the same committed files. Dirty or divergent trees are preserved
  and block automatic synchronization.
- Make manual Git pulls fast-forward-only.

## 0.4.8 - 2026-08-03

### Fixed

- Keep the target allowlist fully authoritative for legacy manifests. Tenant
  absence is not treated as proof that an excluded Git object is newly desired;
  a full export writes the unambiguous portable scope used by future deploys.

### Changed

- Refresh `origin` automatically before every UI deployment preview; Generate
  no longer depends on a manual pull of the VPS working tree.

## 0.4.7 - 2026-08-03

### Changed

- Version deployment scope explicitly in the project manifest. Legacy projects
  infer only Git objects missing from the live tenant, preserving deliberate
  target exclusions for already-existing objects.
- Refresh `origin` automatically before every UI deployment preview; the UI no
  longer requires or exposes a manual fetch toggle.

## 0.4.6 - 2026-08-03

### Changed

- Treat object files in the selected Git commit as the authoritative desired
  deployment scope, while retaining tenant-local scope for export and drift
  observation.
- Show target scope additions directly in Deploy, bind them into the reviewed
  plan digest, and persist them after successful convergence.

## 0.4.5 - 2026-08-03

### Fixed

- Use static same-origin UI confirmation and cancellation endpoints so
  Saltcorn's literal-prefix `noCsrf` lookup does not reject parameterized
  deployment request URLs.
- Report non-JSON server responses with an actionable UI error instead of
  exposing a browser `JSON.parse` exception.

## 0.4.4 - 2026-08-03

### Fixed

- Materialize immutable UI deployment sources with `git archive` instead of a
  shared local clone. This avoids the child `upload-pack` ownership check that
  still rejected Docker-mounted repositories after command-scoped
  `safe.directory` configuration.

## 0.4.3 - 2026-08-03

### Fixed

- Allow the UI deployment checkout to read a configured repository owned by a
  different VPS user by scoping Git `safe.directory` to that repository and
  its Git directory for each command, without changing global Git config.

## 0.4.2 - 2026-08-03

### Added

- Interactive project-scoped deployment UI with immutable Git previews,
  digest-bound confirmation, target locking, backup/apply/refresh/verify
  progress, and authoritative receipts.
- Environment-aware optional/required backup policy and command-provider
  diagnostics without persisting command bodies or credentials.
- Deployment request storage, stale-plan revalidation, tenant identity checks,
  and shared UI/REST apply locking.

## 0.4.1 - 2026-08-03

### Fixed

- `verify-live` and the `deploy` convergence check now use the plugin's
  `/api/live-diff` as the source of truth (via a new `restAdapter.liveDiff`), so
  they apply the project scope and agree with `plan` and `check-convergence`.
  They previously recomputed without scope and reported false drift on real
  projects that carry tenant-only objects.
- `deploy` now records a unique target-side `deployment_id`
  (`deploy-NNNNNN-<UTCstamp>`) when no `--request-id` is given, so a fresh
  checkout no longer collides (`409`) with backfilled or prior ledger rows.

## 0.4.0 - 2026-08-02

### Added

- `deploy --env <env>`: one-command deployment orchestration chaining connect,
  compatibility check, live export and plan, a compact plan summary,
  interactive confirmation (or `--yes` for CI), backup creation and
  verification, apply, Saltcorn state refresh, automatic post-apply
  convergence verification, local deployment recording, and idempotent
  target-side ledger recording.
- `--request-id` for `deploy`: an explicit, caller-chosen idempotency key so a
  retried deployment attempt reuses the same target ledger row instead of
  being rejected as a conflicting request.

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
