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

## Deleting objects via Live-Diff

When an object (view, page, ...) is removed from the live tenant, it appears in
the Live-Diff panel as **created** ("In Git, missing live"). The **Eliminar**
button confirms the deletion from the repository and, at the same time, writes a
`drop_<kind>` change intent so the same deletion propagates to every other
environment on the next deploy.

What the button does, atomically:

1. Deletes the object file from `objects/<kind>/`.
2. Marks the scope DB entry as `included = false` (reversible).
3. Recomputes the portable `scope` field in `saltcorn.project.json`.
4. Writes `changes/drop-<kind>-<name>.json` carrying the **current manifest
   version**.

### Lifecycle of an auto-generated intent (why they don't pile up)

The intent is stamped with the manifest version at creation time.
`loadChangeIntents({ sinceVersion })` only returns intents whose `version` is
**greater than** the version the target tenant was last deployed at.

So for a tenant last deployed at `0.2.0` and an intent stamped `0.2.0`:

| Tenant state on deploy | Intent included? | Effect |
|---|---|---|
| `0.1.9` (behind) | ✅ yes (`0.2.0 > 0.1.9`) | `drop_view` runs; view removed if present |
| `0.2.0` (current) | ❌ no (`0.2.0` not `> 0.2.0`) | inert, stays in Git as audit record |
| `0.3.0` (ahead) | ❌ no | inert |

The file remains in `changes/` as an audit trail but is filtered out of the plan
automatically once a tenant reaches the version. No manual cleanup is needed;
intents can be deleted from Git at any time after every environment has passed
their version, but keeping them is harmless and recommended for traceability.

### Idempotency

The intent authorizes a `drop_<kind>` operation, but the planner only emits that
operation when the object is **orphaned** (present in the live tenant, absent
from the repo). If the object no longer exists in a given tenant, it never
appears as orphaned, so the intent does nothing there — no error, no side
effect. The same intent is therefore safe to carry across branches and repeated
deploys.
