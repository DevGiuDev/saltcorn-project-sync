# CI/CD

Saltcorn Project Sync is designed so Git hosts can validate and promote app changes.

## Validation pipeline

Recommended checks:

```bash
npm test
npm run lint
saltcorn-project-sync validate
saltcorn-project-sync deps
saltcorn-project-sync plan --env test --backup --tenant-export tenant-export.json
```

## Promotion flow

1. Developers export local/dev tenant changes to project JSON.
2. Commit and open pull request.
3. CI runs syntax/tests/project validation.
4. Merge to integration branch.
5. Deployment job runs `git pull`, creates backup, runs plan, then apply.
6. Deployment record is written with commit, environment, operation count, warnings, and backup metadata.

## Production gate

Production deploys should require:

- clean Git checkout
- validated manifest
- validated change intents
- dependency check with no missing dependencies
- backup/snapshot metadata
- no blocked operations in plan
- human approval for destructive intents
