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
  - alter field type by updating the Saltcorn field model when an explicit intent generated the operation
  - copy field data through `getRows`/`updateRow` when available
  - reference data upsert through `getRows`/`insertRow`/`updateRow` when available
  - drop field when explicit intent generated the operation and Saltcorn exposes a delete method
  - create/update/rename/drop views, pages, triggers, roles, menu, and settings when model methods are available

## Backup

Saltcorn snapshot APIs vary across versions. For production/test, configure:

```bash
SALTCORN_PROJECT_SYNC_BACKUP_CMD="your-backup-command-that-prints-json"
```

`test` and `prod` live apply require non-skipped, verifiable backup metadata from the hook (for example `id`, `backup_id`, `snapshot_id`, `path`, `file`, `artifact`, `created_at`, `completed_at`, or `metadata`).

## Warning

Native apply is intentionally conservative. It does not infer destructive operations. Operations unsupported by the installed Saltcorn model are reported as skipped rather than forced, with the expected Saltcorn model methods included in the message.

Menu/settings model modules are optional because Saltcorn versions differ. When `@saltcorn/data` exposes compatible menu or setting/config models, the adapter reports export/apply capability and uses them; otherwise these resources remain visible as unsupported in `doctor-live`/status capability output.
