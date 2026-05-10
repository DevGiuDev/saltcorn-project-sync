# Saltcorn Project Sync

Git-backed application versioning and safe deployment for Saltcorn tenants.

> Status: early scaffold / MVP design. The current code defines the project format, canonical JSON tools, diff/planning primitives, CLI skeleton, and Saltcorn plugin entrypoint.

## Goal

Manage a Saltcorn app like a versioned project: export selected objects, review Git diffs, pull/apply changes in another tenant, preserve data by default, and require explicit intent for destructive operations.

## Core principle

Project object JSON is **state-based**: it describes the desired final app state.

Dangerous changes are **intent-based**: deleting or renaming schema/data-bearing objects must be authorized by explicit change intents.

A field absent from Git is **not** automatically a `DROP COLUMN`. It is detected as drift/orphaned and preserved unless a change intent says otherwise.

## MVP scope

Versioned objects:

- Tables
- Fields
- Views
- Pages
- Triggers
- Required plugins
- Basic roles
- Project manifest

Initial compatibility can use Saltcorn packs/snapshots as source material, then normalize to deterministic JSON.

## Repository format

```text
saltcorn.project.json
plugins.lock.json
objects/
  tables/
  views/
  pages/
  triggers/
  roles/
  menu/
  settings/
  data/
    reference_tables/
environments/
  local.json
  dev.json
  test.json
  prod.json
changes/
```

## CLI

```bash
saltcorn-project-sync init
saltcorn-project-sync init --git
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync import-pack --pack saltcorn-pack.json
saltcorn-project-sync import-reference --table countries --key code --rows countries.json
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync report --env prod --backup --tenant-export tenant.json --out deploy-report.md
saltcorn-project-sync apply-file --env dev --tenant-export tenant.json --out applied.json
saltcorn-project-sync backup --env prod
saltcorn-project-sync export --out .
saltcorn-project-sync apply --env dev
```

Direct Saltcorn export/apply is adapter-backed. The included `command` adapter delegates to environment-configured commands, so deployments can integrate with existing Saltcorn pack/snapshot scripts. A conservative `native` adapter can use `@saltcorn/data` models when running inside a configured Saltcorn runtime.

## Safety defaults

- Preserve unexpected tenant fields/tables/data.
- Mark missing-in-Git tenant objects as orphaned/drift.
- Block ambiguous destructive changes.
- Require explicit `changes/*.json` intents for drops/renames in test/prod.
- Require backup/snapshot before prod apply.

## Documentation

- [Architecture](docs/architecture.md)
- [Project format](docs/project-format.md)
- [Change intents](docs/change-intents.md)
- [Dangerous changes](docs/dangerous-changes.md)
- [Safety model](docs/safety-model.md)
- [CLI](docs/cli.md)
- [Native adapter](docs/native-adapter.md)
- [Reference data](docs/reference-data.md)
- [CI/CD](docs/ci-cd.md)
- [Rollback](docs/rollback.md)
- [MVP plan](docs/mvp-plan.md)
