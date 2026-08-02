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
- `GET /project-sync/api/deployments`
- `GET /project-sync/api/deployments/:deploymentId`
- `POST /project-sync/api/deployments`

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
- `/project-sync/deployments`: authoritative deployment history from the target-side ledger, with an explicit local-cache fallback when the ledger is unavailable.

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

## Deployment ledger

The target tenant owns an internal `_sc_ps_deployments` table. It stores only a
sanitized deployment receipt: deployment/request IDs, project/version/commit,
environment, status, operation and warning summaries, backup receipt,
convergence result, rollback relation, and a bounded redacted error. Desired
state, credentials, tokens, commands, and arbitrary request metadata are never
stored.

Ledger writes require the configured Bearer token. `request_id` is mandatory
and idempotent: replaying the same sanitized record returns the existing row;
reusing the ID for different data returns HTTP 409. Example:

```json
{
  "request_id": "buyapp-test-deploy-000001",
  "deployment_id": "deploy-000001",
  "kind": "deployment",
  "project": "buyapp",
  "version": "0.1.1",
  "commit": "a7f0096",
  "environment": "test",
  "status": "verified",
  "operations": { "count": 1, "by_action": { "create_field": 1 } },
  "warnings": { "count": 1 },
  "backup": { "id": "backup-id", "sha256": "<64 hex characters>" },
  "convergence": { "ok": true, "operations": 0, "warnings": 1 }
}
```
