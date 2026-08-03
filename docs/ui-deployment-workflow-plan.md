# UI deployment workflow plan

## Objective

Make the Saltcorn UI the primary interactive deployment surface while keeping
the CLI as an equivalent manual/automation client and as the recommended CI
entrypoint.

The target experience is:

1. a configured online environment is selected;
2. the desired Git revision is resolved;
3. the target exports its current tenant state and returns an immutable plan;
4. an administrator reviews and confirms that exact plan from a browser;
5. the server revalidates, optionally backs up, applies, refreshes and verifies;
6. the same target displays the authoritative receipt.

The browser never invokes a shell command or the CLI directly. UI deployment
uses a server-side orchestration service with the same planner, policies and
adapters as the CLI.

## Three supported entrypoints

| Entrypoint | Desired state comes from | Confirmation | Intended use |
| --- | --- | --- | --- |
| UI | Exact Git commit staged by the target server | Saltcorn admin in browser | Routine interactive deployment |
| CLI | Checkout on the machine running the CLI | Terminal prompt or `--yes` | Manual operations and diagnostics |
| CI | Checked-out commit from a branch/tag workflow | Protected CI environment/rules | Deployment after push/merge |

All three must produce the same operation plan, enforce the same environment
policy and write to the target-side deployment ledger.

## Source-of-truth decision

The UI cannot see uncommitted files on a developer laptop. The normal UI flow
therefore starts after `git commit` and `git push`:

```text
laptop edit → commit → push
                      ↓
VPS fetch exact commit → preview → confirm → deploy
```

The target must not switch or pull its active plugin/project working tree while
preparing a deployment. It should fetch and materialize the selected commit in
a temporary isolated worktree, then load desired state from that immutable
directory. Test and production deployments only accept committed revisions.

An optional `working_tree` source may be retained for local/dev diagnostics,
clearly marked as unaudited and unavailable to CI, test and production.

## Reviewed user flow

### 1. Select target and source

The deployment page is project-scoped and opens with:

- environment, tenant and base URL;
- configured repository and expected branch;
- current deployed version/commit;
- remote branch/tag/commit to deploy;
- connection, repository, permission and adapter health.

The default ref is the branch configured for the selected environment. The UI
shows the resolved commit SHA; a branch name alone is never the approved unit.

### 2. Prepare immutable preview

The server:

1. acquires a short preview lock;
2. fetches the selected ref without changing the active checkout;
3. creates an isolated checkout at the resolved SHA;
4. validates manifest, intents, dependencies and environment policy;
5. exports current tenant state;
6. calculates the plan;
7. computes digests for desired state, actual state and plan;
8. stores a short-lived deployment request containing only identifiers,
   digests and sanitized summaries.

Complete desired/actual state is not persisted in deployment history.

### 3. Review plan

Use an operational, high-density review surface consistent with the existing
Saltcorn console. It contains:

- target header: environment, tenant, branch, commit and version;
- preflight checklist;
- counts grouped as safe, destructive, warnings and blockers;
- expandable operation rows with object/table/field targets;
- orphaned objects explicitly labelled “preserved”;
- backup policy and selected provider;
- expiry time and plan digest;
- disabled confirmation while blockers exist.

The memorable visual element is a deployment rail showing the state transition:

```text
SOURCE → PREFLIGHT → PLAN → BACKUP → APPLY → VERIFY → RECEIPT
```

Destructive operations require both an explicit Git change intent and a second
UI acknowledgement. For test/prod the administrator types the environment
name before the confirmation button is enabled.

### 4. Confirm exact plan

Confirmation sends the deployment request ID and plan digest, not an arbitrary
plan supplied by the browser. The server then:

1. obtains an exclusive project/environment deployment lock;
2. verifies the request is unexpired and unused;
3. verifies admin identity and same-origin CSRF protection;
4. resolves the Git ref again and requires the same commit;
5. re-exports actual tenant state and recalculates the plan;
6. requires desired, actual and plan digests to match the preview.

If the branch or tenant changed, nothing is applied. The request becomes
`stale` and the user must review a new preview.

### 5. Execute and report

The orchestration job transitions through:

