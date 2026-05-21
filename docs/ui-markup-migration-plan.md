# UI migration plan: Saltcorn markup first

## Goal

Rebuild the Project Sync interface so it follows the Saltcorn UI ecosystem as closely as possible:

- prefer `@saltcorn/markup` components and Saltcorn conventions
- keep Bootstrap-compatible visuals
- avoid ad-hoc HTML string assembly where a markup helper exists
- preserve the current project-scoped navigation model
- keep a local fallback so tests and non-Saltcorn environments still work

## Review of the current state

Current UI architecture is centralized in `lib/ui.js`:

- it tries to load `@saltcorn/markup`
- when available, it uses Saltcorn tags/helpers
- otherwise it falls back to local HTML string builders

That is a good compatibility layer, but the renderers still use a lot of direct HTML concatenation:

- `lib/plugin/renderers/*.js`
- `lib/plugin/scripts/*.js`
- page bodies, cards, alerts, buttons, tables, and tab panes are still assembled as string templates

This means the current UI is functional, but not yet "Saltcorn-native" in the way the user interface is composed.

## What should change

### 1) Keep `lib/ui.js` as the UI abstraction layer

Do not remove the abstraction. Instead:

- make `lib/ui.js` the only place that knows about Saltcorn markup internals
- expose higher-level helpers for common patterns:
  - page shell
  - card
  - alert
  - button / button group
  - tabs / tab pane
  - table / filterable table
  - form fields
  - project navigation

This keeps the plugin portable and makes the migration incremental.

### 2) Replace string-heavy renderers with component composition

Target renderers:

- `overview`
- `projects`
- `git`
- `live-diff`
- `approvals`
- `settings`
- `health`
- `deployments`
- `status`

Preferred pattern:

- build data structures first
- pass them into reusable UI helpers
- avoid inline HTML blocks except for small escaped snippets

### 3) Make the project navigation a first-class component

The project-scoped tabs should become the main navigation for:

- Scope
- Git
- Live Diff
- Plan
- Approvals

This should be rendered as a reusable Saltcorn-style nav/tab component, not copied into each view.

### 4) Reduce inline scripts in page bodies

Current views still embed a lot of behavior in inline `<script>` tags.

Plan:

- move most interactions to small client-side modules under `lib/plugin/scripts/`
- keep only minimal bootstrapping in markup
- pass context via data attributes or a small JSON bootstrap object

### 5) Match Saltcorn styling and interaction patterns

Use the same visual language Saltcorn users expect:

- tabbed cards
- compact Bootstrap button groups
- badge-heavy summaries
- standard alert colors
- table filters and tags
- consistent iconography

## Migration phases

### Phase A — API mapping and component inventory

Deliverables:

- list of all UI helpers currently used
- map each helper to the corresponding Saltcorn markup primitive or wrapper
- identify what is missing and needs a custom helper

Acceptance criteria:

- no page renderer has to know about Saltcorn markup internals
- the migration list is explicit and ordered

### Phase B — shared markup primitives

Implement/clean up helpers for:

- `pageShell`
- `card`
- `button`
- `buttonGroup`
- `alert`
- `badge`
- `renderTabBar` / `renderTabPane`
- `filterableTable`
- `formField`
- `inputGroup`
- `projectNav`

Acceptance criteria:

- the same renderers work with the Saltcorn package and with fallback HTML
- markup output is stable in tests

### Phase C — project-scoped views

Rebuild these first because they define the new navigation model:

- Project detail
- Git
- Live Diff
- Plan Preview
- Approvals

Acceptance criteria:

- each view shows project tabs
- users can move between Scope/Git/Live Diff/Plan/Approvals without leaving the project context
- no view depends on the global top nav for primary workflow switching

### Phase D — overview and global pages

Rework:

- Overview
- Status
- Health
- Deployments
- Settings

Acceptance criteria:

- global pages retain Saltcorn-like structure
- project-scoped workflow stays in the project area
- overview is a dashboard, not a workflow router

### Phase E — script cleanup

Move repeated UI behavior into reusable scripts and keep renderers declarative.

Acceptance criteria:

- fewer inline scripts in renderers
- clearer separation between markup and behavior
- easier future theming

### Phase F — visual and compatibility verification

Test in two environments:

1. plain Node test suite with fallback HTML
2. inside Saltcorn with `@saltcorn/markup`

Acceptance criteria:

- tests pass in both modes
- rendered pages keep the same functional hooks
- the interface feels native in Saltcorn

## Recommended implementation order

1. tighten `lib/ui.js` helpers
2. finish project navigation as a reusable component
3. migrate `git`, `live-diff`, `plan-preview`, `approvals`
4. migrate `projects` and `overview`
5. move script-heavy bits out of renderers
6. simplify the global nav so it supports the new project-first workflow

## Notes

- Keep the local fallback HTML implementation until the Saltcorn markup path is stable.
- Prefer minimal churn in route handlers while the UI layer is being rebuilt.
- Keep canonical tests around the important helper output so changes remain safe.
