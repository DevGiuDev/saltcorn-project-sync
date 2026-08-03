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
5. Deployment job checks out the exact merge commit and runs one guarded deploy command.
6. Deployment record is written with commit, environment, operation count, warnings, and backup metadata.

## Optional integration smoke tests

`npm run test:integration` is safe to include in CI. It prints machine-readable JSON and exits successfully with `skipped: true` when no live Saltcorn URL is configured.

Configure these variables to enable it:

```bash
SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn.example.com
SALTCORN_PROJECT_SYNC_API_TOKEN=...
SALTCORN_PROJECT_SYNC_ADAPTER=rest
```

Prefer a committed non-secret environment profile plus CI-managed secrets. The
profile below describes the remote **test target**, even though the job runs
from a CI checkout:

```json
{
  "adapter": "rest",
  "base_url": "https://saltcorn.example.com",
  "environment": "test",
  "token_env": "PROJECT_SYNC_TEST_TOKEN",
  "transport": "direct"
}
```

Store `PROJECT_SYNC_TEST_TOKEN` in the CI provider's encrypted secret store. Generate and rotate it from the plugin setup page; verify the replacement with `doctor-live --env test` before revoking the old token. Never print the variable or enable shell tracing around deployment commands. See [Environment setup and precedence](environment-configuration.md).

The deploy step should pass a stable idempotency key from the CI provider:

```bash
saltcorn-project-sync deploy --adapter rest --env test --yes --request-id "$CI_PIPELINE_ID-$CI_JOB_ID"
```

The target enforces the same project/environment apply lock as the UI. A push
pipeline therefore cannot mutate the tenant concurrently with a deployment
that an administrator confirmed in the browser.

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

## npm release (trusted publishing)

Releases are published to npm from tagged commits via the
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) workflow,
using npm trusted publishing (GitHub Actions OIDC). No long-lived npm token
is stored as a repository secret: the npm registry exchanges this workflow's
OIDC token for short-lived publish credentials.

Prerequisites, configured once on the npm side:

- the package `saltcorn-project-sync` has this repository and the workflow
  path `.github/workflows/publish.yml` registered as a trusted publisher;
- if an npm *environment* was specified during registration, the same
  `environment:` name must be added to the `publish` job.

The release flow is therefore:

1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. Tag the commit: `git tag -a v<version> -m "Release <version>"` and push the tag.
3. The `Publish` workflow runs `release:check:full` (lint, unit tests, package
   checks, and a disposable Saltcorn/Postgres package smoke), verifies the tag
   matches `package.json`, then runs `npm publish --provenance --access public`.

`workflow_dispatch` with `dry_run=true` runs every gate and packs the tarball
without uploading, which is useful for validating trusted-publishing wiring
before cutting a real tag.

## Production gate

Production deploys should require:

- clean Git checkout
- validated manifest
- validated change intents
- dependency check with no missing dependencies
- backup/snapshot metadata
- no blocked operations in plan
- human approval for destructive intents
