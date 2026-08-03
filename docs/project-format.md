# Project format fidelity

Saltcorn Project Sync exports deterministic JSON under `objects/` plus `plugins.lock.json` and optional reference data.

## Deployment scope

Full exports write a portable scope to `saltcorn.project.json`:

```json
{
  "scope": {
    "version": 1,
    "objects": {
      "tables": ["customers"],
      "views": ["customer_list"],
      "plugins": ["base"]
    }
  }
}
```

This explicit allowlist is the versioned desired scope for the deployment.
Object files outside it may remain in an old repository without silently
becoming managed deployment input.

The target tenant keeps a local scope for export selection and live-drift
observation. During a deployment, it may add observations but cannot veto an
object named by the committed manifest scope. Deploy previews list additions,
bind them into the plan digest, and persist them after convergence.

For legacy commits without `scope`, the target allowlist remains authoritative.
The preview additionally infers Git objects that do not exist live, allowing a
new table or view to be created without first visiting Scope. Existing live
objects excluded by the target remain unmanaged and are reported as legacy
scope exclusions.

Absence from the commit remains non-destructive: tenant objects not represented
in Git are preserved unless an explicit change intent authorizes an operation.

## Stable references

Tenant-local numeric IDs are not stable across Saltcorn tenants. During normalization, known references are resolved to names before IDs are stripped:

- `table_id` -> `table_name`
- `field_id` -> `field_name`
- `view_id` -> `view_name`
- `page_id` -> `page_name`
- `trigger_id` -> `trigger_name`
- `role_id` -> `role_name`
- `plugin_id` -> `plugin_name`

Unresolved numeric `*_id` values are removed as tenant-local metadata.

## Noise reduction

Normalization removes:

- volatile timestamps such as `created_at`, `updated_at`, `last_modified`, and `nonce`
- common generated metadata such as `created_by`, `updated_by`, `pack_id`, and `snapshot_id`
- empty default containers for `attributes`, `configuration`, `options`, `meta`, and `metadata`
- likely secret values, replaced with `__REDACTED__`

## Menu and settings

Menu and settings can be exported by Saltcorn in array or object form. The normalizer accepts both:

- object-shaped menu with `items` becomes a single `main` menu object unless it has an explicit name/key
- object-shaped settings become one object per setting: `{ name, key, value }`

This representation is intentionally conservative and name-based. More Saltcorn-specific semantic transforms may be added as target versions are validated.

## Current limitations

- References not represented by known `*_id` keys may remain unresolved.
- Ambiguous field IDs are resolved globally from exported table fields; exports with duplicate field IDs are invalid tenant data.
- Empty `configuration`/`attributes` objects are treated as default noise. Non-empty values are preserved.
- Complex plugin-specific view configuration is preserved structurally but not interpreted beyond ID-to-name replacement and secret redaction.
