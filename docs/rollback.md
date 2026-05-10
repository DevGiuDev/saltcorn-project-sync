# Rollback and restore

Saltcorn Project Sync records deployment metadata under:

```text
.saltcorn-project-sync/deployments.json
```

Each record has a stable ID such as `deploy-000001`.

## Restore command

```bash
saltcorn-project-sync restore --deployment last
saltcorn-project-sync restore --deployment deploy-000123
```

Restore requires the selected deployment record to contain backup metadata and the active adapter to implement restore.

## Command adapter

Configure:

```bash
SALTCORN_PROJECT_SYNC_RESTORE_CMD="your-restore-command-that-reads-backup-json-on-stdin-and-prints-json"
```

The backup JSON from the deployment record is passed to stdin.

## Native adapter

Native restore delegates to `SALTCORN_PROJECT_SYNC_RESTORE_CMD` because Saltcorn snapshot APIs vary between versions.

## Policy

Rollback should still be treated as a deployment:

- record who/what initiated restore externally in CI/CD
- verify target tenant/environment
- snapshot before rollback when possible
- review post-restore health checks
