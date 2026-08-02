# Deployment workflow and remote history plan

## Problem

The first real REST deployment proved the core safety model, but required too
many manual steps: an SSH tunnel, token loading, a custom Node export snippet,
plan generation, apply, and a second export/plan for convergence.

`apply` also prints the complete resulting project state. This makes successful
output extremely large while omitting the backup receipt from the concise part
of the response.

The Deployments panel is only partially implemented for distributed REST use.
The CLI currently writes `.saltcorn-project-sync/deployments.json` on the
machine running the CLI, while the panel reads that file from the Saltcorn
server's mounted project root. A remote apply is therefore recorded locally but
is not visible on the target tenant.

## Target experience

The routine workflow should be:

```bash
sc-project-sync deploy --env test
```

The command should:

1. load a non-secret environment profile;
2. connect to the configured tenant;
3. run compatibility and backup preflight checks;
4. export live state and calculate the plan;
5. show a compact operation summary;
6. request confirmation unless `--yes` is present;
7. create and verify a real backup;
8. apply the approved plan;
9. refresh Saltcorn state;
10. verify zero post-apply drift;
11. persist an authoritative deployment record on the target;
12. print a compact deployment receipt.

## Authoritative deployment history

Deployment history must live on the target tenant, not only beside the client
checkout.

Add a plugin-owned `_sc_ps_deployments` table. Records should include:

- stable deployment/request ID for idempotency;
- project slug and project version;
- environment;
- Git commit SHA;
- source (`cli`, `ci`, or `ui`);
- status (`started`, `backup_failed`, `apply_failed`, `applied`, `drifted`);
- start and finish timestamps;
- safe/destructive operation counts and sanitized operation summaries;
- warning summaries;
- backup ID, creation time, path, and SHA-256 receipt;
- sanitized adapter result and failure message;
- convergence result.

Never persist the complete desired/actual project state, API tokens, database
URLs, credentials, or secret setting values in deployment history.

The authenticated REST API should expose target-side list/detail endpoints, and
the Deployments panel should read those endpoints/table records. Local JSON may
remain as an optional client cache, but must not be the authoritative source.

The successful BuyApp test deployment already stored locally as
`deploy-000001` should be backfilled after the target-side ledger is available.
It applied `create_field test_tabla.sync_test_note` with backup
`buyapp-test-20260802T180412Z` and must appear as the first real deployment.

## Delivery phases

### Milestone 0 — npm bootstrap release

Before changing the deployment protocol, publish the current tested baseline as
`saltcorn-project-sync@0.1.0`. Validate the packed artifact in clean Node and
Saltcorn environments, migrate the VPS from its local-directory install to the
pinned npm package, and prove rollback to the previous local install. This
makes every later phase independently versioned and easy to deploy remotely.

Saltcorn Module Store registration follows the npm release and may continue in
parallel if store review is external.

### Phase 1 — Compact and direct live commands

- Add `plan-live --adapter rest --env <env>`.
- Make `apply` output compact by default.
- Include backup metadata and deployment ID in successful output.
- Add `--full-output` for callers that explicitly need complete state.
- Add `verify-live` or equivalent post-apply convergence command.

### Phase 2 — Target-side deployment ledger

- Create `_sc_ps_deployments` idempotently.
- Extend REST apply metadata with project slug/version, commit, source, and a
  client-generated request ID.
- Persist success and failure records on the target.
- Return the target deployment record in the REST response.
- Refactor the Deployments renderer to consume target records and show backup
  and convergence details.
- Add an authenticated backfill/import path for existing trusted local records.

### Phase 3 — One-command deploy orchestration

- Add `deploy --env <env>`.
- Chain plan, confirmation, backup, apply, refresh, convergence, and recording.
- Refuse destructive operations without explicit intent and the existing
  destructive approval flag.
- Support `--yes` for CI and preserve interactive confirmation by default.
- Return non-zero exit codes for backup, apply, refresh, or convergence failure.

### Phase 4 — UI-first environment configuration and transport

- Add a project setup wizard in the Saltcorn UI so a normal environment can be
  prepared without hand-editing synchronization files.
- Configure project root/repository, environment, adapter, base URL,
  branch/tenant mapping, transport, and backup/restore hooks from project
  settings.
- Add connection, repository, permission, and backup health checks with a
  clear ready/not-ready result.
- Define and display precedence between project UI configuration,
  `environments/<env>.json`, and process environment variables.
- Extend environment profiles with non-secret adapter/base URL/transport
  settings.
- Keep secrets out of project JSON. Use masked/encrypted storage or references
  to environment variables/secret managers, depending on runtime support.
- Support token generation, one-time display, rotation, and revocation without
  writing tokens to logs or deployment history.
- Support direct HTTPS and an optional managed SSH tunnel transport so users do
  not manually open tunnels.
- Document CI usage and token rotation.

### Phase 5 — Backup diagnostics and integration coverage

- Add backup-tool availability/version diagnostics to `doctor-live`.
- Fail preflight clearly when the backup client cannot support the server.
- Add Docker integration coverage for plan → backup → apply → convergence →
  target deployment record.
- Test backup failure, apply failure, duplicate request ID, and post-apply drift.
- Test setup from the UI without hand-edited synchronization files.

### Phase 6 — Distribution hardening and Module Store

- Configure npm provenance/trusted publishing for releases after the initial
  bootstrap publication.
- Register and test the package in the Saltcorn Module Store so administrators
  can install and upgrade it from Saltcorn without cloning the repository.
- Automate signed/tagged releases, release notes, compatibility checks, and
  package installation tests.
- Document pinned production installs, upgrades, rollback, compatibility, and
  the release cadence.

## Acceptance criteria

- A routine safe deployment requires one command and at most one confirmation.
- No custom Node snippets are required.
- A successful command prints a short receipt, not the full project state.
- Every target mutation has a verifiable backup receipt.
- Every successful or failed deployment attempt is visible in the target
  Deployments panel.
- Repeating a request ID cannot duplicate mutations or history records.
- Post-apply convergence is automatic and must be visible in history.
- Environment-specific settings such as `base_url` remain preserved without
  blocking deployment.
- A standard environment can be configured and validated from the plugin UI
  without manually editing synchronization files.
- The plugin can be installed from the Saltcorn Module Store and the CLI can be
  installed from the same tested npm release.
