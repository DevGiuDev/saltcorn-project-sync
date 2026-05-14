(function(){
  document.getElementById('btn-save-settings').addEventListener('click', function(){
    var btn = this;
    var status = document.getElementById('save-status');
    btn.disabled = true;
    status.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
    fetch('/project-sync/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        project_root: document.getElementById('setting-project-root').value
      })
    }).then(function(r){ return r.json(); })
    .then(function(j){
      btn.disabled = false;
      if (j.ok) {
        status.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Saved. Reload to take effect.</span>';
      } else {
        status.innerHTML = '<span class="text-danger"><i class="fas fa-times me-1"></i>' + (j.error || 'Error') + '</span>';
      }
    }).catch(function(e){
      btn.disabled = false;
      status.innerHTML = '<span class="text-danger">' + e.message + '</span>';
    });
  });

  // Verify path on save
  document.getElementById('btn-browse-root').addEventListener('click', function(){
    var status = document.getElementById('root-status');
    var path = document.getElementById('setting-project-root').value;
    if (!path) { status.innerHTML = '<span class="text-muted">Enter a path first</span>'; return; }
    status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    fetch('/project-sync/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ project_root: path })
    }).then(function(r){ return r.json(); })
    .then(function(j){
      if (j.ok) {
        status.innerHTML = '<span class="text-success"><i class="fas fa-check me-1"></i>Saved. Reloading...</span>';
        setTimeout(function(){ location.reload(); }, 1000);
      }
    });
  });
})();
