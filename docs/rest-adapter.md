# REST adapter

The `rest` adapter lets Saltcorn Project Sync talk to HTTP endpoints instead of local commands or direct `@saltcorn/data` models.

```bash
SALTCORN_PROJECT_SYNC_ADAPTER=rest
SALTCORN_PROJECT_SYNC_BASE_URL=https://saltcorn.example.com
SALTCORN_PROJECT_SYNC_API_TOKEN=...
```

Default endpoints:

- `GET /api/project-sync/info`
- `GET /api/project-sync/export`
- `POST /api/project-sync/apply`
- `POST /api/project-sync/backup`
- `POST /api/project-sync/restore`

You can override each endpoint:

```bash
SALTCORN_PROJECT_SYNC_EXPORT_URL=https://example.com/custom/export
SALTCORN_PROJECT_SYNC_APPLY_URL=https://example.com/custom/apply
SALTCORN_PROJECT_SYNC_BACKUP_URL=https://example.com/custom/backup
SALTCORN_PROJECT_SYNC_RESTORE_URL=https://example.com/custom/restore
SALTCORN_PROJECT_SYNC_INFO_URL=https://example.com/custom/info
```

Requests include `Authorization: Bearer <SALTCORN_PROJECT_SYNC_API_TOKEN>` when the token is set.

This adapter is useful for CI/CD where the Saltcorn tenant exposes controlled deployment endpoints.
