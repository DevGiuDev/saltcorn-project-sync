# UI migration plan: remove the UI layer, use Saltcorn markup directly

## New objective

Simplify the UI codebase aggressively.

Desired end state:

- no `lib/ui.js` abstraction layer
- no local fallback HTML renderer for views
- no extra UI wrapper layer on top of Saltcorn markup
- renderers use `@saltcorn/markup` directly
- fewer files, fewer helper indirections, less duplicated UI logic
- the UI is primarily **project-scoped**

## Progress snapshot

Implemented:

- removed `lib/ui.js`
- removed standalone `Overview`, `Status`, and `Health` renderers
- removed standalone project-nav renderer file
- `/project-sync` now redirects to `/project-sync/projects`
- `Status` and `Health` standalone pages now redirect to `Projects`
- `Settings` is now project-scoped via `?project_id=...`
- project navigation now includes `Settings`
- `Health` content has been folded into the Settings view
- global top navigation has been reduced to `Projects` and `Deployments`
- active renderers now use `@saltcorn/markup` through a minimal shared import module instead of the old UI abstraction layer

## Product/navigation decision

The UI should be reorganized around projects.

### Remove as primary standalone pages

- `Overview`
- `Status`
- standalone `Health`
- standalone `Settings`

### Keep as global pages

- `Projects`
- `Deployments`

### Move inside project

Each project becomes the main workspace. Inside a project we should expose tabs/sections for:

- Scope
- Git
- Live Diff
- Plan
- Approvals
- Settings

### Merge Health into project Settings

`Health` should stop being its own page and become a block inside project `Settings`.

### Status decision

`Status` looks unnecessary as a dedicated UI page.

Plan:

- remove the page
- review whether any small useful bits should survive
- if something is genuinely useful, move only that small piece into project `Settings` or `Projects`

## Review of the current state

Current UI complexity comes from three things:

1. `lib/ui.js` is large (`~650` lines) and behaves like a mini UI framework
2. renderers still compose a lot of raw HTML strings even when helpers exist
3. navigation was split between:
   - global nav
   - project nav
   - per-page sub-nav

Relevant files:

- `lib/ui.js` — biggest simplification target
- `lib/plugin/renderers/*.js` — most UI output lives here
- `lib/plugin/renderers/project-nav.js` — small but still an extra indirection layer
- `lib/plugin/scripts/*.js` — page interaction logic

Large renderers today:

- `lib/plugin/renderers/projects.js`
- `lib/plugin/renderers/live-diff.js`
- `lib/plugin/renderers/git.js`

Those three are the main sources of view complexity.

## Simplification decision

We should stop treating UI rendering as a portable subsystem.

Instead:

- treat this plugin UI as a Saltcorn-native UI
- depend directly on `@saltcorn/markup`
- let renderers import Saltcorn tags/helpers directly
- keep only tiny local helpers when they are domain-specific, not generic UI abstractions

That means the current `lib/ui.js` should be removed, not evolved.

## Architectural target

### Keep

- route modules
- renderer modules by page/section where it still improves readability
- small page-specific client scripts under `lib/plugin/scripts/`
- domain helpers that are not UI abstractions

### Remove

- `lib/ui.js`
- `lib/plugin/renderers/project-nav.js` if it becomes unnecessary
- duplicated generic UI wrapper helpers whose only job is to re-expose Saltcorn markup

### Replace with

Direct imports from Saltcorn markup in renderers, for example:

- tags
- layout utilities
- any standard Saltcorn markup helpers already available

If one or two tiny shared helpers remain, they should be:

- domain-specific
- very small
- not a second UI toolkit

Examples of acceptable tiny helpers:

- `loadScript(name)` because it is asset-loading, not UI abstraction
- a tiny project-tab helper only if inlining it in every project page is clearly worse

## Key design rule

No generic wrapper layer around Saltcorn markup.

Bad direction:

- `button()`
- `card()`
- `alert()`
- `badge()`
- `pageShell()`
- `filterableTable()`

if they only mirror Saltcorn/Bootstrap behavior.

Good direction:

- import Saltcorn markup directly in the page renderer
- compose the page there
- only extract helpers when the helper is specific to Project Sync semantics

## Recommended migration strategy

### Phase 1 — simplify information architecture first

Goal:

Reduce pages before rewriting renderers.

Tasks:

1. remove `Overview` as a standalone destination
2. remove `Status` as a standalone destination
3. fold `Health` into `Settings`
4. move `Settings` into the project workspace
5. reduce global navigation to:
   - Projects
   - Deployments

Acceptance criteria:

- project is the main place where work happens
- global navigation is minimal
- there is no duplicate global/project workflow navigation

### Phase 2 — remove the abstraction layer boundary

Goal:

- stop new code from depending on `lib/ui.js`

Tasks:

1. migrate one small renderer to direct `@saltcorn/markup`
2. establish the direct-render pattern
3. forbid new usage of `lib/ui.js`

Suggested first renderer now:

