# AGENTS.md

Guidance for coding agents working on this repository.

## Project

`Saltcorn Project Sync` is a Saltcorn plugin plus companion CLI. It exports selected Saltcorn objects to deterministic JSON, stores them in Git, compares tenant state with repository state, and applies changes safely.

Core safety rule: **absence from Git is never an implicit destructive operation**. Missing fields/tables/etc. must be reported as drift/orphaned unless an explicit change intent authorizes destructive action.

## Development workflow

The plugin is installed in the Saltcorn tenant as a **local plugin pointing directly at this folder** (`/home/devgiu/dev/saltcorn-project-sync`). Saltcorn's hot-reload detects file changes and restarts the server automatically. **Do not run `install-plugin` after editing** — just save files and let the server pick up changes.

## Commands

- `npm test` — run Node test suite.
- `npm run lint` — syntax-check JavaScript files.
- `node bin/saltcorn-project-sync.js --help` — inspect CLI.

## Style

- Plain Node.js, CommonJS, no runtime dependencies unless justified.
- Keep JSON output canonical/deterministic.
- Prefer small modules under `lib/`.
- Treat CLI filesystem/Git operations separately from Saltcorn plugin UI code.
- Do not log secrets or tenant credentials.

## Safety invariants

- Never auto-drop fields, tables, or data from state diff alone.
- Destructive operations require explicit change intents under `changes/`.
- Production apply requires pre-apply backup/snapshot metadata.
- Environment-specific config/secrets must not be exported into project JSON.

## Repository layout

- `index.js` — Saltcorn plugin entrypoint.
- `bin/` — companion CLI.
- `lib/` — canonicalization, manifest, diff, planner, export/apply helpers.
- `docs/` — user and developer documentation.
- `examples/` — example project manifests and change intents.
- `test/` — Node test suite.
