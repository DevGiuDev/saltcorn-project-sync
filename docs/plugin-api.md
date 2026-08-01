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

API requests require one of:

- a same-origin Saltcorn admin session (plugin UI), or
- a configured matching Bearer token (CLI/CI).

```text
Authorization: Bearer <token>
```

Anonymous API access is denied even when `SALTCORN_PROJECT_SYNC_API_TOKEN` is not configured. Session-authenticated browser writes are accepted only when their `Origin`/`Referer` host matches the request host. Apply, backup, restore, and state refresh are Bearer-only operations.

## UI pages

The plugin exposes a project-first UI:

- `/project-sync/projects`: project list and project creation.
- `/project-sync/projects/:id`: project scope workspace.
- `/project-sync/git?project_id=:id`: project-scoped Git view.
- `/project-sync/live-diff?project_id=:id`: project-scoped diff between files and live tenant.
- `/project-sync/plan-preview?project_id=:id`: project-scoped plan preview.
- `/project-sync/approvals?project_id=:id`: project-scoped approval matrix.
- `/project-sync/settings?project_id=:id`: project-scoped settings and health checks.
- `/project-sync/deployments`: deployment history from the project metadata log.

`/project-sync`, `/project-sync/status`, and `/project-sync/health` redirect to `Projects` for backward compatibility. Project-scoped views use the selected project's `root_path`; a server-level `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` is only a fallback.

## Apply endpoint

`POST /project-sync/api/apply` is guarded:

- requires `SALTCORN_PROJECT_SYNC_API_TOKEN` to be configured in the Saltcorn process
- requires matching `Authorization: Bearer <token>`
- allows `env=local`, `env=dev`, `env=test`, and `env=prod`
- expects a CLI-generated payload containing `desired`, `plan`, `state`, and `env`
- rejects blocked plans
- rejects destructive operations unless `allow_destructive=true`
- requires `backup=true` plus verifiable `backup_metadata` for `test` and `prod`
- reports the apply as failed when the native adapter skips any planned operation

The plugin endpoints use the conservative native adapter internally and are best-effort until validated against the target Saltcorn version.
