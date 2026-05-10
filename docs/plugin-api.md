# Plugin REST API

The Saltcorn plugin exposes basic REST endpoints intended for the CLI `rest` adapter.

Endpoints:

- `GET /api/project-sync/info`
- `GET /api/project-sync/export`
- `POST /api/project-sync/apply`
- `POST /api/project-sync/backup`
- `POST /api/project-sync/restore`

If `SALTCORN_PROJECT_SYNC_API_TOKEN` is set in the Saltcorn process, requests must include:

```text
Authorization: Bearer <token>
```

## Apply endpoint

`POST /api/project-sync/apply` is guarded:

- requires `SALTCORN_PROJECT_SYNC_API_TOKEN` to be configured in the Saltcorn process
- requires matching `Authorization: Bearer <token>`
- currently only allows `env=local` or `env=dev`
- expects a CLI-generated payload containing `desired`, `plan`, `state`, and `env`
- rejects blocked plans
- rejects destructive operations unless `allow_destructive=true`

The plugin endpoints use the conservative native adapter internally and are best-effort until validated against the target Saltcorn version.
