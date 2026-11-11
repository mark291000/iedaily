document.addEventListener('DOMContentLoaded',()=>{
  const apply=()=>{
    const admin=isAdminSession(), ta=isTeamAdminSession(), canUsers=admin||ta;
    document.querySelectorAll('[onclick*="openTeamModal"]').forEach(x=>x.classList.toggle('hidden',!admin));
    document.querySelectorAll('[onclick*="openAddUserModal"]').forEach(x=>x.classList.toggle('hidden',!canUsers));
    const teamSel=document.getElementById('userTeam');
    if(ta && teamSel){teamSel.value=currentUser.team||'';teamSel.disabled=true;}
    const roleSel=document.getElementById('userRole');
    if(ta && roleSel){[...roleSel.options].forEach(o=>{o.disabled=!['Team Admin','Member','Viewer'].includes(o.value||o.text); o.hidden=o.disabled;});}
  };
  const oldSwitch=window.switchTab;
  if(typeof oldSwitch==='function')window.switchTab=function(){const r=oldSwitch.apply(this,arguments);apply();return r;};
  /* PERF: run after data/session changes instead of every 1.5s */
  const __wrap=n=>{const f=window[n];if(typeof f!=='function'||f.__permApply)return;const w=function(){const r=f.apply(this,arguments);const done=()=>{if(currentUser)apply();};if(r&&typeof r.then==='function')r.then(done,done);else done();return r;};w.__permApply=true;window[n]=w;};
  window.addEventListener('load',()=>{['fetchAllDataFromSheet','initUserSession'].forEach(__wrap);if(currentUser)apply();},{once:true});
});
