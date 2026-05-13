# Plugin REST API

The Saltcorn plugin exposes basic REST endpoints intended for the CLI `rest` adapter.

Endpoints:

- `GET /project-sync/api/info`
- `GET /project-sync/api/status`
- `GET /project-sync/api/live-diff`
- `GET /project-sync/api/plan-preview`
- `GET /project-sync/api/approvals`
- `GET /project-sync/api/export`
- `POST /project-sync/api/apply`
- `POST /project-sync/api/backup`
- `POST /project-sync/api/restore`

Legacy GET aliases also exist:

- `GET /api/project-sync/info`
- `GET /api/project-sync/export`

POST endpoints intentionally use `/project-sync/api/*` because Saltcorn core mounts its own `/api` router before plugin routes.

If `SALTCORN_PROJECT_SYNC_API_TOKEN` is set in the Saltcorn process, requests must include:

```text
Authorization: Bearer <token>
```

## UI pages

The plugin exposes basic tenant UI pages:

- `/project-sync/status`: live adapter info, object counts, and capabilities.
- `/project-sync/live-diff`: read-only diff between Git desired state and the live tenant, including orphaned objects preserved by default.
- `/project-sync/plan-preview`: read-only plan preview against a server-configured project root.
- `/project-sync/approvals`: environment gate matrix for local/dev/test/prod, including blocker/warning/destructive counts and safe CLI command snippets.
- `/project-sync/deployments`: deployment history from the project metadata log.

Plan preview only reads project files when `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` is configured in the Saltcorn server process. Git operations remain in the companion CLI.

## Apply endpoint

`POST /project-sync/api/apply` is guarded:

- requires `SALTCORN_PROJECT_SYNC_API_TOKEN` to be configured in the Saltcorn process
- requires matching `Authorization: Bearer <token>`
- currently only allows `env=local` or `env=dev`
- expects a CLI-generated payload containing `desired`, `plan`, `state`, and `env`
- rejects blocked plans
- rejects destructive operations unless `allow_destructive=true`

The plugin endpoints use the conservative native adapter internally and are best-effort until validated against the target Saltcorn version.
