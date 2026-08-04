# Migrations guide

Migrations version structural changes and **data transformations** in Git and apply them safely across environments. Unlike the drift sync (which captures schema changes ad-hoc), migrations are explicit, ordered, and audited.

## When to use migrations vs. drift sync

| Scenario | Tool |
| --- | --- |
| A field was added in dev and you want to promote it | Drift sync (Live Diff → push) — the field file already exists |
| You need to create an index on a production table | Migration (`raw_sql`, `run: "once"`) — repeatable across environments |
| You need to split a `full_name` column into `first_name`/`last_name` and backfill | Migration (`ensure_field` + `raw_sql UPDATE`) — one-time data transformation |
| You need to populate a `countries` / `municipalities` reference table | Seed (`upsert`, `phase: "post-deploy"`) — idempotent master data |
| You need to clear an audit log before a deploy | Seed (`mode: "truncate"`, `phase: "pre-deploy"`) — destructive, deliberate |

## Anatomy of a migration

```json
{
  "name": "split-customer-name",
  "phase": "pre-deploy",
  "run": "once",
  "steps": [
    { "action": "ensure_field", "table": "customers", "field": "first_name", "type": "String" },
    { "action": "ensure_field", "table": "customers", "field": "last_name", "type": "String" },
    { "action": "raw_sql", "sql": "UPDATE customers SET first_name = split_part(full_name, ' ', 1), last_name = split_part(full_name, ' ', 2) WHERE first_name IS NULL" }
  ]
}
```

- `name` — unique identifier; the ledger tracks migrations by name.
- `phase` — `pre-deploy` (before structure), `post-deploy` (after), `manual` (explicit only).
- `run` — `once` (ledger-tracked, default) or `always`.
- `steps` — ordered list of actions.

## Common recipes

### Create an index

```json
{
  "name": "index-invoices-status",
  "phase": "pre-deploy",
  "run": "once",
  "steps": [
    { "action": "raw_sql", "sql": "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)" }
  ]
}
```

### Backfill a foreign key

```json
{
  "name": "backfill-country-fk",
  "phase": "post-deploy",
  "run": "once",
  "steps": [
    { "action": "raw_sql", "sql": "UPDATE contacts c SET country_id = co.id FROM countries co WHERE c.country_code = co.code AND c.country_id IS NULL" }
  ]
}
```

### Normalize data values

```json
{
  "name": "normalize-emails",
  "phase": "post-deploy",
  "run": "once",
  "steps": [
    { "action": "raw_sql", "sql": "UPDATE contacts SET email = lower(trim(email)) WHERE email IS NOT NULL" }
  ]
}
```

### Populate a reference table (seed)

```json
{
  "name": "municipalities",
  "phase": "post-deploy",
  "mode": "upsert",
  "run": "always",
  "tables": [
    { "table": "municipalities", "key": "code", "rows": [
      { "code": "28001", "name": "Madrid", "province": "Madrid" },
      { "code": "08001", "name": "Barcelona", "province": "Barcelona" }
    ] }
  ]
}
```

## How the migration ledger works

Each `run: "once"` migration is recorded in the `_sc_ps_migrations_applied` table (per project + environment) after it succeeds. The ledger stores:

- `migration_name` — matched against the file's `name`.
- `migration_hash` — SHA-256 of `{name, steps}` (cosmetic fields like `phase` are ignored, so re-phasing does not re-run).
- `status` — `applied` or `failed`.
- `deployment_id` — links to the deploy that ran it.

A migration that failed is **not** marked applied, so it will retry on the next deploy. A migration that succeeds never re-runs.

## Execution order during a deploy

```
1. backup
2. pre-deploy hooks     ← migrations + seeds with phase: "pre-deploy"
3. apply structure      ← tables, views, pages, triggers, roles, settings
4. refresh state
5. post-deploy hooks    ← migrations + seeds with phase: "post-deploy"
6. verify convergence
7. record               ← deployment ledger + migration ledger
```

Pre-deploy hooks run **before** the structure apply, so they can prepare tables that the apply will then fill. Post-deploy hooks run **after**, so they can transform data that the apply created.

## CLI reference

```bash
# Manual apply (all files, regardless of phase)
saltcorn-project-sync apply-migrations --adapter native --env dev
saltcorn-project-sync apply-seeds --adapter native --env dev

# Bootstrap a fresh server (additive, non-destructive)
saltcorn-project-sync bootstrap --adapter native --env dev --with-migrations --with-seeds

# Deploy with hooks (default behavior)
saltcorn-project-sync deploy --env dev
saltcorn-project-sync deploy --env dev --no-hooks
saltcorn-project-sync deploy --env dev --skip-migrations
```

## UI

The **Data** tab in the project workspace lets you create, edit, validate, and delete migration and seed files with templates and live JSON validation.

## Safety

- `raw_sql` runs inside a transaction (`BEGIN`/`COMMIT`); failures roll back.
- Pre-deploy hook failures abort the deploy before any structural change.
- Post-deploy hook failures are reported but do not roll back the structure.
- `run: "once"` migrations are ledger-tracked and idempotent across deploys.
- `replace`/`truncate` seed modes are destructive and require `--allow-destructive`.
