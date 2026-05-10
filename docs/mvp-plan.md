# MVP plan

1. Project manifest and object inclusion UI.
2. Export selected Saltcorn objects to canonical JSON.
3. Import Saltcorn pack/snapshot JSON into deterministic per-object files.
4. Store project in Git and show diff.
5. Pull/apply into another tenant.
6. Basic diff for tables, fields, views, pages, triggers, roles.
7. Preserve missing fields by default; detect orphaned/drift fields.
8. Deployment records.
9. Backup before apply.

## Later phases

- Per-object semantic export beyond snapshots/packs.
- Automatic dependency detection.
- Versioned reference data.
- Environment overlays.
- Rich change intent/migration engine.
- Visual UI diff and conflict resolution.
- CI/CD deployment workflows.
- Rollback and deep validations.
