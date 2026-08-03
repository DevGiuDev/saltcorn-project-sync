(function(){
  function flash(btn, msg, cls, duration) {
    var orig = btn.innerHTML;
    btn.innerHTML = msg;
    btn.className = 'btn btn-sm btn-' + (cls || 'success');
    setTimeout(function(){ btn.innerHTML = orig; btn.className = btn.dataset.origClass; }, duration || 2000);
  }
  function saveOrig(btn) { if (!btn.dataset.origClass) btn.dataset.origClass = btn.className; }
  var gitProjectId = window.SCPS_GIT_PROJECT_ID !== undefined && window.SCPS_GIT_PROJECT_ID !== null && String(window.SCPS_GIT_PROJECT_ID) !== ''
    ? String(window.SCPS_GIT_PROJECT_ID)
    : '';
  function gitQuery() {
    return gitProjectId ? '?project_id=' + encodeURIComponent(gitProjectId) : '';
  }
  function gitApi(path) {
    return path + gitQuery();
  }

  // Stage single file
  document.addEventListener('click', function(e){
    var stageBtn = e.target.closest('.stage-btn');
    if (stageBtn) {
      e.preventDefault();
      saveOrig(stageBtn);
      stageBtn.disabled = true;
      fetch(gitApi('/project-sync/api/git/add'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:[stageBtn.dataset.path]})})
        .then(function(r){return r.json();})
        .then(function(j){
          stageBtn.disabled = false;
          if (j.ok) setTimeout(function(){ location.reload(); }, 300);
          else { flash(stageBtn, 'Error: ' + (j.error||''), 'danger', 3000); }
        });
    }

    // Unstage single file
    var unstageBtn = e.target.closest('.unstage-btn');
    if (unstageBtn) {
      e.preventDefault();
      saveOrig(unstageBtn);
      unstageBtn.disabled = true;
      fetch(gitApi('/project-sync/api/git/reset'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:[unstageBtn.dataset.path]})})
        .then(function(r){return r.json();})
        .then(function(j){
          unstageBtn.disabled = false;
          if (j.ok) setTimeout(function(){ location.reload(); }, 300);
          else { flash(unstageBtn, 'Error', 'danger', 3000); }
        });
    }

    // Stage all modified
    var stageMod = e.target.closest('#btn-stage-modified');
    if (stageMod) {
      e.preventDefault();
      saveOrig(stageMod);
      stageMod.disabled = true;
      var paths = [];
      document.querySelectorAll('.stage-btn[data-group="modified"]').forEach(function(b){ if(b.dataset.path) paths.push(b.dataset.path); });
      fetch(gitApi('/project-sync/api/git/add'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:paths})})
        .then(function(r){return r.json();})
        .then(function(j){
          stageMod.disabled = false;
          if (j.ok) setTimeout(function(){ location.reload(); }, 300);
          else { flash(stageMod, 'Error', 'danger', 3000); }
        });
    }

    // Stage all untracked
    var stageUn = e.target.closest('#btn-stage-untracked');
    if (stageUn) {
      e.preventDefault();
      saveOrig(stageUn);
      stageUn.disabled = true;
      var untrackedPaths = [];
      document.querySelectorAll('.stage-btn[data-group="untracked"]').forEach(function(b){ if(b.dataset.path) untrackedPaths.push(b.dataset.path); });
      fetch(gitApi('/project-sync/api/git/add'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:untrackedPaths})})
        .then(function(r){return r.json();})
        .then(function(j){
          stageUn.disabled = false;
          if (j.ok) setTimeout(function(){ location.reload(); }, 300);
          else { flash(stageUn, 'Error', 'danger', 3000); }
        });
    }

    // Unstage all
    var unstageAll = e.target.closest('#btn-unstage-all');
    if (unstageAll) {
      e.preventDefault();
      saveOrig(unstageAll);
      unstageAll.disabled = true;
      fetch(gitApi('/project-sync/api/git/reset'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({})})
        .then(function(r){return r.json();})
        .then(function(j){
          unstageAll.disabled = false;
          if (j.ok) setTimeout(function(){ location.reload(); }, 300);
          else { flash(unstageAll, 'Error', 'danger', 3000); }
        });
    }

    // Commit
    var commitBtn = e.target.closest('#btn-git-commit');
    if (commitBtn) {
      e.preventDefault();
      var msg = document.getElementById('git-commit-msg').value.trim();
      if (!msg) { alert('Write a commit message first.'); return; }
      var pushAfterCommit = document.getElementById('git-commit-push').checked;
      var syncScope = document.getElementById('git-commit-sync-scope').checked;
      saveOrig(commitBtn);
      commitBtn.disabled = true;
      fetch(gitApi('/project-sync/api/git/commit'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg, push:pushAfterCommit, sync_scope:syncScope})})
        .then(function(r){return r.json();})
        .then(function(j){
          commitBtn.disabled = false;
          if (j.ok) {
            document.getElementById('git-commit-msg').value = '';
            var pushed = document.getElementById('git-commit-push').checked;
            var pushMessage = pushed && !j.pushed ? 'Committed; push failed' : (pushed ? 'Committed + pushed' : 'Committed');
            flash(commitBtn, '<i class="fas fa-check me-1"></i>' + pushMessage + ' ' + (j.hash||''), pushed && !j.pushed ? 'warning' : 'success', 3000);
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            flash(commitBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }

    // Pull
    var pullBtn = e.target.closest('#btn-git-pull');
    if (pullBtn) {
      e.preventDefault();
      saveOrig(pullBtn);
      pullBtn.disabled = true;
      pullBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Pulling...';
      fetch(gitApi('/project-sync/api/git/pull'), {method:'POST', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          pullBtn.disabled = false;
          if (j.ok) {
            flash(pullBtn, '<i class="fas fa-check me-1"></i>Pulled', 'success', 3000);
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            flash(pullBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }

    // Push
    var pushBtn = e.target.closest('#btn-git-push');
    if (pushBtn) {
      e.preventDefault();
      saveOrig(pushBtn);
      pushBtn.disabled = true;
      pushBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Pushing...';
      fetch(gitApi('/project-sync/api/git/push'), {method:'POST', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          pushBtn.disabled = false;
          if (j.ok) {
            flash(pushBtn, '<i class="fas fa-check me-1"></i>Pushed', 'success', 3000);
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            flash(pushBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }

    // Fetch
    var fetchBtn = e.target.closest('#btn-git-fetch');
    if (fetchBtn) {
      e.preventDefault();
      saveOrig(fetchBtn);
      fetchBtn.disabled = true;
      fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Fetching...';
      fetch(gitApi('/project-sync/api/git/fetch'), {method:'POST', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          fetchBtn.disabled = false;
          if (j.ok) {
            flash(fetchBtn, '<i class="fas fa-check me-1"></i>Fetched', 'success', 3000);
            setTimeout(function(){ location.reload(); }, 1000);
          } else {
            flash(fetchBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }

    // Stash
    var stashBtn = e.target.closest('#btn-git-stash');
    if (stashBtn) {
      e.preventDefault();
      saveOrig(stashBtn);
      stashBtn.disabled = true;
      fetch(gitApi('/project-sync/api/git/stash'), {method:'POST', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          stashBtn.disabled = false;
          if (j.ok) { flash(stashBtn, '<i class="fas fa-check me-1"></i>Stashed', 'success'); setTimeout(function(){ location.reload(); }, 1000); }
          else flash(stashBtn, '<i class="fas fa-times me-1"></i>' + (j.error||''), 'danger', 4000);
        });
    }

    // Stash pop
    var stashPopBtn = e.target.closest('#btn-git-stash-pop');
    if (stashPopBtn) {
      e.preventDefault();
      saveOrig(stashPopBtn);
      stashPopBtn.disabled = true;
      fetch(gitApi('/project-sync/api/git/stash-pop'), {method:'POST', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          stashPopBtn.disabled = false;
          if (j.ok) { flash(stashPopBtn, '<i class="fas fa-check me-1"></i>Popped', 'success'); setTimeout(function(){ location.reload(); }, 1000); }
          else flash(stashPopBtn, '<i class="fas fa-times me-1"></i>' + (j.error||''), 'danger', 4000);
        });
    }

    // Checkout branch
    var checkoutBtn = e.target.closest('.checkout-btn');
    if (checkoutBtn) {
      e.preventDefault();
      var branch = checkoutBtn.dataset.branch;
      if (!confirm('Switch to branch "' + branch + '"?')) return;
      saveOrig(checkoutBtn);
      checkoutBtn.disabled = true;
      checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>';
      fetch(gitApi('/project-sync/api/branches/switch'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({branch:branch})})
        .then(function(r){return r.json();})
        .then(function(j){
          checkoutBtn.disabled = false;
          if (j.ok) {
            flash(checkoutBtn, '<i class="fas fa-check me-1"></i>Switched', 'success');
            if (j.url) {
              setTimeout(function(){ window.location.href = j.url + '/project-sync/git' + gitQuery(); }, 1000);
            } else {
              setTimeout(function(){ location.reload(); }, 1000);
            }
          } else {
            flash(checkoutBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }

    // Merge branch button
    var mergeBtn = e.target.closest('.merge-btn');
    if (mergeBtn) {
      e.preventDefault();
      var branch = mergeBtn.dataset.branch;
      if (!confirm('Merge "' + branch + '" into current branch?')) return;
      saveOrig(mergeBtn);
      mergeBtn.disabled = true;
      mergeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>';
      fetch(gitApi('/project-sync/api/branches/merge'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({branch:branch})})
        .then(function(r){return r.json();})
        .then(function(j){
          mergeBtn.disabled = false;
          if (j.ok) {
            flash(mergeBtn, '<i class="fas fa-check me-1"></i>Merged', 'success');
            setTimeout(function(){ location.reload(); }, 1500);
          } else {
            flash(mergeBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Merge failed'), 'danger', 5000);
          }
        });
    }

    // Create branch button (toggle form)
    var createBranchBtn = e.target.closest('#btn-create-branch');
    if (createBranchBtn) {
      e.preventDefault();
      var form = document.getElementById('create-branch-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block') document.getElementById('new-branch-name').focus();
    }
    var cancelBranchBtn = e.target.closest('#btn-cancel-branch');
    if (cancelBranchBtn) {
      e.preventDefault();
      document.getElementById('create-branch-form').style.display = 'none';
    }

    // Do create branch
    var doCreateBtn = e.target.closest('#btn-do-create-branch');
    if (doCreateBtn) {
      e.preventDefault();
      var name = document.getElementById('new-branch-name').value.trim();
      if (!name) { alert('Enter a branch name.'); return; }
      doCreateBtn.disabled = true;
      var statusEl = document.getElementById('create-branch-status');
      statusEl.style.display = 'block';
      statusEl.className = 'mt-2 alert alert-info';
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Creating branch and cloning tenant...';
      fetch(gitApi('/project-sync/api/branches/create'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({branch:name})})
        .then(function(r){return r.json();})
        .then(function(j){
          doCreateBtn.disabled = false;
          if (j.ok) {
            statusEl.className = 'mt-2 alert alert-success';
            statusEl.innerHTML = '<i class="fas fa-check me-1"></i>Branch <strong>' + name + '</strong> created! Tenant: <code>' + (j.schema||'') + '</code>' +
              (j.url ? ' — <a href="http://' + j.url + '" target="_blank">Open ' + j.url + ' <i class="fas fa-external-link-alt fa-xs"></i></a>' : '');
            setTimeout(function(){ location.reload(); }, 3000);
          } else {
            statusEl.className = 'mt-2 alert alert-danger';
            statusEl.innerHTML = '<i class="fas fa-times me-1"></i>' + (j.error || 'Unknown error');
          }
        })
        .catch(function(err){
          doCreateBtn.disabled = false;
          statusEl.className = 'mt-2 alert alert-danger';
          statusEl.innerHTML = '<i class="fas fa-times me-1"></i>' + err.message;
        });
    }

    // Delete branch
    var deleteBranchBtn = e.target.closest('.delete-branch-btn');
    if (deleteBranchBtn) {
      e.preventDefault();
      var branch = deleteBranchBtn.dataset.branch;
      if (!confirm('Delete branch "' + branch + '" and its tenant (schema)? This drops all data in that tenant.')) return;
      saveOrig(deleteBranchBtn);
      deleteBranchBtn.disabled = true;
      fetch(gitApi('/project-sync/api/branches/' + encodeURIComponent(branch)), {method:'DELETE', headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json();})
        .then(function(j){
          deleteBranchBtn.disabled = false;
          if (j.ok) {
            flash(deleteBranchBtn, '<i class="fas fa-check me-1"></i>Deleted', 'success');
            setTimeout(function(){ location.reload(); }, 1500);
          } else {
            flash(deleteBranchBtn, '<i class="fas fa-times me-1"></i>' + (j.error||'Error'), 'danger', 4000);
          }
        });
    }
  });
})();
