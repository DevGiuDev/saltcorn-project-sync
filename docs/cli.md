# CLI

```bash
saltcorn-project-sync init --git
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync import-pack --pack saltcorn-pack.json
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply-file --env dev --tenant-export tenant.json --out applied.json
saltcorn-project-sync backup --env prod
saltcorn-project-sync record-deployment --env prod --status success
saltcorn-project-sync git-status
```

`import-pack` can ingest a Saltcorn pack/snapshot-like JSON file and write deterministic object files.

`export` and `apply` use the tenant adapter. The initial `command` adapter is configured via environment variables:

- `SALTCORN_PROJECT_SYNC_EXPORT_CMD`: prints pack/snapshot-like JSON.
- `SALTCORN_PROJECT_SYNC_APPLY_CMD`: receives normalized project JSON on stdin.
- `SALTCORN_PROJECT_SYNC_BACKUP_CMD`: creates a backup/snapshot and prints metadata JSON.

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
