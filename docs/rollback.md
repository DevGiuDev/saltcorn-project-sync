# Rollback and restore

Saltcorn Project Sync records deployment metadata under:

```text
.saltcorn-project-sync/deployments.json
```

Normal deployment records have stable IDs such as `deploy-000001`. Rollback records are written distinctly with IDs such as `rollback-000001`, `kind: "rollback"`, and `rollback_of` pointing to the restored deployment.

## Restore command

```bash
saltcorn-project-sync restore --deployment last
saltcorn-project-sync restore --deployment deploy-000123
```

Restore requires the selected deployment record to contain backup metadata and the active adapter to implement restore. A successful restore appends a distinct rollback record rather than overwriting the original deployment record.

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
