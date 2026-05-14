# Remaining plan

Pending work not yet implemented. Completed items are in git history.

## Pendiente futuras

- **Añadir remote desde la UI del plugin**: permitir al usuario configurar el remote de Git (add/set-url) desde la página de Git o Settings. Actualmente falla con error claro pero no ofrece solución interactiva.
- **API `POST /api/push`**: push de un solo objeto del disco al tenant live
- **Pull de fields individuales** (requiere buscar dentro del archivo de tabla)
- **Workflow de cambio de ramas**: cada rama tiene su propio `sync.last_sync` en el manifest
- **CLI `stamp-sync`**: comando para marcar manualmente el sync timestamp
- **Version bump**: `scps version bump [major|minor|patch]`

## Menu persistence

- Persist Saltcorn menu structure (`menu_items` config) as part of the project export.
- Menu items are stored as a `_sc_config` setting, not as a model — no `Menu` model exists in Saltcorn 1.6.0.
- Export: read `menu_items` from `_sc_config` and write to `objects/menu/menu_items.json` (or `settings/menu_items.json`).
- Apply: upsert `menu_items` into `_sc_config` via `getState().setConfig('menu_items', value)`.
- Diff: compare menu arrays by position/name to detect added/removed/reordered items.
- Handle subitems (dropdown menus) recursively.
- Separate project-specific menu items from Saltcorn built-in items (Admin Pages, User Pages) to avoid duplicating system entries on apply.
- Add integration test for menu round-trip.

## CI/CD y despliegue

- Revisar planteamiento de integración continua:
  - Despliegue hacia una instancia Saltcorn existente (diff + apply incremental)
  - Despliegue a una instancia nueva de cero (full apply desde repo Git)
  - Flujo CLI vs plugin UI: qué operaciones deben estar en cada uno
  - Gates de aprobación por entorno (dev → test → prod)
  - Integración con pipelines existentes (GitHub Actions, etc.)
  - Automatización de `fetch → diff → plan → apply` desde CI

## UI / UX improvements

- Grid pagination in tables/views in Project specification.
- Deploy from CLI will push all files in the repository?
