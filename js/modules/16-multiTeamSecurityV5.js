(() => {
  const APP_ADMIN_NAMES = new Set(['mark','anny','rita']);
  const key = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
  const first = value => key(value).split(/[ ,._-]+/)[0];
  const isNamedAppAdmin = user => [user?.name,user?.username,user?.displayName,user?.email].some(v=>APP_ADMIN_NAMES.has(first(v)));
  window.APP_ADMIN_NAMES=[...APP_ADMIN_NAMES];
  const originalIsAdmin=window.isAdminSession;
  window.isAdminSession=function(){
    return !!currentUser && !currentUser.isReadOnly && (currentUser.role==='Admin' || isNamedAppAdmin(currentUser) || originalIsAdmin?.());
  };
  window.isAppAdminSession=window.isAdminSession;
  window.canManageTeams=()=>window.isAdminSession();
  window.canManageUsers=()=>window.isAdminSession() || window.isTeamAdminSession?.();
  window.canEditTeamData=function(team){
    if(window.isAdminSession()) return true;
    if(!currentUser || currentUser.isReadOnly || currentUser.role==='Viewer') return false;
    return key(team)===key(currentUser.team);
  };
  const oldInit=window.initUserSession;
  if(typeof oldInit==='function'){
    window.initUserSession=function(){
      if(currentUser && isNamedAppAdmin(currentUser)) currentUser.role='Admin';
      const result=oldInit.apply(this,arguments);
      const badge=document.getElementById('currentUserRoleBadge');
      if(badge && window.isAdminSession()) badge.textContent='App Admin';
      return result;
    };
  }
  const lockTeamContext=()=>{
    if(!currentUser || window.isAdminSession() || !currentUser.team) return;
    window.activeTeamView=currentUser.team;
    document.querySelectorAll('[id*="team" i] select, select[id*="team" i]').forEach(sel=>{
      if(sel.closest('[data-mtr-free]')) return;
      const opt=[...sel.options].find(o=>key(o.value)===key(currentUser.team));
      if(opt){ sel.value=opt.value; sel.disabled=true; }
    });
  };
  document.addEventListener('DOMContentLoaded',lockTeamContext);
  /* PERF: throttle to 1 run per frame instead of on every DOM mutation */
  let __lockQ=0;new MutationObserver(()=>{if(__lockQ)return;__lockQ=requestAnimationFrame(()=>{__lockQ=0;lockTeamContext();});}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('option[value="Admin"]').forEach(o=>o.textContent='App Admin'));
})();
