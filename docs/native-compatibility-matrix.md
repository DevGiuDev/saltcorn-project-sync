# Native adapter compatibility matrix

Use this matrix to validate `--adapter native` against supported Saltcorn versions. The support floor is **Saltcorn 1.6.0**.

The native adapter loads `@saltcorn/data` models directly, so model method names can differ between Saltcorn releases. The adapter reports capabilities and clear skipped-operation reasons, but production support requires testing the exact target version.

## Validation command set

Run inside a configured Saltcorn runtime/tenant:

```bash
saltcorn-project-sync doctor-live --adapter native
saltcorn-project-sync export --adapter native --out /tmp/scps-native-export
saltcorn-project-sync apply --adapter native --env dev
```

For destructive/ambiguous operations, use a disposable tenant and explicit change intents.

## Matrix

| Saltcorn version | Node | DB | Export | Plan | Apply safe | Rename | Field type | Ref data | Backup | Restore | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.6.x | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | hook/native TBD | hook/native TBD | Needs disposable tenant validation |
| 1.7.x+ | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | hook/native TBD | hook/native TBD | Validate per release line |

## Operation checklist

- tables: create, rename
- fields: create, update, rename, alter type, drop with intent
- views/pages/triggers/roles: create, update, rename, drop with intent
- menu/settings: export/apply only when Saltcorn exposes compatible models
- plugins: lock install/update/drop intent behavior
- reference data: upsert without deleting orphan rows
- backups: verifiable metadata before test/prod apply
- rollback: distinct rollback deployment record

## Current status

Unit and adapter-backed fake model tests cover method selection and safety invariants. Real Saltcorn version validation still requires a disposable tenant for each supported release line, starting with 1.6.x.
