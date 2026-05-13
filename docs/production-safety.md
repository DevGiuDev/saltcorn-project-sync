# Production safety review

This project is designed around one core invariant:

> Absence from Git is never an implicit destructive operation.

Missing fields, tables, views, rows, plugins, menu entries, or settings must be reported as drift/orphans unless an explicit change intent authorizes destructive action.

## Destructive operations

Destructive or ambiguous operations include:

- `drop_*`
- `rename_*`
- `alter_field_type`
- data movement operations such as `copy_field_data`
- plugin removal via `drop_plugin`

Production/test policies require explicit change intents and backup metadata where applicable. Review all files under `changes/` before apply.

## Secret redaction

Normalization redacts property names matching common secret patterns:

- password
- secret
- token
- API keys
- private keys
- bearer/auth credentials
- access/refresh/session keys

Redacted values are written as `__REDACTED__`. Do not store tenant credentials in project JSON, environment overlays, object attributes, settings, or reference data.

## Tenant data exclusions

Regular tenant table data is not exported as project state. Only explicit reference data under `objects/data/reference_tables` is versioned. Reference data upserts preserve live rows that are absent from Git.

Do not use reference data for large mutable business data or secrets.

## Backup and restore guarantees

For `test` and `prod`, live apply requires verifiable backup metadata from the active adapter/hook. Metadata must be non-skipped and include an identifier/path/timestamp-like field.

Rollback records are distinct from deployment records and include `kind: "rollback"` plus `rollback_of`.

Current limitation: native Saltcorn snapshot APIs vary by version, so native backup/restore delegates to configured commands unless a target Saltcorn version exposes a stable API.

## Adapter limitations

The native adapter is conservative and version-aware only where tested. If an installed Saltcorn model does not expose a method needed for an operation, the adapter skips/reports that operation rather than forcing a write.

Validate against your exact Saltcorn version before production use:

```bash
saltcorn-project-sync doctor-live --adapter native
saltcorn-project-sync export --adapter native --out /tmp/scps-export-check
```

## Production gate

Before production apply, require:

- clean Git checkout at reviewed commit/tag
- `saltcorn-project-sync validate`
- dependency check with no missing dependencies
- live `doctor-live` success
- plan with no blockers
- reviewed warnings/orphans
- explicit intents for destructive/ambiguous operations
- verifiable backup metadata
- human approval for prod
- post-apply health check

## Known limitations

- Real Saltcorn integration must be validated per target Saltcorn version.
- Complex plugin-specific view configuration is preserved structurally but not semantically interpreted beyond stable reference normalization and redaction.
- Menu/settings support depends on Saltcorn model availability/version.
- Automated restore smoke tests require disposable Saltcorn/database infrastructure.
