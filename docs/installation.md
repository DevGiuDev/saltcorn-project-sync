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
npm install --global saltcorn-project-sync@0.3.0
saltcorn-project-sync --help
```

The package exposes both command names:

```text
saltcorn-project-sync
sc-project-sync
```

Install the npm package as a Saltcorn plugin:

```bash
expected=0.3.0
test "$(npm view saltcorn-project-sync version)" = "$expected"
saltcorn install-plugin --npm saltcorn-project-sync
```

Saltcorn 1.6/1.7 treats the `--npm` value strictly as a package name. Do not
append `@version`: Saltcorn constructs a registry URL from that value and the
request fails with 404. Its installer selects the package version and records
that installed version in `_sc_plugins`; verify it after installation. For a
fully pinned emergency rollback, use the local Git installation below until a
version-selecting install command is available.

Restart Saltcorn after the first install or an upgrade so route changes are
loaded.

### Migrating an existing local plugin install

Saltcorn identifies installations from different sources as separate plugin
records. Installing from npm does not automatically replace an existing
`source=local` record with the same name. A safe migration is:

1. Create and verify a database backup.
2. Confirm the retained local checkout can still be mounted for rollback.
3. Run `saltcorn install-plugin --npm saltcorn-project-sync`.
4. Inspect `_sc_plugins` and verify the new npm row has the expected version.
5. Explicitly remove only the old local row, then restart Saltcorn.
6. Verify `/project-sync/api/info` and project convergence.

Do not restart with two `saltcorn-project-sync` rows left in `_sc_plugins`;
plugin load order would be ambiguous. The old local row may be restored with
`saltcorn install-plugin --directory /path/to/checkout`, followed by the same
explicit duplicate-row cleanup and a restart. Treat this as an operational
rollback: always take a backup and match on name, source, location, and version
before removing either record.

### Upgrading an already-installed npm plugin to a newer version

`saltcorn install-plugin --npm saltcorn-project-sync` always inserts a new
`_sc_plugins` row; it does not update an existing npm row in place. Running it
again for a version upgrade produces two rows with the same name/source/location
and different versions, which is the same ambiguous-load-order problem as
above.

Saltcorn's own admin "Upgrade" action avoids this by loading the existing
`Plugin` record and calling its `upgrade_version` method, which updates that
row's version in place instead of inserting a new one. For a scripted/headless
upgrade, reproduce that call directly against the already-running Saltcorn
process (module resolution requires a working directory inside the Saltcorn
install tree, e.g. `/opt/saltcorn` in the reference image):

```bash
cd /path/to/saltcorn/install # module resolution needs this to find @saltcorn/data
node <<'NODE'
(async () => {
  const Plugin = require("@saltcorn/data/models/plugin");
  const plugin = await Plugin.findOne({ name: "saltcorn-project-sync" });
  if (!plugin) throw new Error("Plugin not found");
  if (plugin.source !== "npm") throw new Error(`Expected npm source, got ${plugin.source}`);
  await plugin.upgrade_version((p, force) => Plugin.loadPlugin(p, force), "0.2.0");
  const after = await Plugin.findOne({ name: "saltcorn-project-sync" });
  if (after.id !== plugin.id) throw new Error("Upgrade created a new row instead of updating in place");
  console.log(after.version);
})().catch((err) => { console.error(err); process.exit(1); });
NODE
```

Always back up the database first, verify the version and row `id` are
unchanged after the upgrade, then restart Saltcorn and re-check
`/project-sync/api/info` and convergence.

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
