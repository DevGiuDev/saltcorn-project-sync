# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## 0.6.0 - 2026-08-04

### Added

- Human-readable `doctor-live`, `plan-live`, and `deploy` output through
  `--format human`, with `--human` as a convenience alias; canonical JSON
  remains the default for automation.
- Versioned migrations and seeds with deployment phases (`pre-deploy`,
  `post-deploy`, `manual`) so data-normalization and transformation scripts
  run automatically at the right point of a deploy.
- Migration ledger (`_sc_ps_migrations_applied`) tracking which `run: "once"`
  migrations have been applied per project and environment, so side-effecting
  migrations (`raw_sql` `UPDATE`, index creation, data backfills) never
  re-execute.
- Transactional `raw_sql` execution in the native adapter (`BEGIN`/`COMMIT`
  with automatic rollback), enabling safe in-process data transformations.
- `bootstrap` CLI command that applies project structure, seeds, and
  migrations additively to a fresh server without resetting the schema.
- Deploy hooks (`--no-hooks`, `--skip-seeds`, `--skip-migrations`) integrating
  pre/post-deploy seeds and migrations into the `deploy` pipeline.
- Data tab in the project workspace UI: a full manager to create, edit,
  validate, and delete migration and seed files from templates, with ledger
  status (applied/pending/failed) per environment.
- Redesign the Data tab as a first-class editor: fixed controls (combos for
  phase, run, mode), a step editor with add/remove/reorder, SQL syntax
  highlighting via Saltcorn's Monaco editor, guided wizards with table/field
  dropdowns (copy field, create index, transform data, add field, master
  data, clear table), a raw-JSON tab, and two blocks separating single-
  execution (once) from recurring (always) scripts.

### Changed

- Make deployment environment names project-defined: REST backup/apply now
  require the incoming project slug and environment to match an operational
  environment explicitly saved in the target plugin, while target-side backup
  policy remains authoritative.
- Add newly detected tenant objects to project scope automatically, retaining
  the automatic exclusion policy for development-only objects.
- Share the dark ink/cyan panel-header palette across project pages, including
  Git, Deploy, Live Diff, Settings and nested diff panels.
- Highlight pending pushes, optionally push immediately after a UI commit, and
  update portable deployment scope automatically from staged project objects.
- Recognize an object file introduced by the selected legacy commit as an
  explicit scope addition while keeping earlier unmanaged Git objects excluded.
- Limit automatic portable-scope updates to object files staged in that commit,
  preserving older legacy Git objects until they are explicitly changed.

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
