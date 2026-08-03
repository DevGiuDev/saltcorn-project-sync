# Environment setup and precedence

Saltcorn Project Sync can be prepared from **Project Sync → Projects → Settings**. The setup page stores operational configuration in the plugin-owned `_sc_ps_environment_configs` table; it is not part of project scope and is never exported to Git.

## Source versus target

`--env` is the logical **deployment target**, not the machine where the
command happens to run. For example, when a developer runs
`sc-project-sync deploy --env test` from a laptop, the checkout and CLI are on
the laptop but `base_url`, `tenant`, the API token, and the backup operation
refer to the remote **test Saltcorn tenant**. The same command with `--env prod`
targets production.

| Setting | Meaning | Belongs to |
| --- | --- | --- |
| `environment` / `--env` | Named target profile (`local`, `dev`, `test`, `prod`) | Final deployment target |
| `project_root` / `root_path` | Checkout containing the desired project files | Machine running the CLI; server filesystem when configured in the UI |
| `repository` | Non-secret Git origin metadata | Project, not a tenant connection |
| `adapter` | How the CLI reaches the target (`rest`, `command`, `native`) | Machine running the CLI and its target integration |
| `base_url` | Saltcorn HTTP URL to deploy to | Final target tenant |
| `branch` | Git branch associated with the target | Source checkout / branch-to-tenant policy |
| `tenant` | Saltcorn tenant/schema to operate on | Final target tenant |
| `token_env` | Name of the local/CI variable holding the target API token | Secret store of the CLI runner; token authenticates the target |
| `backup_policy` | Whether a backup is `optional` or `required`; `test`/`prod` always force `required` | Final deployment target |
| `ui_mode` | Navigation role: `full`, `workspace`, or `deployment` | Saltcorn server displaying the plugin UI |
| `backup_hook_env` / `restore_hook_env` | Name of a variable containing a backup/restore command | Process that performs the operation: VPS for UI/native or REST target; CLI runner for `command` |
| `transport` and `ssh_*` | Network path from the CLI runner to the target | CLI runner and bastion/network path |

The UI is installed on the target Saltcorn server, so its `root_path` and
runtime hook references describe that server. A CLI profile is read from the
checkout on the machine running the CLI. They may describe the same logical
environment, but they are not required to use the same filesystem path.

For each project and target environment, the wizard configures:

- checkout root and non-secret repository URL;
- adapter (`native`, `rest`, or `command`) and tenant base URL;
- branch and tenant mapping;
- direct HTTPS or managed SSH tunnel transport;
- names of environment variables containing the API token and backup/restore commands.

The final health table checks repository presence, read/write permissions, profile validity, transport, live connectivity, and backup/restore readiness. `Ready` means every check passed.

## Precedence

From highest to lowest:

1. process environment variables;
2. `environments/<env>.json` in the project checkout;
3. configuration saved in the project UI;
4. built-in defaults.

The settings page displays the effective value and source for each field. The CLI reads the first two layers because it may run on a different machine from Saltcorn. The server UI resolves all four.

Supported non-secret profile keys include:

```json
{
  "adapter": "rest",
  "base_url": "https://saltcorn.example.com",
  "backup_policy": "required",
  "backup_hook_env": "BUYAPP_BACKUP_COMMAND",
  "branch": "main",
  "environment": "test",
  "repository": "https://github.com/example/app.git",
  "restore_hook_env": "BUYAPP_RESTORE_COMMAND",
  "tenant": "public",
  "token_env": "BUYAPP_PROJECT_SYNC_TOKEN",
  "transport": "direct",
  "ui_mode": "deployment"
}
```

Ejemplo de ejecución desde un portátil hacia `test`:

```bash
export PROJECT_SYNC_TEST_TOKEN='token-del-tenant-test'
sc-project-sync doctor-live --adapter rest --env test
sc-project-sync deploy --adapter rest --env test
```

En este ejemplo, `base_url` apunta al Saltcorn de test y el token pertenece a
ese tenant. No se usa la URL ni el token del portátil: el portátil sólo aporta
el checkout, el perfil y las credenciales para alcanzar el destino.

Para un despliegue local, usa otro perfil explícito:

