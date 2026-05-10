# Reference data

Reference data is optional versioned data for small lookup/configuration tables, such as countries, tax rates, ERP statuses, or static categories.

It lives under:

```text
objects/data/reference_tables/<table>.json
```

Example:

```json
{
  "table": "countries",
  "key": "code",
  "mode": "upsert",
  "rows": [
    { "code": "ES", "name": "Spain" }
  ]
}
```

## Safety behavior

Reference data is upsert-only by default.

Rows that exist in the tenant but not in Git are preserved and reported as `orphaned_reference_rows`. They are not deleted automatically.

## Import

```bash
saltcorn-project-sync import-reference --table countries --key code --rows countries.json
```

The rows file may be either a JSON array or an object with a `rows` array.
