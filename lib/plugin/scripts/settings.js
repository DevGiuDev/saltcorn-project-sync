(function(){
  var state = window.SCPS_SETTINGS || {};
  var projectId = state.projectId;
  var environment = state.environment || 'dev';
  var form = document.getElementById('project-settings-form');
  if (!form) return;

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function post(url, body) {
    return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}).then(function(r){return r.json();});
  }
  function operationalBody() {
    return {
      environment: environment, adapter: val('project-setting-adapter'), base_url: val('project-setting-base-url'),
      repository: val('project-setting-repository'), branch: val('project-setting-branch'), tenant: val('project-setting-tenant'),
      transport: val('project-setting-transport'), token_env: val('project-setting-token-env'),
      ui_mode: val('project-setting-ui-mode'),
      backup_policy: val('project-setting-backup-policy'),
      backup_hook_env: val('project-setting-backup-hook-env'), restore_hook_env: val('project-setting-restore-hook-env'),
      ssh_host: val('project-setting-ssh-host'), ssh_user: val('project-setting-ssh-user'), ssh_port: val('project-setting-ssh-port'),
      ssh_local_port: val('project-setting-ssh-local-port'), ssh_remote_host: val('project-setting-ssh-remote-host'),
      ssh_remote_port: val('project-setting-ssh-remote-port'), ssh_identity_file: val('project-setting-ssh-identity-file')
    };
  }
  function updateTransportFields() {
    var fields = document.getElementById('ssh-transport-fields');
    if (fields) fields.hidden = val('project-setting-transport') !== 'ssh';
  }
  var transportSelect = document.getElementById('project-setting-transport');
  if (transportSelect) transportSelect.addEventListener('change', updateTransportFields);
  updateTransportFields();
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var btn = document.getElementById('btn-save-project-settings'); var status = document.getElementById('save-status');
    btn.disabled = true; status.textContent = 'Saving…';
    post('/project-sync/api/projects/' + encodeURIComponent(projectId), {
      name:val('project-setting-name'), slug:val('project-setting-slug'), description:val('project-setting-description'),
      min_version:val('project-setting-min-version'), root_path:val('project-setting-root-path')
    }).then(function(j){ if(!j.ok) throw new Error(j.error || 'Unable to save project'); return post('/project-sync/api/projects/' + encodeURIComponent(projectId) + '/environment', operationalBody()); })
      .then(function(j){ if(!j.ok) throw new Error(j.error || 'Unable to save environment'); status.innerHTML='<span class="text-success">Saved.</span>'; setTimeout(function(){location.reload();},500); })
      .catch(function(err){ btn.disabled=false; status.innerHTML='<span class="text-danger"></span>'; status.querySelector('span').textContent=err.message; });
  });
  document.getElementById('btn-open-environment').addEventListener('click', function(){
    var env = val('project-setting-environment'); if(env) location.href='/project-sync/settings?project_id=' + encodeURIComponent(projectId) + '&environment=' + encodeURIComponent(env);
  });
  document.getElementById('btn-run-health').addEventListener('click', function(){ location.reload(); });
  document.getElementById('btn-generate-token').addEventListener('click', function(){
    var button=this; button.disabled=true;
    post('/project-sync/api/tokens', {name:val('new-token-name') || 'CLI token'}).then(function(j){
      button.disabled=false; if(!j.ok) throw new Error(j.error || 'Unable to generate token');
      document.getElementById('one-time-token').textContent=j.token.token;
      document.getElementById('one-time-token-box').classList.remove('d-none');
    }).catch(function(err){ button.disabled=false; alert(err.message); });
  });
  document.querySelectorAll('.token-revoke').forEach(function(button){ button.addEventListener('click', function(){
    if(!confirm('Revoke this token? Existing clients using it will stop working.')) return;
    post('/project-sync/api/tokens/' + encodeURIComponent(button.getAttribute('data-token-id')) + '/revoke', {}).then(function(j){if(!j.ok) throw new Error(j.error || 'Unable to revoke token'); location.reload();}).catch(function(err){alert(err.message);});
  }); });
})();
