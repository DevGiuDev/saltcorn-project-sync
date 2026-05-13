# Seeds and migrations

Seeds populate deterministic data fixtures. Migrations run structural changes. Both are ordered, validated, and applied against the live Saltcorn tenant.

## Project layout

```text
seeds/
  001-countries.json
  010-demo-data.json

migrations/
  001-add-status-field.json
```

## Seed file format

```json
{
  "name": "countries",
  "mode": "upsert",
  "tables": [
    {
      "table": "countries",
      "key": "code",
      "rows": [
        { "code": "ES", "name": "Spain" }
      ]
    }
  ]
}
```

- `name`: descriptive identifier.
- `mode`: `"upsert"` (default) inserts or updates; `"replace"` marks the operation as unsafe.
- `tables[].table`: target Saltcorn table name.
- `tables[].key`: column used to match existing rows.
- `tables[].rows`: deterministic row data.

## Migration file format

```json
{
  "name": "add-status-field",
  "steps": [
    { "action": "ensure_table", "table": "invoices" },
    { "action": "ensure_field", "table": "invoices", "field": "status", "type": "String" }
  ]
}
```

Supported actions:

| Action | Description | Safe |
| --- | --- | --- |
| `ensure_table` | Creates table if missing | ✅ |
| `ensure_field` | Creates field if missing | ✅ |
| `ensure_view` | Creates view if missing | ✅ |
| `ensure_page` | Creates page if missing | ✅ |
| `ensure_trigger` | Creates trigger if missing | ✅ |
| `ensure_role` | Creates role if missing | ✅ |
| `raw_sql` | Executes SQL directly | ⚠️ not portable |
| `raw_command` | Runs a shell command | ⚠️ not portable |

## CLI

```bash
saltcorn-project-sync list-seeds
saltcorn-project-sync list-migrations
saltcorn-project-sync add-seed --name countries --order 1
saltcorn-project-sync add-migration --name add-status --order 1
saltcorn-project-sync apply-seeds --adapter rest --env dev
saltcorn-project-sync apply-migrations --adapter rest --env dev
```

`validate` also checks all seed and migration files for syntax errors.

## Safety rules

- Seeds use `upsert` by default — no data is deleted.
- `replace` mode requires reviewing the plan before applying.
- Migrations with `raw_sql` or `raw_command` produce warnings.
- Seed files must not contain secrets or production personal data.
- Files are applied in alphabetical/numeric order.

## Docker integration

Set environment variables in the Saltcorn container to apply seeds/migrations on startup:

```bash
SCPS_APPLY_SEEDS=1
SCPS_APPLY_MIGRATIONS=1
```

This runs `apply-seeds --adapter native` and `apply-migrations --adapter native` after the schema reset and plugin install, before `saltcorn serve` starts.
