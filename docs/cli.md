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
saltcorn-project-sync backup --env prod
saltcorn-project-sync record-deployment --env prod --status success
saltcorn-project-sync doctor
saltcorn-project-sync check-live --adapter command
saltcorn-project-sync restore --deployment last
saltcorn-project-sync git-status
```

`import-pack` can ingest a Saltcorn pack/snapshot-like JSON file and write deterministic object files.

`export` and `apply` use a tenant adapter. Available adapters:

- `command`: delegates to environment-configured commands. This is the safest integration point for existing Saltcorn pack/snapshot tooling.
- `rest`: calls HTTP endpoints such as `/api/project-sync/export` and `/api/project-sync/apply`.
- `native` / `saltcorn-native`: uses `@saltcorn/data` models when the CLI runs inside a configured Saltcorn runtime. Native apply currently covers table/field create/update/rename/drop and generic create/update for views/pages/triggers/roles when the installed Saltcorn model exposes matching methods.

The `command` adapter is configured via environment variables:

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
