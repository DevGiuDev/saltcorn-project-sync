# Normalization

Exports must be deterministic and portable across tenants.

Current normalization rules:

- Sort object keys recursively.
- Sort object files by name.
- Sort table fields by name.
- Redact likely secrets such as `secret`, `password`, `token`, `api_key`, `credential`.
- Remove volatile timestamp-like keys such as `created_at`, `updated_at`, `last_modified`.
- Remove numeric tenant-local ID keys matching `id` or `*_id` recursively.

The native and command adapters should prefer stable named references such as `table_name`, `view_name`, `page_name`, `role_name` when available.

## Why remove numeric IDs?

Saltcorn object IDs differ between tenants. Keeping them in Git creates noisy diffs and unsafe deployments. Semantic references are required for portable deploys.

## Future work

- Resolve known Saltcorn IDs to names before stripping them.
- Normalize view/page configuration schemas by template type.
- Normalize plugin-specific config with plugin-provided serializers.
