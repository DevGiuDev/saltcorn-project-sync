# Dangerous changes

Saltcorn Project Sync is state-based for the desired app shape, but intent-based for operations that can lose or reinterpret data.

## Never inferred automatically

- Drop table
- Drop field
- Rename table
- Rename field
- Field type changes
- Reference-data deletes

## Required intents

### Drop field

```json
{
  "id": "2026-05-10-drop-old-status",
  "type": "drop_field",
  "table": "invoices",
  "field": "old_status",
  "reason": "Deprecated in previous release and data no longer needed"
}
```

### Rename field

```json
{
  "id": "2026-05-10-rename-status",
  "type": "rename_field",
  "table": "invoices",
  "from": "old_status",
  "to": "status",
  "reason": "Normalize invoice lifecycle naming"
}
```

### Alter field type

```json
{
  "id": "2026-05-10-alter-total-type",
  "type": "alter_field_type",
  "table": "invoices",
  "field": "total",
  "from": "Float",
  "to": "Integer",
  "reason": "Business rule changed to store whole cents elsewhere"
}
```

Without `alter_field_type`, type changes are blocked because they may truncate, coerce, or invalidate existing data.

### Gradual migration helpers

```json
{
  "id": "2026-05-10-copy-status-data",
  "type": "copy_field_data",
  "table": "invoices",
  "from": "old_status",
  "to": "status",
  "reason": "Backfill new status field"
}
```

```json
{
  "id": "2026-05-10-deprecate-old-status",
  "type": "mark_deprecated",
  "table": "invoices",
  "field": "old_status",
  "reason": "Prepare old field for later removal"
}
```
