# Safety model

## Non-destructive default

If an object exists in the tenant but not in Git, it is preserved and reported as drift/orphaned.

Example:

- Git desired state has `invoices.status`.
- Tenant still has `invoices.old_status`.

Safe application:

- Create `invoices.status` if missing.
- Preserve `invoices.old_status`.
- Warn that `old_status` is orphaned / possible rename.

Never infer `DROP COLUMN` from absence alone.

## Environment policy

- `local`: destructive changes allowed with confirmation.
- `dev`: destructive changes allowed with confirmation.
- `test`: explicit change intent required.
- `prod`: explicit change intent plus pre-apply backup/snapshot required.

## Deployment records

Each apply should record tenant, environment, Git commit, actor, backup reference, plan summary, warnings, blocked operations, and result.
