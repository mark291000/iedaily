(() => {
  /* Authorization source of truth: currentUser.role loaded from Supabase.
     Never promote an account by matching its name or email. */
  const key = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
  window.isAdminSession=function(){
    return !!currentUser && !currentUser.isReadOnly && String(currentUser.role || '').trim().toLowerCase()==='admin';
  };
  window.isAppAdminSession=window.isAdminSession;
  window.canManageTeams=()=>window.isAdminSession();
  window.canManageUsers=()=>window.isAdminSession() || window.isTeamAdminSession?.();
  window.canEditTeamData=function(team){
    if(window.isAdminSession()) return true;
    if(!currentUser || currentUser.isReadOnly || String(currentUser.role||'').toLowerCase()==='viewer') return false;
    return key(team)===key(currentUser.team);
  };
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
  let __lockQ=0;
  new MutationObserver(()=>{if(__lockQ)return;__lockQ=requestAnimationFrame(()=>{__lockQ=0;lockTeamContext();});}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('option[value="Admin"]').forEach(o=>o.textContent='App Admin'));
})();
