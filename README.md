# Saltcorn Project Sync

Git-backed application versioning and safe deployment for Saltcorn tenants.

Supported Saltcorn versions: **1.6.0 and newer**.

> Status: early scaffold / MVP design. The current code defines the project format, canonical JSON tools, diff/planning primitives, CLI skeleton, and Saltcorn plugin entrypoint.

## Goal

Manage a Saltcorn app like a versioned project: export selected objects, review Git diffs, pull/apply changes in another tenant, preserve data by default, and require explicit intent for destructive operations.

## Core principle

Project object JSON is **state-based**: it describes the desired final app state.

Dangerous changes are **intent-based**: deleting or renaming schema/data-bearing objects must be authorized by explicit change intents.

A field absent from Git is **not** automatically a `DROP COLUMN`. It is detected as drift/orphaned and preserved unless a change intent says otherwise.

## MVP scope

Versioned objects:

- Tables
- Fields
- Views
- Pages
- Triggers
- Required plugins
- Basic roles
- Menu/settings files when explicitly exported
- Project manifest

Initial compatibility can use Saltcorn packs/snapshots as source material, then normalize to deterministic JSON.

## Repository format

```text
saltcorn.project.json
plugins.lock.json
objects/
  tables/
  views/
  pages/
  triggers/
  roles/
  menu/
  settings/
  data/
    reference_tables/
environments/
  local.json
  dev.json
  test.json
  prod.json
changes/
seeds/
migrations/
```

## CLI

```bash
saltcorn-project-sync init
saltcorn-project-sync init --git
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync import-pack --pack saltcorn-pack.json
saltcorn-project-sync import-reference --table countries --key code --rows countries.json
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync report --env prod --backup --tenant-export tenant.json --out deploy-report.md
saltcorn-project-sync preflight --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply-file --env dev --tenant-export tenant.json --out applied.json
saltcorn-project-sync backup --env prod
saltcorn-project-sync export --out .
saltcorn-project-sync apply --env dev
```

Direct Saltcorn export/apply is adapter-backed. The included `command` adapter delegates to environment-configured commands, so deployments can integrate with existing Saltcorn pack/snapshot scripts. A conservative `native` adapter can use `@saltcorn/data` models when running inside a configured Saltcorn runtime.

## Testing

### Unit tests

```bash
npm test
```

Runs the Node test suite. No Saltcorn, Docker, or network required. Tests that depend on `@saltcorn/data` (native adapter) are skipped when the module is not available.

### Integration smoke test

```bash
npm run test:integration
```

Runs a smoke test against a running Saltcorn instance via REST. Requires environment variables:

```bash
export SALTCORN_PROJECT_SYNC_ADAPTER=rest
export SALTCORN_PROJECT_SYNC_BASE_URL=http://127.0.0.1:3333
export SALTCORN_PROJECT_SYNC_API_TOKEN=scps-docker-token
export SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1
```

Exits with `skipped: true` when `SALTCORN_PROJECT_SYNC_BASE_URL` is not set — safe to include in CI.

### Full Docker integration test

```bash
npm run test:integration:docker
```

Spins up a disposable Saltcorn + Postgres stack, runs both test phases, and tears everything down:

- **Phase 1** — bare plugin smoke: creates a temp project, runs export, check-live, doctor-live, validate, diff, plan, apply-file, and live apply against the clean Docker instance.
- **Phase 2** — project smoke: runs validate, check-live, export, apply, post-apply export, seeds and migrations against the `examples/` project mounted into Docker.

Individual Docker commands:

```bash
npm run test:integration:docker:up     # start stack only
npm run test:integration:docker:down   # stop and remove volumes
```

## Local testing environments

All scripts use the Docker project name `scps-integration` and port `3333` by default.

### Clean Saltcorn (no project)

```bash
mkdir -p /tmp/empty-project
SCPS_PROJECT_HOST_DIR=/tmp/empty-project ./scripts/integration-docker-up.sh
# → http://127.0.0.1:3333  (empty Saltcorn with plugin installed)

# Use it
export SALTCORN_PROJECT_SYNC_ADAPTER=rest
export SALTCORN_PROJECT_SYNC_BASE_URL=http://127.0.0.1:3333
export SALTCORN_PROJECT_SYNC_API_TOKEN=scps-docker-token
saltcorn-project-sync doctor-live --adapter rest

# Tear down
./scripts/integration-docker-down.sh
```

### Saltcorn with the example project

```bash
./scripts/integration-docker-up.sh    # defaults to examples/
# → http://127.0.0.1:3333  (Saltcorn with contacts/messages tables, roles, settings)

# Tear down
./scripts/integration-docker-down.sh
```

### Custom project