```bash
sc-project-sync doctor-live --adapter native --env local
sc-project-sync deploy --adapter native --env local
```

## Receta completa: portátil → VPS de desarrollo

Este es el procedimiento recomendado cuando el código deseado está en el
portátil y el Saltcorn de destino vive en un VPS.

### 1. Preparar el VPS

1. Instala el plugin `saltcorn-project-sync` en el Saltcorn del VPS.
2. Publica el VPS detrás de HTTPS, por ejemplo
   `https://dev.example.com`. El CLI usará los endpoints
   `/project-sync/api/*`.
3. Desde la UI del plugin, crea o selecciona un proyecto. Si quieres usar la
   pantalla de salud y las operaciones Git en el VPS, configura un
   `root_path` que exista en el VPS; no tiene que ser la misma ruta que en el
   portátil.
4. En `Settings`, selecciona el entorno lógico `dev`, el adaptador `rest` y
   esa URL HTTPS.
5. Genera un API token y cópialo inmediatamente. Guárdalo en el gestor de
   secretos del portátil o de CI, nunca en Git.

El token generado se almacena como hash en el VPS. El valor que copias sólo se
puede volver a obtener generando otro token.

### 2. Preparar un backup real en el VPS

El endpoint REST de backup ejecuta el hook del proceso Saltcorn del VPS. Define
`SALTCORN_PROJECT_SYNC_BACKUP_CMD` en el servicio que arranca Saltcorn y haz
que el comando cree realmente un snapshot y devuelva JSON con metadatos, por
ejemplo un ID, fecha, ruta y/o SHA-256. No uses un comando que sólo imprima
`{ "ok": true }`: el despliegue de `test`/`prod` exige una recepción verificable.

Si el comando también soporta restauración, define
`SALTCORN_PROJECT_SYNC_RESTORE_CMD`. Reinicia Saltcorn después de cambiar las
variables para que el plugin las cargue.

### 3. Preparar el checkout del portátil

En el checkout local, crea o modifica `environments/dev.json`:

```json
{
  "environment": "dev",
  "adapter": "rest",
  "base_url": "https://dev.example.com",
  "token_env": "PROJECT_SYNC_DEV_TOKEN",
  "transport": "direct",
  "branch": "develop",
  "tenant": "public"
}
```

El archivo no contiene el token. Antes de usar el CLI:

```bash
export PROJECT_SYNC_DEV_TOKEN='token-generado-en-el-VPS'
```

`base_url` y `tenant` son del VPS. `root_path` es el checkout del portátil.

### 4. Comprobar antes de aplicar

Desde el portátil:

```bash
sc-project-sync doctor-live --adapter rest --env dev
sc-project-sync plan-live --adapter rest --env dev
```

El primer comando comprueba autenticación, conectividad, versión, plugins y
exportación live. El segundo muestra las operaciones que se aplicarían.

### 5. Desplegar

En modo interactivo:

```bash
sc-project-sync deploy --adapter rest --env dev
```

Para CI o automatización:

```bash
sc-project-sync deploy --adapter rest --env dev --yes
```

El flujo realiza plan, confirmación, backup remoto, apply, refresh de Saltcorn,
verificación de convergencia y registro en el ledger del VPS. El resultado es
un recibo compacto con operaciones, backup, convergencia y deployment ID.

### 6. Comprobar el resultado

1. Revisa el recibo y el código de salida.
2. Abre `Project Sync → Deployments` en el VPS para ver el registro objetivo.
3. Confirma que la aplicación funciona en el tenant `dev`.
4. Conserva el backup receipt si necesitas auditar o restaurar.

Si falla backup, apply, refresh o convergencia, el comando termina con código
distinto de cero. No uses `--skip-verify` salvo para diagnóstico temporal.

## Receta completa con confirmación desde la UI

Este es el flujo recomendado para el uso diario cuando se quiere revisar y
confirmar el plan desde el navegador. La UI no puede leer archivos sin commit
del portátil: el intercambio entre ambos equipos es Git.

### 1. Configurar el proyecto en el VPS

En el tenant Saltcorn de destino abre **Project Sync → Projects**, selecciona
el proyecto y entra en **Settings**. Para el entorno `dev` configura:

- `root_path`: checkout Git existente **en el VPS**, por ejemplo
  `/srv/saltcorn-projects/buyapp`;
- `repository`: el remoto que puede leer el VPS;
- `adapter`: `native`, porque es la UI del propio tenant la que aplica;
- `branch`: por ejemplo `develop`;
- `tenant`: el tenant actualmente abierto en Saltcorn;
- `backup_policy`: `optional` en desarrollo, o `required` si vuestra política
  interna lo exige;
- `backup_hook_env`: sólo el nombre de una variable del proceso del VPS, por
  ejemplo `SCPS_DEV_BACKUP_CMD`.

El checkout del VPS puede estar en cualquier rama: la previsualización hace
`fetch` y materializa el commit elegido en un checkout temporal sin cambiar el
árbol de trabajo activo. El proceso Saltcorn necesita permisos de lectura y
escritura sobre el repositorio. Si el tenant configurado no coincide con el
tenant abierto, el despliegue se rechaza antes de crear el plan.

No hace falta un token API para este flujo. Preview y confirmación requieren la
sesión de un administrador de Saltcorn y peticiones del mismo origen. El token
Bearer se reserva para CLI/CI.

### 2. Decidir y configurar el backup

En `dev` el backup es opcional. Si no se desea, deja `backup_policy=optional`,
no configures proveedor y deja desmarcada la casilla en la pantalla Deploy. En
`test` y `prod` siempre es obligatorio y no se puede desactivar desde UI ni
con `--skip-backup`.

El proyecto no instala ni genera scripts de backup. El administrador del VPS
aporta el comando adecuado para su instalación y lo publica como variable del
servicio Saltcorn, por ejemplo:

```text
SCPS_DEV_BACKUP_CMD=/opt/saltcorn/bin/backup-buyapp-dev
```

En Settings se guarda únicamente `SCPS_DEV_BACKUP_CMD`, nunca el cuerpo del
comando. El proveedor recibe por stdin un JSON sin secretos con `project`,
`environment` y `tenant`. Debe crear un backup real y escribir un único objeto
JSON verificable en stdout, por ejemplo:

```json
{
  "ok": true,
  "id": "buyapp-dev-20260803T120000Z",
  "created_at": "2026-08-03T12:00:00Z",
  "path": "/var/backups/buyapp-dev-20260803T120000Z.dump",
  "sha256": "<sha256 del artefacto>",
  "provider": "postgres-pg_dump",
  "tool_version": "pg_dump 16"
}
```

El script, las credenciales de base de datos y el directorio de backups
pertenecen al VPS y a su gestor de secretos. Reinicia Saltcorn después de
cambiar variables del servicio. La página muestra **Backup ready** cuando la
referencia se resuelve; no ejecuta el comando durante el diagnóstico.

### 3. Publicar los cambios desde el portátil

```bash
git status
git add <archivos revisados>
git commit -m "feat: cambio a desplegar"
git push origin develop
```

Sólo se desplegará el commit publicado. Los archivos modificados pero no
confirmados en el portátil no forman parte del plan.

### 4. Previsualizar desde el VPS

En el tenant de destino abre **Project Sync → Projects → Deploy**:

1. comprueba la rama y el target que la pantalla toma de la configuración;
2. activa o desactiva el backup según la política anterior;
3. pulsa **Review changes**.

Generate ejecuta automáticamente `git fetch --prune origin` antes de resolver
la rama remota. Si esa rama coincide con la rama activa y el checkout está
limpio, aplica un `merge --ff-only`, equivalente a un pull sin merges. Así el
plan inmutable y Live Diff leen la misma revisión. Un checkout sucio o una rama
divergente bloquean la previsualización con una instrucción para resolverlo en
Git; nunca se descartan cambios locales.

La rama configurada es la opción recomendada y no hay que escribirla. El
selector avanzado enumera ramas remotas, tags y commits recientes para
rollouts controlados. El target tampoco es texto libre: identifica el perfil
que aporta tenant, políticas de seguridad y backup. No cambia el contenido Git.

