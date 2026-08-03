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
- `GET|POST /project-sync/api/projects/:id/environment`
- `GET /project-sync/api/projects/:id/setup-health`
- `GET|POST /project-sync/api/tokens`
- `POST /project-sync/api/tokens/:id/revoke`
- `GET /project-sync/api/projects/:id/deploy/context`
- `POST /project-sync/api/projects/:id/deploy/preview`
- `POST /project-sync/api/deployment-requests/:requestId/confirm`
- `POST /project-sync/api/deployment-requests/:requestId/cancel`
- `GET /project-sync/api/deployment-requests/:requestId`

Legacy GET aliases also exist:

- `GET /api/project-sync/info`
- `GET /api/project-sync/export`

POST endpoints intentionally use `/project-sync/api/*` because Saltcorn core mounts its own `/api` router before plugin routes.

API requests require one of:

- a same-origin Saltcorn admin session (plugin UI), or
- a matching hashed token generated in the setup UI, or the legacy process-configured Bearer token (CLI/CI).

```text
Authorization: Bearer <token>
```

Anonymous API access is denied even when `SALTCORN_PROJECT_SYNC_API_TOKEN` is not configured. Session-authenticated browser writes are accepted only when their `Origin`/`Referer` host matches the request host. Apply, backup, restore, and state refresh are Bearer-only operations. Interactive deployment request endpoints are stricter in the opposite direction: they require a same-origin Saltcorn administrator session and reject Bearer-only clients.

## UI pages

The plugin exposes a project-first UI:

- `/project-sync/projects`: project list and project creation.
- `/project-sync/projects/:id`: project scope workspace.
- `/project-sync/git?project_id=:id`: project-scoped Git view.
- `/project-sync/live-diff?project_id=:id`: project-scoped diff between files and live tenant.
- `/project-sync/plan-preview?project_id=:id`: project-scoped plan preview.
- `/project-sync/approvals?project_id=:id`: project-scoped approval matrix.
- `/project-sync/settings?project_id=:id`: setup wizard, effective configuration precedence, health checks, and token lifecycle.
- `/project-sync/projects/:id/deploy?environment=dev`: immutable Git preview, exact-plan confirmation, execution progress, and receipt.
- `/project-sync/deployments`: authoritative deployment history from the target-side ledger, with an explicit local-cache fallback when the ledger is unavailable.

`/project-sync`, `/project-sync/status`, and `/project-sync/health` redirect to `Projects` for backward compatibility. Project-scoped views use the selected project's `root_path`; a server-level `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` is only a fallback.

## Apply endpoint

`POST /project-sync/api/apply` is guarded:

- requires a valid generated token or `SALTCORN_PROJECT_SYNC_API_TOKEN`
- requires matching `Authorization: Bearer <token>`
- allows `env=local`, `env=dev`, `env=test`, and `env=prod`
- expects a CLI-generated payload containing `desired`, `plan`, `state`, and `env`
- accepts `request_id` and `project_slug` to identify the attempt and acquire a target lock
- rejects blocked plans
- rejects destructive operations unless `allow_destructive=true`
- requires `backup=true` plus verifiable `backup_metadata` for `test` and `prod`
- reports the apply as failed when the native adapter skips any planned operation
- rejects a concurrent apply for the same project/environment with HTTP 409

The plugin endpoints use the conservative native adapter internally and are best-effort until validated against the target Saltcorn version.

## Interactive deployment requests

The preview endpoint resolves a Git branch, tag, or SHA to an exact commit in
an isolated checkout, exports the active tenant, and stores a short-lived
request bound to desired-state, actual-state, and plan SHA-256 digests.
Confirmation submits only the request ID, plan digest, and—when destructive—a
typed environment. Source and tenant state are recalculated before apply;
mismatches become `stale` and are never applied.

The request endpoint is polled for `backup`, `applying`, `refreshing`,
`verifying`, and a terminal `applied`, `drifted`, `*_failed`, `stale`,
`expired`, or `cancelled` state. Permanent receipts are written separately to
the target deployment ledger; request rows contain sanitized summaries rather
than complete project or tenant state.

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
