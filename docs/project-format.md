# Project format

## `saltcorn.project.json`

Defines identity, Saltcorn compatibility, and the objects included in the app.

```json
{
  "format_version": 1,
  "name": "ERP App",
  "slug": "erp-app",
  "saltcorn": {
    "min_version": "0.0.0",
    "tested_versions": []
  },
  "objects": {
    "tables": ["invoices"],
    "views": [],
    "pages": [],
    "triggers": [],
    "roles": [],
    "menu": [],
    "settings": []
  }
}
```

## Objects

Objects are stored as canonical JSON under `objects/<kind>/<name>.json`.

IDs from a source tenant must be normalized to portable names/references before writing.

## Excluded by default

- Users
- Sessions
- Logs
- Transactional ERP data
- Uploaded user files unless explicitly versioned assets
- Secrets, API keys, passwords, tokens
- Environment-specific configuration

## Environments

`environments/*.json` contains non-secret policy/config overlays. Secrets must come from environment variables or deployment secret stores.
