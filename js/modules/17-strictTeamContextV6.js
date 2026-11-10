(() => {
  const n=v=>String(v??'').trim().toLowerCase();
  const active=()=>String(window.activeTeamView||currentUser?.team||'').trim();
  const same=(row,team=active())=>!!team && n(row?.team)===n(team);
  window.getViewTeam=()=>active();
  window.getWriteTeam=()=>active()||null;
  window.scopeRowsToTeam=rows=>(Array.isArray(rows)?rows:[]).filter(r=>same(r));
  window.resolveTeamOrThrow=row=>{
    const team=window.isAdminSession?.() ? (String(row?.team||'').trim()||active()) : String(currentUser?.team||'').trim();
    if(!team) throw new Error('User does not have an assigned team. Assign a team in User Management first.');
    if(!window.isAdminSession?.() && n(team)!==n(currentUser?.team)) throw new Error('You can only update data of your own team.');
    return team;
  };
  function teamMembers(){ const t=active(); return (Array.isArray(users)?users:[]).filter(u=>u.role!=='Admin' && n(u.team)===n(t) && String(u.status||'Active')!=='Inactive'); }
  function teamCategories(){ return (Array.isArray(capacityData)?capacityData:[]).filter(r=>same(r)); }
  window.getCurrentTeamMembers=teamMembers;
  window.getCurrentTeamCategories=teamCategories;
  function cleanSelect(select, allowed){
    if(!select) return;
    const current=select.value;
    [...select.options].forEach(o=>{ if(o.value && !allowed.has(n(o.value))) o.remove(); });
    if([...select.options].some(o=>o.value===current)) select.value=current;
  }
  function enforceAllDropdowns(){
    if(!currentUser) return;
    const memberSet=new Set(teamMembers().map(u=>n(u.name||u.username||u.displayName)));
    const categorySet=new Set(teamCategories().map(x=>n(x.category)).filter(Boolean));
    // Only team-data dropdowns, by exact id. Never Priority/Status/Type/Role/Team.
    // Time Off & Overtime is employee-wide: all Active users are valid choices.
    // Do not apply current-team scoping to timeoffPIC / timeoffEditPIC.
    const cat=document.getElementById('taskCategory');
    if(cat){ categorySet.add('other'); cleanSelect(cat,categorySet); }
  }
  window.enforceAllTeamDropdowns=enforceAllDropdowns;
  window.renderTeamSwitcher=function(){
    const label=document.getElementById('teamStaticLabel'), box=document.getElementById('teamAdminControls');
    const sel=document.getElementById('teamSwitcher'), hint=document.getElementById('teamHint'), greet=document.getElementById('teamGreeting');
    if(!label||!currentUser) return;
    const t=active();
    if(window.isAdminSession?.()){
      label.classList.add('hidden'); box?.classList.remove('hidden'); hint?.classList.add('hidden');
      const teams=window.computeKnownTeams?.()||[];
      if(t && !teams.some(x=>n(x)===n(t))) teams.push(t);
      sel.innerHTML=teams.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
      if(!sel.getAttribute('onchange')) sel.setAttribute('onchange','switchTeamView(this.value)');
      if(t) sel.value=teams.find(x=>n(x)===n(t))||t;
      if(greet) greet.textContent=sel.value||t||'';
    }else{
      box?.classList.add('hidden'); hint?.classList.add('hidden'); label.classList.remove('hidden');
      label.textContent=t||'\u2014'; if(greet) greet.textContent=t||'';
    }
  };
  window.switchTeamView=async function(value){
    if(!window.isAdminSession?.()) return;
    const team=String(value||'').trim();
    if(!team || team===window.TEAM_ALL) return showAppNotification?.('Please select a specific team.','Team required');
    window.activeTeamView=team; window.__loadedTaskKey=null;
    try{ bomTopFilterState.Category.clear(); bomTopFilterState.Member.clear(); }catch(_){ }
    const ok=await fetchAllDataFromSheet({background:false,forceRender:true});
    if(ok){ try{populateFilterOptions();}catch(_){} try{updateDashboardCharts();}catch(_){} }
    window.renderTeamSwitcher(); enforceAllDropdowns();
    try{ window.scopeReload?.(); }catch(_){}
  };
  const oldFetch=window.fetchAllDataFromSheet;
  if(typeof oldFetch==='function' && !oldFetch.__strictTeamV6){
    const wrapped=async function(){
      if(currentUser && !window.activeTeamView) window.activeTeamView=String(currentUser.team||'').trim();
      const result=await oldFetch.apply(this,arguments);
      window.renderTeamSwitcher();
      try{populateFilterOptions();}catch(_){}
      enforceAllDropdowns();
      return result;
    };
    wrapped.__strictTeamV6=true; window.fetchAllDataFromSheet=wrapped;
  }
  document.addEventListener('click',()=>setTimeout(enforceAllDropdowns,0),true);
})();
