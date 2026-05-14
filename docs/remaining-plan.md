# Remaining plan

This plan only lists pending work from the original objective. Already implemented items are covered in the existing docs and test project history.

## 1. Stabilize real Saltcorn integration

- ✅ Validate the native adapter against the supported Saltcorn line, starting with `saltcorn/saltcorn:latest` (`1.6.0-beta`) in Docker. Full project deploy-to-clean-Docker validated with BuyApp (88 business tables, 1360 fields, 33 views, 6 pages, 6 triggers).
- Native adapter calls `Table.state_refresh()` before applyPlan to keep Saltcorn's in-memory table cache in sync.
- Native adapter creates fields via `Field.create` separately after `Table.create` (Saltcorn only creates PK in Table.create).
- Resolves `reftable_name → reftable_id` for Key fields; skips gracefully when referenced table is plugin-managed (sec_user, sys_file, etc.).
- Resolves `table_name → table_id` for triggers and views (not DB columns, must be converted).
- Strips runtime-only properties (`table`, etc.) before passing to model create/update to avoid "column does not exist" errors.
- Second apply converges: 145 → 204 → 20 → 14 ops (stable residual from plugins/views not installable in clean Docker).
- Delta apply validated: added a field on disk → apply detected `create_field` → field created in tenant → removed from disk → orphan warning, no auto-drop.
- ✅ Replace best-effort model calls with version-aware adapter methods where Saltcorn APIs differ.
- ✅ Add clearer adapter capability reporting for tables, fields, views, pages, triggers, roles, plugins, settings, and menu.
- ✅ Improve error messages when a Saltcorn model method is unavailable or behaves differently.

## 2. Complete apply coverage

- Validate and harden real apply for:
  - ✅ views
  - ✅ triggers
  - ✅ roles
  - ✅ menu
  - ✅ settings
  - ✅ plugin lock changes
- Add explicit tests for:
  - ✅ `rename_field`
  - ✅ `rename_table`
  - ✅ `alter_field_type`
  - ✅ `copy_field_data`
  - ✅ reference data upsert against adapter-backed tenant rows
- Keep the current safety rule: missing objects in Git must not imply automatic delete/drop.

## 3. Backup and rollback integration

- ✅ Not needed — project files on disk ARE the backup. `apply` against any clean Saltcorn instance restores the full schema. No `pg_dump`/`pg_restore` required.
- ✅ `test` and `prod` apply require verifiable backup metadata (command hook based).
- ✅ Record rollback deployments distinctly from normal deployments.
- ~~Replace command-hook-only backup with real Saltcorn backup/snapshot integration where available.~~ Not applicable.
- ~~Add restore smoke tests against a disposable tenant/database.~~ Not applicable — restore IS apply.

## 4. Live doctor and environment checks

- ✅ Add a first-class `doctor-live` command.
- ✅ Include checks for:
  - REST/plugin reachability
  - adapter capabilities
  - Saltcorn version
  - required plugins
  - Postgres sequence health for copied databases (via optional command hook)
  - token/auth configuration
- ✅ Move local sequence check scripts into reusable CLI functionality where appropriate.

## 5. Improve project format fidelity

- ✅ Normalize Saltcorn views/pages/triggers more semantically.
- ✅ Resolve tenant-local IDs to stable names before stripping them.
- ✅ Reduce noisy diffs from generated/default Saltcorn metadata.
- ✅ Decide how menu/settings should be represented long-term.
- ✅ Document unsupported or partially supported Saltcorn object shapes.
- ✅ Normalize object filenames with Unicode transliteration/diacritic stripping so names like `RemesasJS_Métricas` become `remesasjs_metricas.json` instead of `remesasjs_m_tricas.json`, and add collision handling for filesystem-safe names.

## 6. UI inside Saltcorn

- Build a real Saltcorn UI beyond the current status page:
  - ✅ project status
  - ✅ live diff
  - ✅ plan preview
  - ✅ warning/blocker display
  - ✅ deployment history
  - ✅ approval controls for dev/test/prod
- ✅ Auto-adopt an initial project in the plugin UI from `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` when no project exists.
- ✅ Build project scope from normalized native export so UI and CLI see the same tables/views/pages/triggers/roles/plugins.
- ✅ Deduplicate scope objects before rendering/saving to avoid unique-key errors when Saltcorn returns duplicate names.
- Keep Git operations in the CLI unless a secure server-side project root is explicitly configured.

## 7. Integration test suite

- ✅ Add automated smoke tests using a disposable Saltcorn instance and database via Docker (`npm run test:integration:docker`).
- Cover:
  - ✅ export
  - ✅ diff
  - ✅ plan
  - ✅ apply non-destructive changes
  - ✅ orphan preservation
  - ✅ explicit destructive intent
  - ✅ rollback/restore — restore IS apply (project files = backup)
  - ✅ seed/reset workflows for clean tenants (reset command + destructive seeds)
- Keep unit tests independent from a real Saltcorn runtime.

## 8. CI/CD hardening

- Keep lightweight unit/lint CI on GitHub.
- ✅ Add optional integration CI only when Saltcorn services are available.
- ✅ Produce machine-readable preflight output for deployment pipelines.
- ✅ Document recommended dev/test/prod pipeline gates.

## 9. Packaging and installation

