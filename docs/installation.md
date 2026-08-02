# Installation

Saltcorn Project Sync has two install surfaces:

1. the Saltcorn plugin, loaded by Saltcorn
2. the companion CLI, run from a shell/CI runner

## Local development install

Clone the repository and run from source:

```bash
git clone https://github.com/DevGiuDev/saltcorn-project-sync.git
cd saltcorn-project-sync
npm ci --ignore-scripts
node bin/saltcorn-project-sync.js --help
```

For a local Saltcorn server, install or symlink the plugin according to your Saltcorn development workflow, then restart Saltcorn so route changes are loaded.

Recommended environment for local UI/live diff:

```bash
SALTCORN_PROJECT_SYNC_PROJECT_ROOT=/path/to/git/project
SALTCORN_PROJECT_SYNC_API_TOKEN=dev-token
```

The Git panel can also be opened from a specific project that already has `root_path` set, in which case the `SALTCORN_PROJECT_SYNC_PROJECT_ROOT` env var is not required for that project-scoped view.

## npm install

Install a pinned CLI version:

```bash
npm install --global saltcorn-project-sync@0.1.0
saltcorn-project-sync --help
```

The package exposes both command names:

```text
saltcorn-project-sync
sc-project-sync
```

Install the same version as a Saltcorn plugin:

```bash
saltcorn install-plugin --npm saltcorn-project-sync@0.1.0
```

Restart Saltcorn after the first install or an upgrade so route changes are
loaded. Production environments should pin an explicit package version.

## Pinned Git install

A pinned Git checkout remains available for plugin development and emergency
rollback:

```bash
git clone https://github.com/DevGiuDev/saltcorn-project-sync.git /opt/saltcorn-project-sync
cd /opt/saltcorn-project-sync
git checkout <tag-or-commit>
npm ci --omit=dev --ignore-scripts
npm link
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
