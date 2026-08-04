# Seeds and migrations

Seeds populate deterministic data fixtures (master data, catalogs, demo content). Migrations run structural changes and data transformations. Both are ordered, validated, versioned in Git, and applied against the live Saltcorn tenant — either manually, during a deploy, or when bootstrapping a fresh server.

## Project layout

```text
seeds/
  001-countries.json
  010-demo-data.json

migrations/
  001-add-status-field.json
  002-create-status-index.json
```

Files are applied in alphabetical/numeric order.

## Seed file format

```json
{
  "name": "countries",
  "mode": "upsert",
  "phase": "post-deploy",
  "run": "always",
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
- `mode`: `"upsert"` (default) inserts or updates; `"replace"` truncates first (destructive); `"truncate"` only clears (destructive).
- `phase` *(optional)*: `"pre-deploy"`, `"post-deploy"`, or `"manual"` (default). Controls when the seed runs during a deploy.
- `run` *(optional)*: `"always"` (default for seeds) runs on every deploy; `"once"` is ledger-tracked.
- `tables[].table`: target Saltcorn table name.
- `tables[].key`: column used to match existing rows.
- `tables[].rows`: deterministic row data.

## Migration file format

```json
{
  "name": "create-status-index",
  "phase": "pre-deploy",
  "run": "once",
  "steps": [
    { "action": "ensure_field", "table": "invoices", "field": "status", "type": "String" },
    { "action": "raw_sql", "sql": "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)" }
  ]
}
```

- `phase` *(optional)*: `"pre-deploy"`, `"post-deploy"`, or `"manual"` (default).
- `run` *(optional)*: `"once"` (default for migrations, ledger-tracked) or `"always"`.

Supported actions:

| Action | Description | Safe |
| --- | --- | --- |
| `ensure_table` | Creates table if missing | ✅ |
| `ensure_field` | Creates field if missing | ✅ |
| `ensure_view` | Creates view if missing | ✅ |
| `ensure_page` | Creates page if missing | ✅ |
| `ensure_trigger` | Creates trigger if missing | ✅ |
| `ensure_role` | Creates role if missing | ✅ |
| `raw_sql` | Executes SQL directly in a transaction | ⚠️ not portable |
| `raw_command` | Runs a shell command (command/rest adapter only) | ⚠️ not portable |

## Deployment phases

Every seed and migration declares a `phase` that controls **when** it runs during a deploy:

| Phase | When it runs | Failure behaviour |
| --- | --- | --- |
| `pre-deploy` | Before the structural apply (tables/views/…) | **Fatal**: aborts the deploy before any structural change |
| `post-deploy` | After the structural apply and state refresh | **Best-effort**: the structure is already applied; the failure is reported but not rolled back |
| `manual` *(default)* | Only via explicit `apply-seeds` / `apply-migrations` | Reported in the plan |

The deploy pipeline is:

```
backup → pre-deploy hooks → apply structure → refresh → post-deploy hooks → verify → record
```

## Run modes and the migration ledger

The `run` field controls re-execution:

- `"once"` — the migration is recorded in the `_sc_ps_migrations_applied` ledger (per project + environment) and never re-executes. Use this for any migration with side effects (`raw_sql` `UPDATE`, `CREATE INDEX`, data transformations).
- `"always"` — runs on every invocation (default for seeds, which are idempotent by design).

The ledger matches migrations by **name** and records a content hash, so cosmetic edits (phase changes, comments) do not invalidate a previously applied migration. A migration that changes its effect must change its name or its steps.

## `raw_sql` in the native adapter

`raw_sql` steps run inside an explicit transaction (`BEGIN`/`COMMIT`) in the native adapter. On failure, the statement is rolled back and the error is reported. This makes `raw_sql` safe for data-normalization tasks:

```json
{
  "name": "normalize-country-codes",
  "phase": "post-deploy",
  "run": "once",
  "steps": [
    { "action": "raw_sql", "sql": "UPDATE contacts SET country_code = UPPER(country_code) WHERE country_code IS NOT NULL" }
  ]
}
```

`raw_command` is not supported by the native adapter (no shell inside the Saltcorn process); use the command or REST adapter for that.

## Bootstrap: populate a fresh server

`bootstrap` applies the project structure and optional seeds/migrations **additively** — it never resets the schema and only creates what is missing:

```bash
saltcorn-project-sync bootstrap --adapter native --env dev
saltcorn-project-sync bootstrap --adapter native --env dev --with-seeds --with-migrations
saltcorn-project-sync bootstrap --adapter native --env dev --with-migrations --phase pre-deploy
```

Unlike `reset` (which erases everything), `bootstrap` exports the live state first, so the planner only emits `create_*` operations for objects that are absent. It respects the migration ledger, so `once`-migrations that already ran are skipped.

## Deploy integration

The `deploy` command runs pre/post-deploy hooks automatically. Flags to control it:

```bash
saltcorn-project-sync deploy --env dev              # runs all hooks
saltcorn-project-sync deploy --env dev --no-hooks  # skip all hooks
saltcorn-project-sync deploy --env dev --skip-seeds
saltcorn-project-sync deploy --env dev --skip-migrations
```

## UI manager

The **Data** tab in the project workspace provides a full manager:

- **Two blocks per kind**: "Single execution (once)" shows ledger status (applied/pending/failed + timestamp) and "Recurring (always)" for idempotent scripts that re-run every deploy.
- **Form-based editor** with real controls instead of raw JSON: name, phase (combo), run (combo), mode (combo, seeds only), plus a step editor with add/remove/reorder.
- **Guided wizards** with table/field dropdowns (populated from the live tenant): Copy field, Create index, Transform data, Add field, Free SQL, Master data, Clear table.
- **SQL syntax highlighting** via Saltcorn's Monaco editor: every `raw_sql` step and the raw-JSON tab use `textarea.to-code` with `mode="text/x-sql"` / `mode="application/json"`.
- **Raw JSON tab** for advanced editing, with live re-parse back to the form.
- Validate before saving; delete files.

## Manual CLI

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
- `replace` / `truncate` modes are destructive and require `--allow-destructive`.
- `raw_sql` runs in a transaction; failures roll back automatically.
- Migrations with `raw_sql` or `raw_command` produce portability warnings.
- `run: "once"` migrations are ledger-tracked and never re-execute.
- `phase: "pre-deploy"` failures abort the deploy before any structural change.
- Seed and migration files must not contain secrets or production personal data.

## Docker integration

Set environment variables in the Saltcorn container to apply seeds/migrations on startup:

```bash
SCPS_APPLY_SEEDS=1
SCPS_APPLY_MIGRATIONS=1
```

This runs `apply-seeds --adapter native` and `apply-migrations --adapter native` after the schema reset and plugin install, before `saltcorn serve` starts.