```bash
SCPS_PROJECT_HOST_DIR=/path/to/my-project ./scripts/integration-docker-up.sh
# → http://127.0.0.1:3333  (Saltcorn with your project mounted at /project)
```

## Dry test before pushing

Validates branch changes against a clone of the remote test server before pushing. Two phases:

**Phase 1 — Plan preview** (no Docker): exports remote state, computes diff + plan, generates a report.

**Phase 2 — Full Docker dry test**: spins up local Docker, restores remote state, applies branch changes, leaves Docker running for manual inspection.

```bash
export SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn-test.example.com
export SALTCORN_PROJECT_SYNC_API_TOKEN=your-secret-token

git checkout test

# Both phases (plan + Docker apply)
npm run dry-test

# Plan only — fast, no Docker needed
npm run dry-test:plan
```

Options:

```bash
./scripts/dry-test.sh --plan-only     # only diff + plan
./scripts/dry-test.sh --keep-docker   # leave Docker running
./scripts/dry-test.sh --keep-work     # preserve temp working directory
```

Output files are stored in a temp directory (printed at the end):

| Path | Contents |
|---|---|
| `remote-state/` | Exported state from the remote test server |
| `docker-state-restored/` | Docker state after restoring remote state |
| `docker-state-post-apply/` | Docker state after applying branch changes |
| `dry-test-report.md` | Markdown report with operations, warnings, blocked ops |
| `apply-result.json` | Raw apply output |

When phase 2 succeeds, the Docker instance stays up for manual inspection at `http://127.0.0.1:4333` (configurable via `DRY_TEST_PORT`). To stop it:

```bash
SCPS_DOCKER_PROJECT=scps-dry-test ./scripts/integration-docker-down.sh
```

See [docs/dry-test.md](docs/dry-test.md) for full documentation.

## Authentication for remote deployments

The REST adapter authenticates via a shared Bearer token between the CLI/runner and the Saltcorn plugin.

**Saltcorn server side** — set in the Saltcorn process environment:

```bash
SALTCORN_PROJECT_SYNC_API_TOKEN=<strong-random-token>
```

**Runner / CLI side** — pass via environment variables or GitHub Actions secrets:

```bash
SALTCORN_PROJECT_SYNC_ADAPTER=rest
SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn-test.example.com
SALTCORN_PROJECT_SYNC_API_TOKEN=<same-token>
```

The CLI sends `Authorization: Bearer <token>` on every request. The plugin rejects requests without a matching token (401) and refuses apply without token configured (403).

**Required for production**: HTTPS on the Saltcorn server. The token travels in every request header.

## CI/CD integration

```yaml
# Plan-only check in CI (fast, no Docker)
- run: npm run dry-test:plan
  env:
    SALTCORN_PROJECT_SYNC_BASE_URL: ${{ vars.SALTCORN_TEST_BASE_URL }}
    SALTCORN_PROJECT_SYNC_API_TOKEN: ${{ secrets.SALTCORN_TEST_API_TOKEN }}
```

```yaml
# Full validation pipeline
- run: npm test
- run: npm run lint
- run: npm run test:integration:docker
```

## Example project

The `examples/` directory contains a complete, self-contained project used by the Docker integration tests:

- **Tables**: `contacts` (6 fields), `messages` (6 fields)
- **Roles**: admin, public, staff, user
- **Settings**: site name
- **Reference data**: `countries` (9 rows)
- **Seeds**: demo contacts
- **Migrations**: add-priority-to-messages
- **Change intents**: rename-subject-to-title

This project is the default for `integration-docker-up.sh` and Phase 2 of the integration test.

## Safety defaults

- Preserve unexpected tenant fields/tables/data.
- Mark missing-in-Git tenant objects as orphaned/drift.
- Block ambiguous destructive changes.
- Require explicit `changes/*.json` intents for drops/renames in test/prod.
- Require backup/snapshot before prod apply.

## Documentation

- [Architecture](docs/architecture.md)
- [Project format](docs/project-format.md)
- [Normalization](docs/normalization.md)
- [Change intents](docs/change-intents.md)
- [Dangerous changes](docs/dangerous-changes.md)
- [Safety model](docs/safety-model.md)
- [CLI](docs/cli.md)
- [Native adapter](docs/native-adapter.md)
- [REST adapter](docs/rest-adapter.md)
- [Plugin REST API](docs/plugin-api.md)
- [Reference data](docs/reference-data.md)
- [CI/CD](docs/ci-cd.md)
- [Compatibility](docs/compatibility.md)
- [Rollback](docs/rollback.md)
- [Dry test](docs/dry-test.md)
- [Docker integration](docs/integration-docker.md)
- [MVP plan](docs/mvp-plan.md)
- [Remaining plan](docs/remaining-plan.md)
