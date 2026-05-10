# Plugin REST API

The Saltcorn plugin exposes basic REST endpoints intended for the CLI `rest` adapter.

Endpoints:

- `GET /api/project-sync/info`
- `GET /api/project-sync/export`
- `POST /api/project-sync/backup`
- `POST /api/project-sync/restore`

If `SALTCORN_PROJECT_SYNC_API_TOKEN` is set in the Saltcorn process, requests must include:

```text
Authorization: Bearer <token>
```

## Apply endpoint

A generic apply endpoint is intentionally not exposed by default. Applying a plan to a tenant should remain CLI/planner-driven or be implemented as a carefully reviewed tenant-specific route.

The plugin endpoints use the conservative native adapter internally and are best-effort until validated against the target Saltcorn version.
