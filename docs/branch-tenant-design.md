# Branch → Tenant: Design Document

## Core Concept

Work on Git branches in parallel using a single Saltcorn instance. Each branch
gets its own PostgreSQL schema (tenant) — a full clone of the source — so you
can modify tables, views, and data without affecting other branches.

**There is NO schema merge.** Merge happens at the Git level (JSON files).
Then the plugin applies changes to the target branch's tenant.

```
        Branch: main              Branch: feature-x
        Schema: public            Schema: feature_x
        URL: localhost:3000       URL: feature-x.localhost:3000
             │                         │
             │    Independent work      │
             │◀────────────────────────▶│
             │                         │
        git merge feature-x ──▶ resolve JSON files
                                    │
                              plugin applies diff
                              to main's tenant
```

## Clone Strategy

### Why NOT `copy_tenant_template`

Saltcorn's built-in `copy_tenant_template` deliberately **deletes users**:
```js
await db.deleteWhere("users", {});
await db.reset_sequence("users");
```
It's designed for creating blank tenant templates, not full branch clones.

### Approach: `clone_schema()` PL/pgSQL function

Uses [pg-clone-schema](https://github.com/denishpatel/pg-clone-schema) — a battle-tested
PL/pgSQL function that clones **everything** in a single SQL call:

```sql
SELECT clone_schema('public', 'feature_x', 'DATA', 'NOOWNER');
```

Handles: tables (structure + data), 50 sequences, 57 foreign keys,
indexes, constraints, triggers, functions, types, comments, ACLs.

Installation:
```bash
node scripts/install-clone-schema.js
```

Implemented in `lib/branch-tenant.js` → `cloneSchemaData()`.

## Create Branch Flow

```
User clicks "Create branch: feature-x" in Git panel
  │
  ├─ 1. Git:       git checkout -b feature-x
  ├─ 2. Register:  insertTenant("feature_x") → row in _sc_tenants
  ├─ 3. Schema:    cloneSchemaData("public", "feature_x")
  │                → CREATE SCHEMA + LIKE + INSERT for all tables + reset seqs
  ├─ 4. Files:     cp -r file_store/public file_store/feature_x
  ├─ 5. Saltcorn:  add_tenant() + load plugins
  ├─ 6. Config:    update base_url → http://feature-x.localhost:3000
  ├─ 7. Map:       branches.json records branch→tenant
  └─ 8. Redirect:  → http://feature-x.localhost:3000 (login with same creds)
```

## Switch Branch Flow

```
Switch to existing branch:
  ├─ 1. git checkout feature-x
  └─ 2. Redirect to http://feature-x.localhost:3000
```

## Merge Flow (git-level, NO schema merge)

```
1. git checkout main
2. git merge feature-x       ← JSON files merged by git
3. Plugin diff + apply        ← existing push-drift engine applies changes
4. Optional: delete branch   ← git branch -d + DROP SCHEMA
```

The schemas are independent. Merge happens at the **file** level (JSON),
then the plugin applies those file changes to the target tenant.

## Delete Branch Flow

```
  ├─ deleteTenant()           → DROP SCHEMA CASCADE + DELETE _sc_tenants
  ├─ rm -rf file_store/<tenant>
  ├─ git checkout main (if on branch)
  ├─ git branch -d <name>
  └─ remove from branches.json
```

## Session / Auth

- `_sc_session` only exists in `public` schema
- Cookies are per domain → user logs in again on new subdomain
- Same credentials work because users are cloned

## Edge Cases

### Branch name → schema name
- `feature/auth-module` → `feature_auth_module` (lowercase, no slashes/dots)
- Max 63 chars (PostgreSQL limit)

### Concurrent branches
- Multiple branches active simultaneously, independent schemas
- Shared: only `_sc_session` (per-cookie, no conflict)
- Shared: Node.js process (`runWithTenant` handles isolation)

### Data divergence
- Expected and desirable — each branch is independent
- Only structure (tables, views, fields) is managed via git/JSON
- Business data diverges naturally between branches

## API Endpoints

```
POST /project-sync/api/branches/create  { branch, source? }
POST /project-sync/api/branches/switch   { branch }
DELETE /project-sync/api/branches/:name
GET  /project-sync/api/branches
```