El VPS resuelve un SHA exacto, valida el proyecto, exporta el tenant actual y
muestra operaciones seguras, destructivas, warnings y blockers. Los objetos
que sólo existen en el tenant se conservan como huérfanos; su ausencia en Git
no autoriza borrarlos. El request guarda digests y resúmenes, no el estado
completo ni secretos.

El bloque `scope` de `saltcorn.project.json`, escrito por los exports completos,
constituye el alcance deseado versionado. Si un objeto todavía no pertenece al
scope local del tenant, Deploy lo muestra como `track_scope`; no hace falta
salir a Live Diff ni a Scope. En commits antiguos sin ese bloque, sólo se
despliega el scope local ya configurado: la ausencia de un objeto en el tenant
no basta para decidir que debe incorporarse. Haz una única exportación completa
con una versión actual del plugin y confirma ese `scope` en Git para migrar el
proyecto. A partir de ahí, la incorporación forma parte del digest y se guarda
después de que APPLY y VERIFY converjan.

### 5. Confirmar y seguir el resultado

Revisa el commit, las operaciones y la identidad del plan. Si existen cambios
destructivos autorizados mediante `changes/`, escribe `dev` en la confirmación.
Al pulsar **Confirm and deploy**, el servidor vuelve a resolver Git, exportar el
tenant y calcular los tres digests. Si algo cambió, marca el plan como `stale`
y obliga a previsualizar de nuevo.

Cuando coincide, adquiere un lock por proyecto/entorno y ejecuta:

```text
BACKUP → APPLY → REFRESH → VERIFY → RECEIPT
```

La pantalla actualiza el progreso y enlaza al ledger autoritativo de
**Project Sync → Deployments**. Los estados terminales distinguen backup,
apply, refresh, verificación con drift y fallo de verificación.

### Modos de interfaz

En **Settings → Interface role** se puede adaptar la navegación al cometido de
la instalación:

- `Deployment server`: Deploy y Settings; el historial sigue disponible en la
  navegación global. Oculta Scope, Git, Live Diff, Plan y Approvals.
- `Workspace`: Scope, Git, Live Diff, Plan y Settings.
- `Full`: muestra todas las herramientas.

También puede fijarse con `SALTCORN_PROJECT_SYNC_UI_MODE` usando `deployment`,
`workspace` o `full`. Esta opción sólo organiza la interfaz; no relaja permisos,
confirmaciones, políticas de backup ni controles destructivos.

La pantalla Git usa un flujo de cliente convencional: ramas, working tree con
stage/unstage individual o por grupo, editor de commit, sincronización remota e
historial. `Pull` también exige fast-forward para evitar merges accidentales.

El proceso equivalente por CLI sigue disponible. En desarrollo puede omitirse
el backup de forma explícita:

```bash
sc-project-sync deploy --adapter rest --env dev --skip-backup
```

Do not put tokens, passwords, private keys, command bodies, or credentials in this file. The validator rejects secret-looking keys. A `*_env` field contains only an environment-variable name; the CLI resolves its value at runtime.

## Managed SSH transport

Set `transport` to `ssh` and configure `ssh_host`, `ssh_user`, `ssh_port`, `ssh_local_port`, `ssh_remote_host`, and `ssh_remote_port`. `ssh_identity_file` may point to a key managed outside the repository. For live commands the CLI starts:

```text
ssh -N -L <local-port>:<remote-host>:<remote-port> ...
```

Arguments are passed without a shell, batch mode is enabled, readiness is checked locally, and the tunnel is stopped when the command finishes. Host-key verification remains under the user's normal SSH configuration. The REST token is still required because the tunnel is transport, not authentication.

## Token lifecycle

The setup page can generate, rotate, and revoke API tokens. A generated token is returned to the browser once. Only its salted SHA-256 hash and a short display prefix are stored in `_sc_ps_api_tokens`; plaintext tokens are not recoverable and are never written to logs or deployment records.

Rotation procedure:

1. Generate a named replacement token and copy it immediately to the CI secret store.
2. Run `doctor-live --adapter rest --env <env>` with the new secret.
3. Revoke the old token in the setup page.
4. Re-run the deployment job or health check.

The legacy `SALTCORN_PROJECT_SYNC_API_TOKEN` process variable remains supported and has highest precedence.
