# CI/CD

Saltcorn Project Sync is designed so Git hosts can validate and promote app changes.

## Validation pipeline

Recommended checks:

```bash
npm test
npm run lint
npm run test:integration  # skips when live Saltcorn env is not configured
npm run test:integration:docker  # optional disposable Saltcorn/Postgres stack
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync preflight --env test --backup --tenant-export tenant-export.json
```

## Promotion flow

1. Developers export local/dev tenant changes to project JSON.
2. Commit and open pull request.
3. CI runs syntax/tests/project validation and optional live integration smoke tests when Saltcorn services are configured.
4. Merge to integration branch.
5. Deployment job runs `git pull`, creates backup, runs plan, then apply.
6. Deployment record is written with commit, environment, operation count, warnings, and backup metadata.

## Optional integration smoke tests

`npm run test:integration` is safe to include in CI. It prints machine-readable JSON and exits successfully with `skipped: true` when no live Saltcorn URL is configured.

Configure these variables to enable it:

```bash
SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn.example.com
SALTCORN_PROJECT_SYNC_API_TOKEN=...
SALTCORN_PROJECT_SYNC_ADAPTER=rest
```

The smoke test covers live export, `doctor-live`, project validation, diff, plan, and file apply against a temporary project checkout. Guarded live apply is disabled by default; enable it only for disposable tenants:

```bash
SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1 npm run test:integration
```

## Disposable Docker integration

For destructive or clean-install checks, run the Docker-backed integration stack:

```bash
npm run test:integration:docker
```

It starts `saltcorn/saltcorn:latest` plus Postgres, resets the schema, installs this plugin from the local checkout, runs REST smoke checks, and tears the stack down. See `docs/integration-docker.md`.

## Production gate

Production deploys should require:

- clean Git checkout
- validated manifest
- validated change intents
- dependency check with no missing dependencies
- backup/snapshot metadata
- no blocked operations in plan
- human approval for destructive intents