- `settings.js` (because it will absorb `health.js`)

Why:

- small enough to be manageable
- strategically useful because Settings is being redefined
- good place to set the pattern for a project-local settings block/page

### Phase 3 — migrate small/global remaining views

Target:

- `deployments.js`
- any minimal global `projects` list pieces that remain simple

Acceptance criteria:

- no dependency on `lib/ui.js` in those renderers
- global surface is already very small

### Phase 4 — migrate the project workspace views

Main project views:

- Project detail / Scope
- Git
- Live Diff
- Plan Preview
- Approvals
- Settings (with Health embedded)

Acceptance criteria:

- every project-scoped page shows project-local tabs
- users can move between sections without leaving project context
- no separate top menu is needed for workflow switching

### Phase 5 — delete `lib/ui.js`

Goal:

- fully remove the UI framework layer

Tasks:

1. migrate the last renderer imports
2. update route-level error pages to use direct markup too
3. remove all `require("../../ui")` / `require("../ui")`
4. delete `lib/ui.js`

Acceptance criteria:

- `lib/ui.js` is gone
- no page renderer depends on it
- no route helper depends on it

### Phase 6 — simplify helper/render files

Goal:

- reduce file count where it actually improves clarity

Candidates:

- inline `project-nav.js` into the project renderers if that is cleaner
- merge tiny renderers if they no longer justify a separate file
- keep `_shared.js` only if it still has a real purpose

Rule:

- shared file only survives if it removes meaningful duplication
- otherwise inline it

### Phase 7 — revisit scripts and view coupling

Goal:

- keep page JS lean and driven by stable DOM hooks

Tasks:

1. preserve external script files where they improve readability
2. remove inline script blobs from renderers when possible
3. pass page context with simple data attributes / one bootstrap variable

Note:

This is still compatible with the simplification goal because page scripts are functional assets, not a second UI framework.

## Dependency decision

To support direct rendering with Saltcorn markup, we should stop treating it as optional for UI code.

Recommended change:

- add `@saltcorn/markup` explicitly to package requirements used for development/testing of the plugin UI

Two valid options:

### Option A — dependency

Add `@saltcorn/markup` as a normal dependency.

Pros:

- simplest mental model
- easiest local tests
- no optional fallback logic

Cons:

- tighter package coupling

### Option B — peer + dev dependency

Add `@saltcorn/markup` as:

- peer dependency for Saltcorn runtime alignment
- dev dependency for local tests

Pros:

- explicit ecosystem alignment
- still testable locally

Cons:

- slightly more package metadata complexity

Recommended for the new direction:

- **Option A** for maximum simplicity

## File-level plan

### Delete

- `lib/ui.js`
- `lib/plugin/renderers/overview.js`
- `lib/plugin/renderers/status.js`

### Merge

- merge `lib/plugin/renderers/health.js` into project `settings.js`

### Strong candidates to delete after migration

- `lib/plugin/renderers/project-nav.js`
- possibly `lib/plugin/renderers/_shared.js` if only `loadScript()` remains and can be inlined or moved elsewhere

### Rewrite heavily

- `lib/plugin/renderers/projects.js`
- `lib/plugin/renderers/git.js`
- `lib/plugin/renderers/live-diff.js`
- `lib/plugin/renderers/approvals.js`
- `lib/plugin/renderers/settings.js`

### Light rewrite

- `lib/plugin/renderers/deployments.js`

### Route cleanup after renderer migration

- `lib/plugin/routes/pages.js`
- any route still exposing removed standalone pages
- any route still importing UI helpers for error pages

## Risks

1. tests currently benefit from local fallback rendering
2. direct markup migration may initially increase duplication inside renderers
3. large renderers (`git`, `live-diff`, `projects`) can become harder to read if not refactored carefully
4. moving Settings inside project changes assumptions in current routing and navigation

Mitigation:

- simplify page structure before deep UI rewriting
- migrate small pages first
- allow tiny domain helpers only where they clearly reduce noise
- keep data preparation separate from markup composition inside each renderer

## Final recommended order

1. remove Overview from navigation/flow
2. remove Status page
3. merge Health into Settings
4. move Settings into project context
5. migrate `settings.js` directly to Saltcorn markup
6. migrate `deployments.js`
7. migrate `projects.js`
8. migrate `git.js`
9. migrate `live-diff.js`
10. migrate `approvals.js`
11. remove route-level `ui` imports
12. delete `lib/ui.js`
13. delete or inline `project-nav.js`
14. simplify remaining renderer helper files

## Success criteria

The migration is successful when:

- `lib/ui.js` no longer exists
- renderers use Saltcorn markup directly
- Overview and Status no longer exist as standalone workflow pages
- Health exists only as part of project Settings
- Settings is reached from within a project, not as a primary global workflow page
- global navigation is minimal
- file count is lower
- UI code has fewer abstraction layers and less indirection
- a new contributor can open a renderer and immediately see the real markup structure without chasing wrappers