- ✅ Document local plugin install, Git install, and eventual npm package install.
- ✅ Decide package naming/versioning strategy.
- ✅ Add release checklist.
- ✅ Validate plugin loading on a clean Saltcorn install via Docker stack bootstrap (`saltcorn reset-schema` + `saltcorn install-plugin -d /workspace`).

## 10. Seed/reset workflow

- ✅ Implement seed file loader, validator, and writer (`lib/seeds.js`).
- ✅ Implement migration file loader, validator, and writer.
- ✅ Add CLI commands: `list-seeds`, `list-migrations`, `add-seed`, `add-migration`, `apply-seeds`, `apply-migrations`.
- ✅ Integrate seed validation into `validate` command.
- ✅ Add native adapter execution for `seed_row`, `ensure_field`, `raw_sql`, `raw_command`.
- ✅ Add unit tests (91 passing).
- ✅ Document seed/migration format and safety rules in `docs/seeds.md`.
- ✅ Add example seed and migration files in `examples/`.
- ✅ Docker entrypoint supports `SCPS_APPLY_SEEDS=1` and `SCPS_APPLY_MIGRATIONS=1`.
- ✅ Docker integration smoke test covers seed/migration round-trip.
- Implement `reset` command that chains: schema reset, plugin install, project apply, seeds, migrations. ✅
- Add destructive seed modes (truncate/replace) with explicit intent gates. ✅

## 11. Production safety review

- ✅ Review all destructive operations and required intents.
- ✅ Review secret redaction coverage.
- ✅ Review tenant data exclusions.
- ✅ Review backup/restore guarantees.
- ✅ Document known limitations before production use.

## Current status — BuyApp pilot

- ✅ Full deploy-to-clean-Docker validated: 88 business tables, 1456 fields (163 Key fields with FK resolution), 33 views, 6 pages, 6 triggers.
- ✅ Two-pass apply eliminates forward FK reference issues — all 96 forward references resolved.
- ✅ Idempotent: second apply converges to 4 ops (2 FK fields to external tables + 2 plugin updates).
- ✅ State refresh propagates to all Saltcorn cluster workers via IPC.
- ✅ Docker test environment with admin user, pre-installed plugins, port 3333.
- ✅ Auth guard on all /project-sync UI and API routes.
- ✅ Diff clean: comparableField() strips auto-generated noise before comparison.
- ✅ DB verification: 118 tables in DB = 88 project tables + 29 `_sc_*` system tables + 1 `users`. No missing, no extra.
- `/home/devgiu/dev/saltcorn-buyapp` is initialized as a Git-backed project with all object files.

## Next — Pull/Push con dirección (metadata de sync)

### ✅ Hecho

- **Metadatos del proyecto en `saltcorn.project.json`**:
  - `version`: versión manual del proyecto (semver, default `0.1.0`)
  - `sync.last_sync`: ISO 8601 del último deploy completo
  - `sync.last_sync_epoch`: ms desde epoch (comparación rápida)
  - `sync.last_sync_commit`: hash git al momento del sync
  - `sync.last_sync_branch`: rama git al momento del sync
- **Detección de dirección automática**:
  - `computeFileSyncStatus()` compara timestamps de git log de cada archivo contra `last_sync`
  - Si archivo fue commiteado después del último sync → **push** (disco → live)
  - Si archivo NO fue commiteado después pero difiere del live → **pull** (live → disco)
  - Usa `git log -1 --format="%at" -- <file>` (no mtime del filesystem) para que funcione después de `git checkout`
  - Fallback a mtime si no es un repo git
- **Panel "Proyecto" en Live Diff**: muestra versión, rama git, commit, dirty status, último sync
- **Botones Push/Pull contextuales**:
  - Updated items: botón Push (verde) o Pull (azul) según dirección detectada
  - Orphaned: siempre Pull
  - Created: siempre Push
  - Dropdown por propiedad para ambos
- **API `POST /api/pull`**: pull selectivo (objeto completo o por propiedad)
- **API push**: pendiente (placeholder, usa CLI por ahora)
- **`stampSyncMeta()`**: se invoca en `writeProjectToDir()` para registrar el sync

### Pendiente

- **API `POST /api/push`**: push de un solo objeto del disco al tenant live
- **Pull de fields individuales** (requiere buscar dentro del archivo de tabla)
- **Workflow de cambio de ramas**: cada rama tiene su propio `sync.last_sync` en el manifest
- **CLI `stamp-sync`**: comando para marcar manualmente el sync timestamp
- **Version bump**: `scps version bump [major|minor|patch]`

## Next — Menu persistence

- Persist Saltcorn menu structure (`menu_items` config) as part of the project export.
- Menu items are stored as a `_sc_config` setting, not as a model — no `Menu` model exists in Saltcorn 1.6.0.
- Export: read `menu_items` from `_sc_config` and write to `objects/menu/menu_items.json` (or `settings/menu_items.json`).
- Apply: upsert `menu_items` into `_sc_config` via `getState().setConfig('menu_items', value)`.
- Diff: compare menu arrays by position/name to detect added/removed/reordered items.
- Handle subitems (dropdown menus) recursively.
- Separate project-specific menu items from Saltcorn built-in items (Admin Pages, User Pages) to avoid duplicating system entries on apply.
- Update `loadProjectState` / `normalizeProjectExport` to include menu items.
- Add integration test for menu round-trip.
- Grid pagination in tables/views in Project especification.
- Basic git integration.
- Deploy from cli will push all files in the repository?
