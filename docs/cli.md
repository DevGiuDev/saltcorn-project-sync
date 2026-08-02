# CLI

```bash
saltcorn-project-sync init --git
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync import-pack --pack saltcorn-pack.json
saltcorn-project-sync import-reference --table countries --key code --rows countries.json
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync report --env prod --backup --tenant-export tenant.json --out deploy-report.md
saltcorn-project-sync preflight --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply-file --env dev --tenant-export tenant.json --out applied.json
saltcorn-project-sync plan-live --adapter rest --env dev --backup
saltcorn-project-sync apply --adapter rest --env dev --allow-destructive
saltcorn-project-sync verify-live --adapter rest
saltcorn-project-sync deploy --adapter rest --env test --yes
saltcorn-project-sync backup --env prod
saltcorn-project-sync record-deployment --env prod --status success
saltcorn-project-sync doctor
saltcorn-project-sync doctor-live --adapter command
saltcorn-project-sync check-live --adapter command
saltcorn-project-sync restore --deployment last
saltcorn-project-sync git-status
```

`import-pack` can ingest a Saltcorn pack/snapshot-like JSON file and write deterministic object files.

`export` and `apply` use a tenant adapter. Available adapters:

- `command`: delegates to environment-configured commands. This is the safest integration point for existing Saltcorn pack/snapshot tooling.
- `rest`: calls HTTP endpoints such as `/project-sync/api/export` and `/project-sync/api/apply`.
- `native` / `saltcorn-native`: uses `@saltcorn/data` models when the CLI runs inside a configured Saltcorn runtime. Native apply currently covers table/field create/update/rename/drop and generic create/update for views/pages/triggers/roles when the installed Saltcorn model exposes matching methods.

The `command` adapter is configured via environment variables:

- `SALTCORN_PROJECT_SYNC_EXPORT_CMD`: prints pack/snapshot-like JSON.
- `SALTCORN_PROJECT_SYNC_APPLY_CMD`: receives normalized project JSON on stdin.
- `SALTCORN_PROJECT_SYNC_BACKUP_CMD`: creates a backup/snapshot and prints metadata JSON. `test` and `prod` live apply require non-skipped, verifiable metadata such as `id`, `backup_id`, `snapshot_id`, `path`, `file`, `artifact`, `created_at`, `completed_at`, or `metadata`.
- `SALTCORN_PROJECT_SYNC_SEQUENCE_CHECK_CMD`: optional `doctor-live` command for Postgres sequence health. It should print JSON; `{ "ok": false }` marks the check failed.

`doctor-live` runs live reachability, adapter capability, Saltcorn version, plugin lock, token/auth, live export, and optional sequence-health checks.

`plan-live` exports live state through the selected adapter and computes a plan
directly, without a manually generated `--tenant-export` file. It applies the
same version-aware change-intent filtering as `apply`.

`apply` prints a compact deployment receipt by default: `ok`, `env`,
`deployment_id`, `version`/`previous_version`, `commit`, operation/warning
counts, a minimal backup receipt (`id`, `path`, `created_at`, `sha256`), and
whether Saltcorn state was refreshed. Add `--full-output` to print the
complete plan and resulting project state instead.

`verify-live` exports live state through the selected adapter and compares it
against the desired project state using the same semantics as the plugin's
live diff: created/updated tables, fields, views, pages, triggers, roles,
menu, settings, and plugins count as drift; entries present only in the live
tenant are reported as `orphaned` and are never treated as drift. Exits
non-zero when drift is detected, which makes it suitable as a post-apply
convergence check in scripts and CI.

`deploy` is the one-command routine deployment: it connects, checks Saltcorn
compatibility, exports and plans, prints a compact plan summary, asks for
confirmation unless `--yes` is present (and refuses to proceed non-interactively
without `--yes`), creates and verifies a real backup, applies the plan,
refreshes Saltcorn state (REST adapter), verifies zero post-apply drift with
the same logic as `verify-live` (skip with `--skip-verify` only for debugging),
records a local deployment, and — when the adapter supports it (currently
`rest`) — persists an authoritative record on the target's deployment ledger.
It prints one JSON receipt with a `steps` array documenting exactly what ran
and exits non-zero if any step, including post-apply convergence, failed.

Pass `--request-id ID` to make a `deploy` invocation genuinely idempotent:
the same ID reused after a retry (e.g. a CI job re-run after a network
failure) reuses the same target ledger row (`created:false` on the retry)
instead of being rejected as a conflicting request. Without `--request-id`,
each invocation is treated as a new deployment.

Plugin lock changes are planned from `plugins.lock.json`: missing locked plugins produce `install_plugin`, version/source drift produces `update_plugin`, and extra live plugins are preserved as `orphaned_plugin` warnings unless an explicit `drop_plugin` intent exists.

## Tenant export shape for current diff/plan prototype

```json
{
  "tables": [
    {
      "name": "invoices",
      "fields": [
        { "name": "old_status", "type": "String" }
      ]
    }
  ]
}
```
