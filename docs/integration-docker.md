# Docker integration environment

The Docker integration stack creates a disposable Saltcorn + Postgres environment for destructive tests, CI smoke tests, and clean-install validation.

It uses:

- `saltcorn/saltcorn:latest` by default. At the time of implementation this tracks `1.6.0-beta`.
- `postgres:16-alpine`.
- This plugin repo mounted at `/plugin`.
- The Saltcorn project at `SCPS_PROJECT_HOST_DIR` mounted at `/project`.
- The `uuid-type` plugin installed for project compatibility.

## What the test does

**Phase 1 — Plugin smoke test:**
- Creates a bare project in `/tmp`.
- Runs export, check-live, doctor-live, validate, diff, plan, apply-file, and live apply against the clean Saltcorn via REST.

**Phase 2 — Project smoke test:**
- Runs from the actual Saltcorn project directory (`test-project-sync`).
- Validates the project including seeds and migrations.
- Exports live state, computes diff and plan.
- Applies the project against the clean tenant.
- Verifies post-apply export works.
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
| `SCPS_SALTCORN_IMAGE` | `saltcorn/saltcorn:latest` | Saltcorn Docker image. |
| `SCPS_SALTCORN_VERSION` | `1.6.0-beta` | Version reported to compatibility checks. |
| `SCPS_SALTCORN_PORT` | `3333` | Host port mapped to container port `3000`. |
| `SALTCORN_PROJECT_SYNC_API_TOKEN` | `scps-docker-token` | Bearer token for plugin REST endpoints. |
| `SCPS_PROJECT_HOST_DIR` | `/home/devgiu/dev/test-project-sync` | Host path to the Saltcorn project to mount and test. |
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
- Full project apply may partially fail if the project depends on plugins not available in the base image — this is expected and non-blocking.
