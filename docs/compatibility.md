# Compatibility checks

Saltcorn Project Sync supports Saltcorn **1.6.0 and newer**.

Use `doctor-live` for full live environment checks and `check-live` for a compact compatibility result.

```bash
saltcorn-project-sync doctor-live --adapter command
saltcorn-project-sync doctor-live --adapter rest
saltcorn-project-sync doctor-live --adapter native
saltcorn-project-sync check-live --adapter command
```

`doctor-live` checks:

- REST/plugin reachability or adapter info availability.
- Adapter capability reporting for tables, fields, views, pages, triggers, roles, plugins, settings, menu, and reference data.
- Saltcorn version, enforcing the higher of project `saltcorn.min_version` and the supported minimum `1.6.0`.
- Required plugins from `plugins.lock.json` and version mismatches when both sides provide a version.
- Token/auth configuration for REST usage.
- Live export shape/counts.
- Optional Postgres sequence health via built-in `psql` checks or `SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD`.

The `command` adapter can report Saltcorn version with:

```bash
SALTCORN_PROJECT_SYNC_SALTCORN_VERSION=1.5.7
```

or:

```bash
SALTCORN_VERSION=1.5.7
```

The `native` adapter tries to read `@saltcorn/data/package.json`. Versions below `1.6.0` are reported as unsupported even when the project manifest has no explicit minimum. If Saltcorn's version cannot be detected, the check passes with `verified: false` and a warning; set `SALTCORN_VERSION` or `SALTCORN_PROJECT_SYNC_SALTCORN_VERSION` in the Saltcorn process to make the gate verifiable.

## Postgres sequence checks

Copied/restored Postgres databases can have sequences behind table IDs. Use:

```bash
saltcorn-project-sync check-sequences
saltcorn-project-sync fix-sequences
```

The built-in check uses `psql` and standard `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, or `DATABASE_URL` environment variables. By default it checks Saltcorn tables matching `\_sc\_%`; override with:

```bash
saltcorn-project-sync check-sequences --table-like 'my_%'
```

`doctor-live` runs this check automatically when Postgres connection env vars are present. You can still override with `SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD` if you need custom SQL.
