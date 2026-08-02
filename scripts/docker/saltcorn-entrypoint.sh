#!/bin/sh
set -eu

log() {
  printf '[scps-docker] %s\n' "$*"
}

wait_for_postgres() {
  log "waiting for postgres at ${PGHOST:-postgres}:${PGPORT:-5432}"
  node <<'NODE'
const net = require('node:net');
const host = process.env.PGHOST || 'postgres';
const port = Number(process.env.PGPORT || 5432);
const deadline = Date.now() + 120000;
function tryOnce() {
  const socket = net.connect({ host, port });
  socket.setTimeout(2000);
  socket.on('connect', () => { socket.end(); process.exit(0); });
  socket.on('timeout', () => socket.destroy());
  socket.on('error', () => {});
  socket.on('close', () => {
    if (Date.now() > deadline) { console.error(`Timed out waiting for ${host}:${port}`); process.exit(1); }
    setTimeout(tryOnce, 1000);
  });
}
tryOnce();
NODE
}

wait_for_postgres

if [ "${SCPS_RESET_SCHEMA:-1}" = "1" ]; then
  log "resetting Saltcorn schema for disposable integration environment"
  printf 'y\n' | saltcorn reset-schema
else
  log "SCPS_RESET_SCHEMA=${SCPS_RESET_SCHEMA}; skipping reset-schema"
fi

if [ -n "${SCPS_PLUGIN_NPM_SPEC:-}" ]; then
  log "installing saltcorn-project-sync plugin from npm spec ${SCPS_PLUGIN_NPM_SPEC}"
  saltcorn install-plugin -p "${SCPS_PLUGIN_NPM_SPEC}"
elif [ -n "${SCPS_PLUGIN_DIRECTORY:-}" ]; then
  log "installing packed saltcorn-project-sync plugin from ${SCPS_PLUGIN_DIRECTORY}"
  saltcorn install-plugin -d "${SCPS_PLUGIN_DIRECTORY}"
else
  log "installing saltcorn-project-sync plugin from /plugin"
  saltcorn install-plugin -d /plugin
fi

# Install common type plugins needed by the project
# saltcorn add-plugin installs from npm by name
log "installing uuid-type plugin (required by project tables)"
saltcorn install-plugin -n uuid-type 2>/dev/null || true

# Create admin user for UI access
SCPS_ADMIN_EMAIL="${SCPS_ADMIN_EMAIL:-admin@saltcorn.local}"
SCPS_ADMIN_PASSWORD="${SCPS_ADMIN_PASSWORD:-admin123}"
log "creating admin user: ${SCPS_ADMIN_EMAIL}"
saltcorn create-user --email "${SCPS_ADMIN_EMAIL}" --password "${SCPS_ADMIN_PASSWORD}" --admin 2>/dev/null || log "admin user already exists"

PROJECT_DIR="${SCPS_PROJECT_DIR:-/project}"

if [ -f "${PROJECT_DIR}/saltcorn.project.json" ]; then
  log "found Saltcorn project at ${PROJECT_DIR}"
  # Use integration lock if present (fewer plugin dependencies for clean Docker)
  INTEGRATION_LOCK="${PROJECT_DIR}/plugins.lock.integration.json"
  PRODUCTION_LOCK="${PROJECT_DIR}/plugins.lock.json"
  LOCK_FILE=""
  if [ -f "${INTEGRATION_LOCK}" ]; then
    log "using plugins.lock.integration.json for Docker test"
    cp "${INTEGRATION_LOCK}" "${PRODUCTION_LOCK}"
    LOCK_FILE="${INTEGRATION_LOCK}"
  elif [ -f "${PRODUCTION_LOCK}" ]; then
    LOCK_FILE="${PRODUCTION_LOCK}"
  fi
  # Pre-install all plugins from the lock file before starting Saltcorn
  # so that viewtemplates (JsCodeView, etc.) are available at render time
  if [ -n "${LOCK_FILE}" ]; then
    log "pre-installing plugins from lock file"
    node - "${LOCK_FILE}" <<"NODE"
const fs = require('fs');
try {
  const lock = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (const p of (lock.plugins || [])) {
    console.log('  plugin: ' + p.name);
  }
} catch(e) { console.error('Failed to parse lock file:', e.message); }
NODE
    # shell loop to install each plugin
    for pname in $(node -e "const fs=require('fs');try{const l=JSON.parse(fs.readFileSync('${LOCK_FILE}','utf8'));l.plugins?.filter(p=>!['builtin','bundled'].includes(p.source)).forEach(p=>console.log(p.name))}catch(e){}" ); do
      log "  installing plugin: ${pname}"
      saltcorn install-plugin -n "${pname}" 2>/dev/null || log "  WARNING: could not install ${pname}"
    done
  fi
  # Project apply is done via REST after Saltcorn starts, not here.
  # The integration-smoke / integration-docker-run script handles it.
else
  log "no saltcorn.project.json found at ${PROJECT_DIR}; running without project"
fi

log "starting Saltcorn"
exec saltcorn serve
