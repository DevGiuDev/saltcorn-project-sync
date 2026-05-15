# Dry test

Validate branch changes against a clone of the test server before pushing.

## What it does

**Phase 1 — Plan preview** (no Docker required):

1. Connects to the remote Saltcorn test instance
2. Exports its current state
3. Validates the local project
4. Computes diff: branch state vs remote state
5. Computes the plan of operations
6. Generates a Markdown report

**Phase 2 — Full Docker dry test** (optional):

1. Spins up a disposable Docker Saltcorn locally
2. Restores the remote test state into it
3. Applies the branch changes
4. Exports post-apply state for comparison
5. Computes diff: post-apply Docker vs original remote
6. Leaves Docker running for manual inspection

## Usage

```bash
# Configure remote connection
export SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn-test.example.com
export SALTCORN_PROJECT_SYNC_API_TOKEN=your-secret-token

# Switch to the branch you want to test
git checkout test

# Run both phases (plan + Docker apply)
npm run dry-test

# Or plan-only — no Docker, just diff + plan
npm run dry-test:plan
```

### Direct script usage

```bash
# Both phases
./scripts/dry-test.sh

# Plan only
./scripts/dry-test.sh --plan-only

# Keep Docker running after the test (default when test passes)
./scripts/dry-test.sh --keep-docker

# Keep temp working directory
./scripts/dry-test.sh --keep-work
```

## Output

The script creates a temp directory (printed at the end) containing:

| Path | Contents |
|---|---|
| `remote-state/` | Exported state from the remote test server |
| `docker-state-restored/` | State of Docker after restoring remote state |
| `docker-state-post-apply/` | State of Docker after applying branch changes |
| `dry-test-report.md` | Markdown report with operations, warnings, blocked ops |
| `apply-result.json` | Raw apply output |
| `restore.log` | Restore phase log |

## Docker test instance

When phase 2 runs, the Docker instance stays up for manual inspection:

- **URL**: `http://127.0.0.1:4333` (configurable via `DRY_TEST_PORT`)
- **Plugin UI**: `http://127.0.0.1:4333/project-sync`
- **Admin login**: `admin@saltcorn.local` / `admin123`

To stop it:

```bash
SCPS_DOCKER_PROJECT=scps-dry-test ./scripts/integration-docker-down.sh
```

## Limitations

- Plugins not available in the `saltcorn/saltcorn:latest` Docker image may cause partial failures during restore. This is expected and is reported as warnings.
- Secrets are redacted (`__REDACTED__`) in the export — they will be blank in the Docker clone.
- Reference data is restored; business table data is not (by design).
- UUID and other custom field types require their plugins to be available in Docker.

## CI integration

The script exits with code 0 on success, non-zero on failure. It can be used in CI:

```yaml
- run: npm run dry-test:plan
  env:
    SALTCORN_PROJECT_SYNC_BASE_URL: ${{ vars.SALTCORN_TEST_BASE_URL }}
    SALTCORN_PROJECT_SYNC_API_TOKEN: ${{ secrets.SALTCORN_TEST_API_TOKEN }}
```
