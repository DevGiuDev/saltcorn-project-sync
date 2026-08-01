# Docker integration environment

The Docker integration stack creates a disposable Saltcorn + Postgres environment for destructive tests, CI smoke tests, and clean-install validation.

It uses:

- `saltcorn/saltcorn:1.6.1` by default, matching the supported Saltcorn line; release validation may override `SCPS_SALTCORN_IMAGE` with another pinned tag or digest.
- `postgres:16-alpine`.
- This plugin repo mounted at `/plugin`.
- The Saltcorn project at `SCPS_PROJECT_HOST_DIR` mounted at `/project`.
- The `uuid-type` plugin installed for project compatibility.

## What the test does

**Phase 1 — Plugin smoke test:**
- Creates a bare project in `/tmp`.
- Runs export, check-live, doctor-live, validate, diff, plan, apply-file, and live apply against the clean Saltcorn via REST.
- Verifies a protected `env=test` apply can cross the REST backup gate using disposable backup metadata supplied by the Docker stack.

**Phase 2 — Project smoke test:**
- Runs from the actual Saltcorn project directory (`test-project-sync`).
- Validates the project including seeds and migrations.
- Exports live state, computes diff and plan.
- Applies the complete project against the clean tenant and fails if any planned operation is skipped or unsupported.
- Verifies post-apply export works and a second apply converges to a zero-operation plan.
- Lists seeds and migrations.

## Commands

```bash
npm run test:integration:docker
npm run test:integration:docker:up
npm run test:integration:docker:down
```

`test:integration:docker` runs both phases and tears the stack down.

## Manual use

```bash
npm run test:integration:docker:up

export SALTCORN_PROJECT_SYNC_ADAPTER=rest
export SALTCORN_PROJECT_SYNC_BASE_URL=http://127.0.0.1:3333
export SALTCORN_PROJECT_SYNC_API_TOKEN=scps-docker-token
export SALTCORN_PROJECT_SYNC_INTEGRATION_APPLY=1

# Phase 1
npm run test:integration

# Phase 2 — apply the project
cd ~/dev/test-project-sync
saltcorn-project-sync apply --adapter rest --env dev

npm run test:integration:docker:down
```

Open the plugin UI at:

```text
http://127.0.0.1:3333/project-sync
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCPS_SALTCORN_IMAGE` | `saltcorn/saltcorn:1.6.1` | Saltcorn Docker image; pin a digest for release validation. |
| `SCPS_SALTCORN_VERSION` | auto-detected | Optional override for the Saltcorn version reported to compatibility checks. |
| `SCPS_SALTCORN_PORT` | `3333` | Host port mapped to container port `3000`. |
| `SALTCORN_PROJECT_SYNC_API_TOKEN` | `scps-docker-token` | Bearer token for plugin REST endpoints. |
| `SALTCORN_PROJECT_SYNC_BACKUP_CMD` | disposable JSON receipt | Test-only backup hook used to exercise the `test` environment gate; it is not a real backup. |
| `SCPS_PROJECT_HOST_DIR` | `./examples` | Host path to the Saltcorn project to mount and test. |
| `SCPS_POSTGRES_USER` | `postgres` | Postgres user. |
| `SCPS_POSTGRES_PASSWORD` | `postgres` | Postgres password. |
| `SCPS_POSTGRES_DB` | `saltcorn` | Postgres database name. |
| `SCPS_RESET_SCHEMA` | `1` | Reset Saltcorn schema on container start. |
| `SCPS_DOCKER_REUSE` | `0` | Reuse existing containers/volumes. |
| `SCPS_DOCKER_KEEP_UP` | `0` | Keep containers running after test. |
| `SCPS_DOCKER_KEEP_VOLUMES` | `0` | Preserve Docker volumes on down. |

## Safety

- The default stack binds Saltcorn only to `127.0.0.1`.
- The database volume is removed by default on shutdown.
- Live apply is enabled by default only for the disposable dev stack.
- Full project apply is a hard gate. Missing plugins/types or skipped native operations fail the integration run.
