# REST adapter

The `rest` adapter lets Saltcorn Project Sync talk to HTTP endpoints instead of local commands or direct `@saltcorn/data` models.

```bash
SALTCORN_PROJECT_SYNC_ADAPTER=rest
SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn.example.com
SALTCORN_PROJECT_SYNC_API_TOKEN=...
```

Default endpoints:

- `GET /project-sync/api/info`
- `GET /project-sync/api/export`
- `POST /project-sync/api/apply`
- `POST /project-sync/api/backup`
- `POST /project-sync/api/restore`

The `/project-sync/api/*` path avoids collisions with Saltcorn's core `/api` router. Legacy GET aliases under `/api/project-sync/*` may work, but POST should use `/project-sync/api/*`.

You can override each endpoint:

```bash
SALTCORN_PROJECT_SYNC_EXPORT_URL=https://example.com/custom/export
SALTCORN_PROJECT_SYNC_APPLY_URL=https://example.com/custom/apply
SALTCORN_PROJECT_SYNC_BACKUP_URL=https://example.com/custom/backup
SALTCORN_PROJECT_SYNC_RESTORE_URL=https://example.com/custom/restore
SALTCORN_PROJECT_SYNC_INFO_URL=https://example.com/custom/info
```

Requests include `Authorization: Bearer <SALTCORN_PROJECT_SYNC_API_TOKEN>` when the token is set.

For apply, backup, and restore, the token must be configured on both sides: the CLI sends it, and the Saltcorn plugin refuses these operations if the Saltcorn process does not have `SALTCORN_PROJECT_SYNC_API_TOKEN` set.

REST apply supports `local`, `dev`, `test`, and `prod`. For `test` and `prod`, the CLI first invokes the remote backup endpoint and the apply payload must include non-skipped, verifiable backup metadata. Destructive operations additionally require an explicit change intent in the plan and `--allow-destructive`.

All API endpoints require either a matching Bearer token or a same-origin Saltcorn admin session. Anonymous export/info access is denied even when no API token is configured. Bearer tokens must only be sent over HTTPS outside localhost.

This adapter is useful for CI/CD where the Saltcorn tenant exposes controlled deployment endpoints.
