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

## Integration coverage

- [ ] Cover plan → backup → apply → refresh → convergence → history in Docker integration tests.
- [ ] Cover backup failure, apply failure, duplicate request IDs, and post-apply drift.
