# Architecture

Saltcorn Project Sync has two parts:

1. **Saltcorn plugin** — tenant UI for selecting project objects, viewing diffs, importing/exporting, and reading deployment history.
2. **Companion CLI** — Git/filesystem/CI operations, canonical JSON writes, backups, pull/apply automation.

The plugin should not reimplement Git. It owns Saltcorn-aware semantics: which objects belong to a project, dependency resolution, safe comparison, and deployment records.

## Data flow: push

1. Select project manifest.
2. Resolve included objects and dependencies.
3. Export from Saltcorn or pack/snapshot.
4. Normalize internal IDs to portable references.
5. Canonicalize JSON.
6. Write files.
7. Show Git diff.
8. Commit/push.

## Data flow: pull/apply

1. `git pull`.
2. Load manifest and plugin lock.
3. Validate Saltcorn version/plugins.
4. Compare repository desired state with tenant actual state.
5. Generate application plan.
6. Split safe operations from destructive/ambiguous operations.
7. Require backup where policy demands it.
8. Apply allowed operations.
9. Record deployment by tenant and Git commit.

## Evolution path

MVP can use Saltcorn packs/snapshots for compatibility, but mature deployment should use semantic per-object JSON and explicit change intents for risky changes.
