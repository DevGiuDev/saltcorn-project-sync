(function(){
  function flash(btn, msg, cls){
    var orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check me-1"></i>' + (msg || 'OK');
    btn.className = 'btn btn-sm btn-' + (cls || 'success');
    setTimeout(function(){ btn.innerHTML = orig; btn.className = btn.dataset.origClass; }, 2000);
  }
  function doPull(kind, name, properties){
    return fetch('/project-sync/api/pull', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind: kind, name: name, properties: properties})
    }).then(function(r){ return r.json(); });
  }
  document.addEventListener('click', function(e){
    var btn = e.target.closest('.pull-btn');
    if(btn){
      e.preventDefault();
      var kind = btn.dataset.kind, name = btn.dataset.name;
      btn.dataset.origClass = btn.className;
      btn.disabled = true;
      doPull(kind, name).then(function(res){
        btn.disabled = false;
        if(res.ok){ flash(btn, 'OK'); setTimeout(function(){ location.reload(); }, 500); }
        else { flash(btn, 'Error', 'danger'); console.error(res.error); }
      }).catch(function(err){
        btn.disabled = false;
        flash(btn, 'Error', 'danger');
        console.error(err);
      });
    }
    var propBtn = e.target.closest('.pull-prop-btn');
    if(propBtn){
      e.preventDefault();
      var kind = propBtn.dataset.kind, name = propBtn.dataset.name, prop = propBtn.dataset.prop;
      doPull(kind, name, [prop]).then(function(res){
        if(res.ok){
          var dd = propBtn.closest('.btn-group');
          if(dd){ var ts = dd.querySelector('.dropdown-toggle'); if(ts) ts.click(); }
          setTimeout(function(){ location.reload(); }, 300);
        } else {
          alert('Error: ' + (res.error || 'unknown'));
        }
      }).catch(function(err){ alert('Error: ' + err.message); });
    }
    var pushBtn = e.target.closest('.push-btn');
    if(pushBtn){
      e.preventDefault();
      alert('→ Live individual: próximamente. Usa el botón → Live (drift) para aplicar cambios.');
    }
    // Add to scope button
    var addScopeBtn = e.target.closest('.add-to-scope-btn');
    if(addScopeBtn){
      e.preventDefault();
      addScopeBtn.disabled = true;
      var scopeKind = addScopeBtn.dataset.kind, scopeName = addScopeBtn.dataset.name;
      fetch('/project-sync/api/add-to-scope', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({kind: scopeKind, name: scopeName})
      })
      .then(function(r){ return r.json(); })
      .then(function(r){
        if(r.ok){
          addScopeBtn.innerHTML = '<i class="fas fa-check me-1"></i>Added';
          addScopeBtn.className = 'btn btn-success btn-sm';
          setTimeout(function(){ location.reload(); }, 800);
        } else {
          addScopeBtn.innerHTML = '<i class="fas fa-times me-1"></i>' + (r.error || 'Error');
          addScopeBtn.className = 'btn btn-danger btn-sm';
          addScopeBtn.disabled = false;
        }
      })
      .catch(function(err){
        addScopeBtn.disabled = false;
        alert('Error: ' + err.message);
      });
    }
    // Add all untracked to scope
    var addAllBtn = e.target.closest('#add-all-untracked');
    if(addAllBtn){
      e.preventDefault();
      addAllBtn.disabled = true;
      var rows = document.querySelectorAll('.add-to-scope-btn');
      var total = rows.length, done = 0, errors = 0;
      addAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>0/' + total;
      var chain = Promise.resolve();
      rows.forEach(function(btn){
        chain = chain.then(function(){
          return fetch('/project-sync/api/add-to-scope', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({kind: btn.dataset.kind, name: btn.dataset.name})
          })
          .then(function(r){ return r.json(); })
          .then(function(r){
            done++;
            if(!r.ok) errors++;
            btn.innerHTML = r.ok ? '<i class="fas fa-check me-1"></i>Added' : '<i class="fas fa-times me-1"></i>' + (r.error || 'Error');
            btn.className = r.ok ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';
            btn.disabled = true;
            addAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>' + done + '/' + total;
          });
        });
      });
      chain.then(function(){
        addAllBtn.innerHTML = errors
          ? '<i class="fas fa-check me-1"></i>' + done + ' added, ' + errors + ' errors'
          : '<i class="fas fa-check me-1"></i>' + done + ' added';
        addAllBtn.className = errors ? 'btn btn-warning btn-sm' : 'btn btn-success btn-sm';
        setTimeout(function(){ location.reload(); }, 1000);
      });
    }
    // Stamp sync button
    var stampBtn = e.target.closest('#stamp-sync-btn');
    if(stampBtn){
      e.preventDefault();
      stampBtn.disabled = true;
      stampBtn.dataset.origClass = stampBtn.className;
      fetch('/project-sync/api/stamp-sync', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(res){
          stampBtn.disabled = false;
          if(res.ok){
            stampBtn.innerHTML = '<i class="fas fa-check me-1"></i>Sincronizado';
            stampBtn.className = 'btn btn-success btn-sm';
            setTimeout(function(){ location.reload(); }, 800);
          } else {
            stampBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
            stampBtn.className = 'btn btn-danger btn-sm';
            setTimeout(function(){ stampBtn.innerHTML = '<i class="fas fa-check-double me-1"></i>Marcar sync'; stampBtn.className = stampBtn.dataset.origClass; }, 2000);
          }
        })
        .catch(function(err){
          stampBtn.disabled = false;
          alert('Error: ' + err.message);
        });
    }
    // Version edit
    var versionEditBtn = e.target.closest('#version-edit-btn');
    if(versionEditBtn){
      e.preventDefault();
      document.getElementById('version-display').classList.add('d-none');
      document.getElementById('version-input').classList.remove('d-none');
      document.getElementById('version-edit-btn').classList.add('d-none');
      document.getElementById('version-save-btn').classList.remove('d-none');
      document.getElementById('version-cancel-btn').classList.remove('d-none');
      document.getElementById('version-input').focus();
      document.getElementById('version-input').select();
    }
    var versionSaveBtn = e.target.closest('#version-save-btn');
    if(versionSaveBtn){
      e.preventDefault();
      var newVer = document.getElementById('version-input').value.trim();
      if(!newVer) return;
      fetch('/project-sync/api/set-version', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:newVer})})
        .then(function(r){ return r.json(); })
        .then(function(res){
          if(res.ok){
            document.getElementById('version-display').textContent = res.version;
            document.getElementById('version-display').classList.remove('d-none');
            document.getElementById('version-input').classList.add('d-none');
            document.getElementById('version-edit-btn').classList.remove('d-none');
            document.getElementById('version-save-btn').classList.add('d-none');
            document.getElementById('version-cancel-btn').classList.add('d-none');
          } else { alert('Error: ' + (res.error||'')); }
        })
        .catch(function(err){ alert('Error: ' + err.message); });
    }
    var versionCancelBtn = e.target.closest('#version-cancel-btn');
    if(versionCancelBtn){
      e.preventDefault();
      document.getElementById('version-display').classList.remove('d-none');
      document.getElementById('version-input').classList.add('d-none');
      document.getElementById('version-edit-btn').classList.remove('d-none');
      document.getElementById('version-save-btn').classList.add('d-none');
      document.getElementById('version-cancel-btn').classList.add('d-none');
    }
    // → Files drift button
    var pullDriftBtn = e.target.closest('#pull-drift-btn');
    if(pullDriftBtn){
      e.preventDefault();
      pullDriftBtn.disabled = true;
      pullDriftBtn.dataset.origClass = pullDriftBtn.className;
      pullDriftBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sincronizando...';
      fetch('/project-sync/api/pull-drift', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(res){
          pullDriftBtn.disabled = false;
          if(res.ok){
            var n = res.count || 0;
            pullDriftBtn.innerHTML = '<i class="fas fa-check me-1"></i>' + n + ' pulled';
            pullDriftBtn.className = 'btn btn-success btn-sm ms-2';
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            pullDriftBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
            pullDriftBtn.className = 'btn btn-danger btn-sm ms-2';
            setTimeout(function(){ pullDriftBtn.innerHTML = '<i class="fas fa-file-import me-1"></i>\u2192 Files (drift)'; pullDriftBtn.className = pullDriftBtn.dataset.origClass; }, 3000);
          }
        })
        .catch(function(err){
          pullDriftBtn.disabled = false;
          alert('Error: ' + err.message);
        });
    }
    // → Live drift button
    var pushDriftBtn = e.target.closest('#push-drift-btn');
    if(pushDriftBtn){
      e.preventDefault();
      pushDriftBtn.disabled = true;
      pushDriftBtn.dataset.origClass = pushDriftBtn.className;
      pushDriftBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Aplicando...';
      fetch('/project-sync/api/push-drift', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(res){
          pushDriftBtn.disabled = false;
          if(res.ok){
            var n = res.applied ? res.applied.length : (res.count || 0);
            var msg = n + ' applied';
            if(res.skipped && res.skipped.length) msg += ' (' + res.skipped.length + ' skipped)';
            if(n === 0 && res.message) msg = res.message;
            pushDriftBtn.innerHTML = '<i class="fas fa-' + (n > 0 ? 'check' : 'info-circle') + ' me-1"></i>' + msg;
            pushDriftBtn.className = 'btn btn-' + (n > 0 ? 'success' : 'warning') + ' btn-sm ms-2';
            if(res.debug) console.warn('[push-drift] debug:', res.debug);
            if(res.skipped && res.skipped.length) console.warn('[push-drift] skipped:', res.skipped);
            setTimeout(function(){ location.reload(); }, n > 0 ? 1500 : 3000);
          } else {
            pushDriftBtn.innerHTML = '<i class="fas fa-times me-1"></i>' + (res.error || 'Error');
            pushDriftBtn.className = 'btn btn-danger btn-sm ms-2';
            pushDriftBtn.disabled = false;
            setTimeout(function(){ pushDriftBtn.innerHTML = '<i class="fas fa-cloud-upload-alt me-1"></i>Drift'; pushDriftBtn.className = pushDriftBtn.dataset.origClass; }, 4000);
          }
        })
        .catch(function(err){
          pushDriftBtn.disabled = false;
          alert('Error: ' + err.message);
        });
    }
    // Full pull button
    var fullPullBtn = e.target.closest('#full-pull-btn');
    if(fullPullBtn){
      e.preventDefault();
      if(!confirm('Exportar TODO el live al disco? Los archivos actuales se reemplazar\u00e1n.')) return;
      fullPullBtn.disabled = true;
      fullPullBtn.dataset.origClass = fullPullBtn.className;
      fullPullBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exportando...';
      fetch('/project-sync/api/full-pull', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(res){
          fullPullBtn.disabled = false;
          if(res.ok){
            fullPullBtn.innerHTML = '<i class="fas fa-check me-1"></i>' + Object.values(res.counts).reduce(function(a,b){return a+b;},0) + ' objetos';
            fullPullBtn.className = 'btn btn-success btn-sm';
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            fullPullBtn.innerHTML = '<i class="fas fa-times me-1"></i>Error';
            fullPullBtn.className = 'btn btn-danger btn-sm';
            setTimeout(function(){ fullPullBtn.innerHTML = '<i class="fas fa-file-export me-1"></i>All'; fullPullBtn.className = fullPullBtn.dataset.origClass; }, 3000);
          }
        })
        .catch(function(err){
          fullPullBtn.disabled = false;
          alert('Error: ' + err.message);
        });
    }
  });
})();
