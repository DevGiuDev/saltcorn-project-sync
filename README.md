# Saltcorn Project Sync

Git-backed application versioning and safe deployment for Saltcorn tenants.

Supported Saltcorn versions: **1.6.0 and newer**.

## Installation

Install the companion CLI from npm:

```bash
npm install --global saltcorn-project-sync@0.4.1
saltcorn-project-sync --help
```

Install the plugin into Saltcorn from npm:

```bash
npm view saltcorn-project-sync version  # verify the expected release first
saltcorn install-plugin --npm saltcorn-project-sync
```

Saltcorn 1.6/1.7 accepts only a bare package name in `--npm`; passing
`package@version` returns a registry 404. Verify the registry version before
installation and confirm the installed version afterwards. The companion CLI
can and should remain pinned to an explicit version. See
[Installation](docs/installation.md) and
[Production safety](docs/production-safety.md).

## Goal

Manage a Saltcorn app like a versioned project: export selected objects, review Git diffs, pull/apply changes in another tenant, preserve data by default, and require explicit intent for destructive operations.

## Core principle

Project object JSON is **state-based**: it describes the desired final app state.

Dangerous changes are **intent-based**: deleting or renaming schema/data-bearing objects must be authorized by explicit change intents.

A field absent from Git is **not** automatically a `DROP COLUMN`. It is detected as drift/orphaned and preserved unless a change intent says otherwise.

See [Safety model](docs/safety-model.md) for details.

## Versioned objects

Tables, fields, views, pages, triggers, required plugins, roles, menu, settings, reference data, and the project manifest.

See [Project format](docs/project-format.md) and [Normalization](docs/normalization.md).

## Plugin UI

The plugin exposes a project-first web UI under `/project-sync`:

| Area | Purpose |
|---|---|
| Projects | Define and manage project scopes |
| Deployments | Authoritative target-side deployment ledger with backup and convergence evidence |
| Project → Scope | Choose which Saltcorn objects belong to the project |
| Project → Git | Stage, commit, push, pull and branch management |
| Project → Live Diff | Bidirectional diff and sync between live tenant and files |
| Project → Plan | Read-only plan preview |
| Project → Approvals | Environment policy and approval controls |
| Project → Settings | Project metadata, root path, and health checks |

A global branch/tenant guard overlay warns on every Saltcorn page when the current Git branch does not match the active tenant.

## Branch → Tenant

Each Git branch gets its own PostgreSQL schema (tenant), cloned from source via `clone_schema()`. Branches work in parallel with independent data. Merge happens at the Git level (JSON files); the plugin then applies the diff to the target tenant.

See [Branch → Tenant design](docs/branch-tenant-design.md).

## CLI

Adapter-backed export/apply with `command`, `rest`, and `native` adapters.

```bash
saltcorn-project-sync init --git
saltcorn-project-sync export --out .
saltcorn-project-sync diff --tenant-export tenant.json
saltcorn-project-sync plan --env prod --backup --tenant-export tenant.json
saltcorn-project-sync apply --env dev
saltcorn-project-sync doctor-live --adapter rest
```

Full command reference: [CLI docs](docs/cli.md).

## Authentication for remote deployments

The REST adapter authenticates via a Bearer token. Generate a hashed, revocable token from the project setup page or set the legacy `SALTCORN_PROJECT_SYNC_API_TOKEN` on both the Saltcorn server and runner. HTTPS is required in production.

See [REST adapter](docs/rest-adapter.md) and [Plugin REST API](docs/plugin-api.md).

## Testing

```bash
npm test                            # unit tests (no Saltcorn needed)
npm run test:integration            # smoke test against running instance
npm run test:integration:docker     # full Docker stack test (two phases)
```

Docker scripts for local testing environments: [Docker integration](docs/integration-docker.md).

## Dry test before pushing

Validates branch changes against a clone of the remote test server. Plan-only mode needs no Docker; full mode spins up a local stack and leaves it running for inspection.

```bash
npm run dry-test          # plan + Docker apply
npm run dry-test:plan     # plan only, no Docker
```

See [Dry test](docs/dry-test.md).

## CI/CD integration

```yaml
- run: npm test
- run: npm run lint
- run: npm run test:integration:docker
```

See [CI/CD](docs/ci-cd.md).

## Example project

The `examples/` directory contains a self-contained project (tables, roles, settings, reference data, seeds, migrations, change intents) used by integration tests.

## Safety defaults

- Preserve unexpected tenant fields/tables/data.
- Mark missing-in-Git tenant objects as orphaned/drift.
- Block ambiguous destructive changes.
- Require explicit `changes/*.json` intents for drops/renames in test/prod.
- Require backup/snapshot before prod apply.

## Documentation

- [Architecture](docs/architecture.md)
- [Project format](docs/project-format.md)
- [Normalization](docs/normalization.md)
- [Change intents](docs/change-intents.md)
- [Dangerous changes](docs/dangerous-changes.md)
- [Safety model](docs/safety-model.md)
- [CLI](docs/cli.md)
- [Environment setup and precedence](docs/environment-configuration.md)
- [Interactive UI deployment and implementation plan](docs/ui-deployment-workflow-plan.md)
- [Native adapter](docs/native-adapter.md)
- [REST adapter](docs/rest-adapter.md)
- [Plugin REST API](docs/plugin-api.md)
- [Reference data](docs/reference-data.md)
- [Seeds](docs/seeds.md)
- [CI/CD](docs/ci-cd.md)
- [Compatibility](docs/compatibility.md)
- [Native compatibility matrix](docs/native-compatibility-matrix.md)
- [Rollback](docs/rollback.md)
- [Dry test](docs/dry-test.md)
- [Docker integration](docs/integration-docker.md)
- [Installation](docs/installation.md)
- [Production safety](docs/production-safety.md)
- [Branch → Tenant design](docs/branch-tenant-design.md)
- [MVP plan](docs/mvp-plan.md)
- [Remaining plan](docs/remaining-plan.md)
