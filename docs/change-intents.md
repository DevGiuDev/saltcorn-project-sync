# Change intents

State JSON describes the desired end state. Destructive or ambiguous changes require explicit intent files under `changes/`.

Supported initial intent types:

- `drop_field`
- `rename_field`
- `drop_table`
- `rename_table`
- `copy_field_data`
- `mark_deprecated`

Example:

```json
{
  "id": "2026-05-10-rename-invoice-status",
  "type": "rename_field",
  "table": "invoices",
  "from": "old_status",
  "to": "status",
  "reason": "Normalize invoice lifecycle naming",
  "approved_by": "team-lead"
}
```

Recommended safe rename sequence:

1. Create new field.
2. Copy data from old field.
3. Update views/pages/triggers.
4. Mark old field deprecated.
5. Drop old field in a later version if appropriate.
