(function(){
  var form = document.getElementById('project-settings-form');
  if (!form) return;
  var projectId = window.SCPS_SETTINGS_PROJECT_ID;
  var status = document.getElementById('save-status');

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var btn = document.getElementById('btn-save-project-settings');
    if (btn) btn.disabled = true;
    status.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
    fetch('/project-sync/api/projects/' + encodeURIComponent(projectId), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name: val('project-setting-name'),
        slug: val('project-setting-slug'),
        description: val('project-setting-description'),
        min_version: val('project-setting-min-version'),
        root_path: val('project-setting-root-path')
      })
    }).then(function(r){ return r.json(); })
    .then(function(j){
      if (btn) btn.disabled = false;
      if (j.ok) {
        status.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Saved.</span>';
        setTimeout(function(){ location.reload(); }, 600);
      } else {
        status.innerHTML = '<span class="text-danger"><i class="fas fa-times me-1"></i>' + (j.error || 'Error') + '</span>';
      }
    }).catch(function(e){
      if (btn) btn.disabled = false;
      status.innerHTML = '<span class="text-danger">' + e.message + '</span>';
    });
  });
})();
