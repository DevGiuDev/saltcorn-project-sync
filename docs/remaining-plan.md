# Remaining plan

This plan only lists pending work from the original objective. Already implemented items are covered in the existing docs and test project history.

## 1. Stabilize real Saltcorn integration

- Validate the native adapter against the target Saltcorn versions we want to support.
- Replace best-effort model calls with version-aware adapter methods where Saltcorn APIs differ.
- Add clearer adapter capability reporting for tables, fields, views, pages, triggers, roles, plugins, settings, and menu.
- Improve error messages when a Saltcorn model method is unavailable or behaves differently.

## 2. Complete apply coverage

- Validate and harden real apply for:
  - views
  - triggers
  - roles
  - menu
  - settings
  - plugin lock changes
- Add explicit tests for:
  - `rename_field`
  - `rename_table`
  - `alter_field_type`
  - `copy_field_data`
  - reference data upsert against real tenant rows
- Keep the current safety rule: missing objects in Git must not imply automatic delete/drop.

## 3. Backup and rollback integration

- Replace command-hook-only backup with real Saltcorn backup/snapshot integration where available.
- Make `test` and `prod` apply require verifiable backup metadata.
- Add restore smoke tests against a disposable tenant/database.
- Record rollback deployments distinctly from normal deployments.

## 4. Live doctor and environment checks

- Add a first-class `doctor-live` command.
- Include checks for:
  - REST/plugin reachability
  - adapter capabilities
  - Saltcorn version
  - required plugins
  - Postgres sequence health for copied databases
  - token/auth configuration
- Move local sequence check scripts into reusable CLI functionality where appropriate.

## 5. Improve project format fidelity

- Normalize Saltcorn views/pages/triggers more semantically.
- Resolve tenant-local IDs to stable names before stripping them.
- Reduce noisy diffs from generated/default Saltcorn metadata.
- Decide how menu/settings should be represented long-term.
- Document unsupported or partially supported Saltcorn object shapes.

## 6. UI inside Saltcorn

- Build a real Saltcorn UI beyond the current status page:
  - project status
  - live diff
  - plan preview
  - warning/blocker display
  - deployment history
  - approval controls for dev/test/prod
- Keep Git operations in the CLI unless a secure server-side project root is explicitly configured.

## 7. Integration test suite

- Add automated smoke tests using a disposable Saltcorn instance and database.
- Cover:
  - export
  - diff
  - plan
  - apply non-destructive changes
  - orphan preservation
  - explicit destructive intent
  - rollback/restore when available
- Keep unit tests independent from a real Saltcorn runtime.

## 8. CI/CD hardening

- Keep lightweight unit/lint CI on GitHub.
- Add optional integration CI only when Saltcorn services are available.
- Produce machine-readable preflight output for deployment pipelines.
- Document recommended dev/test/prod pipeline gates.

## 9. Packaging and installation

- Document local plugin install, Git install, and eventual npm package install.
- Decide package naming/versioning strategy.
- Add release checklist.
- Validate plugin loading on a clean Saltcorn install.

## 10. Production safety review

- Review all destructive operations and required intents.
- Review secret redaction coverage.
- Review tenant data exclusions.
- Review backup/restore guarantees.
- Document known limitations before production use.
