# Compatibility checks

Use `check-live` to compare the project requirements with a live tenant export.

```bash
saltcorn-project-sync check-live --adapter command
saltcorn-project-sync check-live --adapter native
```

Checks include:

- Saltcorn minimum version from `saltcorn.project.json`.
- Required plugins from `plugins.lock.json`.
- Plugin version mismatches when both sides provide a version.

The `command` adapter can report Saltcorn version with:

```bash
SALTCORN_PROJECT_SYNC_SALTCORN_VERSION=1.5.7
```

or:

```bash
SALTCORN_VERSION=1.5.7
```

The `native` adapter tries to read `@saltcorn/data/package.json`.