```text
confirmed → backup → applying → refreshing → verifying → applied
                                                    └→ drifted
```

Failures use explicit states such as `backup_failed`, `apply_failed`,
`refresh_failed` and `verify_failed`. The browser polls a job endpoint and
renders each completed step. A job may be cancelled only before apply starts.

The final receipt links to the authoritative target ledger record and includes
commit, environment, sanitized operation summary, backup receipt, convergence
result, timestamps and actor/source (`ui`, `cli` or `ci`).

## Backup policy

The existing policy already distinguishes environments:

| Environment | Current/default policy | UI behaviour |
| --- | --- | --- |
| `local` | recommended | Optional; warning when skipped |
| `dev` | recommended | Optional; selected by default when a provider is ready |
| `test` | required | Confirmation blocked without verifiable backup |
| `prod` | required | Confirmation blocked without verifiable backup |

Production must never weaken the backup requirement. This is a repository
safety invariant. Test remains required by the current policy. Local/dev may
configure `backup_policy: optional` and choose not to create a backup.

The CLI attempts `adapter.backup()` during `deploy` by default. `--skip-backup`
may explicitly omit it when the effective policy is optional; test/prod and
profiles configured as required reject that flag. The shared policy is:

- `required`: backup must succeed and be verifiable;
- `optional` with backup selected: failure stops by default; local/dev UI may
  explicitly review again and continue without it;
- `optional` with backup skipped: continue with a recorded warning;
- CI never silently continues after a requested backup fails.

## Where backup scripts come from

No universal backup script is bundled today. Saltcorn installations vary:
native snapshot APIs differ by version, Postgres may run on the host or in
Docker, and operators may use filesystem snapshots or managed database
backups. The current native adapter therefore delegates to process variables:

- `SALTCORN_PROJECT_SYNC_BACKUP_CMD`;
- `SALTCORN_PROJECT_SYNC_RESTORE_CMD`.

For REST deployment these commands run on the target Saltcorn server, not on
the laptop. They are supplied by the server operator and must return JSON.

The implemented UI deployment work replaces the vague “script” concept with
explicit backup providers:

1. `command`: administrator-managed executable referenced by an environment
   variable, never arbitrary command text stored in Git/UI;
2. `none`: allowed only when environment policy is optional.

A future `saltcorn` provider can use a stable native snapshot API when one is
available for the installed Saltcorn version.

The command provider contract should receive sanitized deployment context on
stdin and return a receipt with `ok`, `id`, `created_at`, `path`/`artifact`,
`sha256`, provider and tool version. Restore uses that receipt as input.

Phase 5 diagnostics must report provider availability and version without
creating a backup. Documentation should include separate operator recipes for
Saltcorn-native, Docker/Postgres and host-managed installations; those recipes
are examples, not silently installed executable scripts.

## Implemented status

The interactive UI path is now implemented through UI Deploy 4:

- exact Git ref resolution and isolated commit checkout;
- validation, live export, immutable plan/digest preview, and expiry;
- same-origin admin-only review and confirmation UI;
- server-side destructive confirmation and tenant identity check;
- re-resolution and desired/actual/plan digest revalidation;
- command/none backup providers with optional/required environment policy;
- backup, apply, state refresh, convergence verification, progress polling,
  terminal failure classification, and authoritative receipt;
- a project/environment target lock shared with the Bearer REST apply path.

CLI uses the same backup policy and target lock protocol while retaining its
existing command-oriented orchestration wrapper. The remaining hardening work
is provider version diagnostics, full migration of every CLI execution step to
the shared orchestrator, and Docker end-to-end parity coverage; those stay in
Phase 5.

## Server-side components

### Shared orchestrator

Extract the CLI deployment pipeline into `lib/deploy-orchestrator.js`. It owns:

- compatibility and dependency preflight;
- immutable plan creation and operation classification;
- environment/destructive/backup policy;
- backup, apply, refresh and convergence sequence;
- sanitized event/receipt generation.

It accepts a source provider and tenant adapter so UI, CLI and CI share policy
without sharing transport or filesystem assumptions.

### Deployment requests

Add a plugin-owned `_sc_ps_deployment_requests` table with:

- request ID, project ID, environment and actor;
- source type/ref and resolved commit SHA;
- desired/actual/plan digests;
- sanitized operation/warning/blocker summaries;
- backup choice and policy;
- status, creation/expiry/confirmation timestamps;
- resulting deployment ID.

Requests are short-lived, one-time and distinct from permanent deployment
history. Never store tokens or complete desired/actual project state.

### Locking

Use a Postgres advisory lock or lock row scoped to tenant + project +
environment. Only one apply may run for a target at a time, regardless of
whether it originated from UI, CLI or CI.

### Proposed routes

```text
GET  /project-sync/projects/:id/deploy
GET  /project-sync/api/projects/:id/deploy/context?environment=dev
POST /project-sync/api/projects/:id/deploy/preview
POST /project-sync/api/deployment-requests/confirm
POST /project-sync/api/deployment-requests/cancel
GET  /project-sync/api/deployment-requests/:requestId
```

Preview and confirm require a same-origin Saltcorn admin session. The existing
Bearer-only apply endpoint remains for CLI/CI. UI confirmation invokes the
internal orchestrator and native adapter; it does not relax the generic REST
apply authorization rule.

The preview derives desired scope from the object files in the selected commit.
Objects not yet tracked by the target tenant scope are shown in Deploy itself,
included in the confirmed plan digest, and added to target scope only after the
post-apply convergence check succeeds. Operators do not need to leave Deploy
for Live Diff or Scope before applying a newly committed object.

## CI branch flow

The initial CI path stays simple and explicit:

```text
push/merge to configured branch
  → CI checks out exact commit
  → validate + tests
  → sc-project-sync deploy --env dev --yes --request-id <workflow-id>
  → target ledger receipt
```

Protected environments can require Git-provider approval before the deploy
job. Branch-to-environment mapping determines which profile is selected, but
the workflow passes `--env` explicitly. CI tokens remain in the provider's
secret store.

Webhook-triggered server deployment may be considered later, after signed
payload verification and replay protection; it is not needed for the first UI
deployment release.

## Delivery sequence

### UI Deploy 1 — Shared orchestration and policy

- Extract deploy steps from the CLI without changing current CLI behaviour.
- Model backup as `required` or `optional` and remove implicit assumptions.
- Add operation classification, digests and sanitized events.
- Add parity tests proving CLI plans/receipts remain unchanged.

### UI Deploy 2 — Immutable source and preview requests

- Add Git-ref source provider and isolated exact-commit checkout.
- Add deployment request storage, expiry and digest validation.
- Add preview/context endpoints and stale-plan tests.
- Reject dirty/uncommitted sources outside local/dev diagnostic mode.

### UI Deploy 3 — Review and confirmation UI

- Add the project-scoped Deploy tab and deployment rail.
- Render preflight, operations, warnings, blockers and backup policy.
- Add normal and destructive confirmation interactions.
- Add polling, cancellation-before-apply and accessible failure states.

### UI Deploy 4 — Execution, locking and ledger

- Add cross-entrypoint deployment lock.
- Run backup/apply/refresh/verify through the shared orchestrator.
- Record started and terminal states in the authoritative ledger.
- Link UI request, job and deployment receipts.

### UI Deploy 5 — Backup providers and CI parity

- Add provider diagnostics and version reporting.
- Document provider recipes and restore contracts.
- Migrate CLI/CI to the shared policy and lock protocol.
- Add Docker integration coverage for UI, CLI and CI entrypoints.

## Acceptance criteria

- An admin can select a configured environment, preview and confirm a safe
  deployment entirely from the target UI.
- The preview identifies an exact commit and cannot be applied after source or
  tenant state changes.
- The UI never executes browser-supplied shell commands or arbitrary plans.
- UI, CLI and CI enforce identical destructive and backup policies.
- Local/dev backups are explicitly optional; test/prod backups remain required.
- Concurrent UI/CLI/CI applies to the same target cannot overlap.
- Every attempt reaches a terminal request state and an authoritative target
  receipt without persisting secrets or complete project states.
- Successful apply automatically refreshes and verifies convergence.
- CI can deploy an exact pushed commit with a stable idempotency request ID.
