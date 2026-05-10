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

For apply, the token must be configured on both sides: the CLI sends it, and the Saltcorn plugin refuses apply if the Saltcorn process does not have `SALTCORN_PROJECT_SYNC_API_TOKEN` set.

This adapter is useful for CI/CD where the Saltcorn tenant exposes controlled deployment endpoints.
