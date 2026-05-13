# CLI

```bash
saltcorn-project-sync init --git
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync import-pack --pack saltcorn-pack.json
saltcorn-project-sync import-reference --table countries --key code --rows countries.json
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync report --env prod --backup --tenant-export tenant.json --out deploy-report.md
saltcorn-project-sync preflight --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply-file --env dev --tenant-export tenant.json --out applied.json
saltcorn-project-sync apply --adapter rest --env dev --allow-destructive
saltcorn-project-sync backup --env prod
saltcorn-project-sync record-deployment --env prod --status success
saltcorn-project-sync doctor
saltcorn-project-sync doctor-live --adapter command
saltcorn-project-sync check-live --adapter command
saltcorn-project-sync restore --deployment last
saltcorn-project-sync git-status
```

`import-pack` can ingest a Saltcorn pack/snapshot-like JSON file and write deterministic object files.

`export` and `apply` use a tenant adapter. Available adapters:

- `command`: delegates to environment-configured commands. This is the safest integration point for existing Saltcorn pack/snapshot tooling.
- `rest`: calls HTTP endpoints such as `/project-sync/api/export` and `/project-sync/api/apply`.
- `native` / `saltcorn-native`: uses `@saltcorn/data` models when the CLI runs inside a configured Saltcorn runtime. Native apply currently covers table/field create/update/rename/drop and generic create/update for views/pages/triggers/roles when the installed Saltcorn model exposes matching methods.

The `command` adapter is configured via environment variables:

- `SALTCORN_PROJECT_SYNC_EXPORT_CMD`: prints pack/snapshot-like JSON.
- `SALTCORN_PROJECT_SYNC_APPLY_CMD`: receives normalized project JSON on stdin.
- `SALTCORN_PROJECT_SYNC_BACKUP_CMD`: creates a backup/snapshot and prints metadata JSON. `test` and `prod` live apply require non-skipped, verifiable metadata such as `id`, `backup_id`, `snapshot_id`, `path`, `file`, `artifact`, `created_at`, `completed_at`, or `metadata`.
- `SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD`: optional `doctor-live` command for Postgres sequence health. It should print JSON; `{ "ok": false }` marks the check failed.

`doctor-live` runs live reachability, adapter capability, Saltcorn version, plugin lock, token/auth, live export, and optional sequence-health checks.

Plugin lock changes are planned from `plugins.lock.json`: missing locked plugins produce `install_plugin`, version/source drift produces `update_plugin`, and extra live plugins are preserved as `orphaned_plugin` warnings unless an explicit `drop_plugin` intent exists.

## Tenant export shape for current diff/plan prototype

```json
{
  "tables": [
    {
      "name": "invoices",
      "fields": [
        { "name": "old_status", "type": "String" }
      ]
    }
  ]
}
```
