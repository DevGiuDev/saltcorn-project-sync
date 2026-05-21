# Installation

Saltcorn Project Sync has two install surfaces:

1. the Saltcorn plugin, loaded by Saltcorn
2. the companion CLI, run from a shell/CI runner

## Local development install

Clone the repository and run from source:

```bash
git clone https://github.com/your-org/saltcorn-project-sync.git
cd saltcorn-project-sync
npm install --ignore-scripts
node bin/saltcorn-project-sync.js --help
```

For a local Saltcorn server, install or symlink the plugin according to your Saltcorn development workflow, then restart Saltcorn so route changes are loaded.

Recommended environment for local UI/live diff:

```bash
SALTCORN_PROJECT_SYNC_PROJECT_ROOT=/path/to/git/project
SALTCORN_PROJECT_SYNC_API_TOKEN=dev-token
```

The Git panel can also be opened from a specific project that already has `root_path` set, in which case the `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` env var is not required for that project-scoped view.

## Git install

Until an npm package is published, deploy from a pinned Git commit/tag:

```bash
git clone https://github.com/your-org/saltcorn-project-sync.git /opt/saltcorn-project-sync
cd /opt/saltcorn-project-sync
git checkout <tag-or-commit>
npm install --omit=dev --ignore-scripts
npm link
```

Then use:

```bash
saltcorn-project-sync --help
```

For production, pin a tag/commit rather than deploying an unpinned branch.

## Future npm install

Package name strategy is currently:

```text
saltcorn-project-sync
```

The package exposes:

```text
saltcorn-project-sync
sc-project-sync
```

Expected future install:

```bash
npm install -g saltcorn-project-sync
```

## Clean Saltcorn validation

On a disposable Saltcorn install:

1. install/enable the plugin
2. restart Saltcorn
3. set `SALTCORN_PROJECT_SYNC_API_TOKEN`
4. verify:

```bash
curl -fsS -H "Authorization: Bearer $SALTCORN_PROJECT_SYNC_API_TOKEN" \
  http://localhost:3000/project-sync/api/info

curl -fsS -H "Authorization: Bearer $SALTCORN_PROJECT_SYNC_API_TOKEN" \
  http://localhost:3000/project-sync/api/export
```

Then from the CLI:

```bash
SALTCORN_PROJECT_SYNC_BASE_URL=http://localhost:3000 \
SALTCORN_PROJECT_SYNC_API_TOKEN=$SALTCORN_PROJECT_SYNC_API_TOKEN \
saltcorn-project-sync doctor-live --adapter rest
```

## Release checklist

Before tagging a release:

- `npm test`
- `npm run lint`
- `npm run test:integration` against a disposable Saltcorn tenant when available
- validate plugin route loading on a clean Saltcorn install
- rebaseline example/test projects if the project format changed
- review `docs/production-safety.md`
- update `CHANGELOG.md` if present
- create a Git tag and deploy by tag/commit
