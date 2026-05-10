# Native Saltcorn adapter

The `native` / `saltcorn-native` adapter is a best-effort direct integration with Saltcorn's `@saltcorn/data` models.

Use it only when the CLI is executed inside a configured Saltcorn runtime where database connection, tenant context, and `@saltcorn/data` are available.

```bash
SALTCORN_PROJECT_SYNC_ADAPTER=native saltcorn-project-sync export --out .
SALTCORN_PROJECT_SYNC_ADAPTER=native saltcorn-project-sync apply --env dev
```

## Current native coverage

- Export: tables, views, pages, triggers, roles, plugins.
- Apply plan:
  - create table
  - create/update field
  - rename field
  - drop field when explicit intent generated the operation and Saltcorn exposes a delete method
  - create/update views, pages, triggers, roles when model methods are available

## Backup

Saltcorn snapshot APIs vary across versions. For production/test, configure:

```bash
SALTCORN_PROJECT_SYNC_BACKUP_CMD="your-backup-command-that-prints-json"
```

The safety planner still requires backup presence for `test` and `prod`.

## Warning

Native apply is intentionally conservative. It does not infer destructive operations. Operations unsupported by the installed Saltcorn model are reported as skipped rather than forced.
