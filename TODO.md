# TODO

## Deployment workflow — priority

See [`docs/deployment-workflow-plan.md`](docs/deployment-workflow-plan.md).

- [ ] Add `plan-live` to export and plan directly through the selected adapter.
- [ ] Add one-command `deploy --env <env>` orchestration.
- [ ] Add automatic post-apply convergence verification.
- [ ] Add non-secret environment profiles and managed transport configuration.
- [ ] Add backup client/server compatibility checks to `doctor-live`.

## CLI output

- [ ] Make `apply` output compact by default.
  - Include success/error status, operation and warning summaries, backup receipt, deployment ID, and adapter result.
  - Omit the full resulting project state from the default response.
  - Add an explicit `--full-output` option for callers that need the complete state JSON.

## Deployment history

- [ ] Replace the server panel's local-file-only history with an authoritative target-side deployment ledger.
  - Persist sanitized success and failure records in a plugin-owned Saltcorn database table.
  - Record project/version/commit, environment, operation summary, backup receipt, status, and convergence result.
  - Add idempotent REST list/detail/write support.
  - Keep local JSON only as an optional client cache.
- [ ] Backfill the successful BuyApp `deploy-000001` deployment after the target ledger is available.
- [ ] Update the Deployments panel to display target records, backup details, failures, and convergence status.

## UI-first setup and configuration

- [ ] Make a normal synchronization environment configurable from the Saltcorn plugin UI with minimal local file editing.
  - Configure project root/repository, environment, adapter, base URL, branch/tenant mapping, and transport.
  - Configure or select backup/restore hooks and validate them from the UI.
  - Add a setup wizard with connection, repository, backup, and permissions health checks.
  - Define clear precedence between project UI configuration, environment profiles, and process environment variables.
  - Never export synchronization credentials or operational configuration into project JSON.
  - Use masked/encrypted or reference-based secret handling; do not persist plaintext tokens in Git, logs, deployment history, or ordinary settings.
  - Support token generation, one-time display, rotation, and revocation from the UI where secure storage is available.

## Packaging and distribution — milestone 0

- [x] Publish `saltcorn-project-sync` to the npm registry.
  - [x] Add a strict package file allowlist and `prepublishOnly` validation.
  - [x] Test the packed artifact in a clean Node installation.
  - [x] Test installation from the packed artifact in a disposable Saltcorn tenant.
  - [x] Keep the companion CLI available as `saltcorn-project-sync` and `sc-project-sync`.
  - [x] Publish version `0.1.0` from a tagged commit.
  - [ ] Configure npm provenance/trusted publishing for subsequent releases.
- [x] Migrate the VPS from a local-directory install to verified npm release `0.1.1`, retain the local checkout, and exercise rollback plus roll-forward.
- [ ] Register and validate the npm package in the Saltcorn Module Store so administrators can install it from Saltcorn without cloning a repository. **Blocked on user action:** email Rom with the npm package details and request store registration.
- [ ] Document upgrades, compatibility, rollback, release cadence, and pinned-version production installs.

## Integration coverage

- [ ] Cover plan → backup → apply → refresh → convergence → history in Docker integration tests.
- [ ] Cover backup failure, apply failure, duplicate request IDs, and post-apply drift.
- [ ] Test the UI setup wizard without hand-edited synchronization files.
- [ ] Test the packed npm artifact and Module Store installation path on a clean tenant.
