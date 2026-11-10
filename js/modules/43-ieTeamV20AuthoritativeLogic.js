(function(){
  'use strict';
  const W=window;
  const session=()=>typeof currentUser!=='undefined'?currentUser:W.currentUser;
  const key=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isViewer=()=>!!session()&&session().isReadOnly===true;
  function allKnownTeams(){
    const map=new Map(),add=value=>{const label=String(value??'').trim();if(label&&!/^(__ALL__|loading teams|all teams)$/i.test(label)&&!map.has(key(label)))map.set(key(label),label);};
    try{(W.computeKnownTeams?.()||[]).forEach(add);}catch(_){}
    (W.teamsTableRows||[]).forEach(row=>add(row?.code||row?.team||row?.name));
    (W.__seenTeams||[]).forEach(add);
    document.querySelectorAll('#loginTeam option').forEach(option=>add(option.value));
    add(session()?.team);
    return [...map.values()].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  }
  function ensureViewerPicker(){
    let box=document.getElementById('mtrSwitchBox');
    if(!box){
      const card=document.getElementById('teamSwitcherCard');
      if(!card)return null;
      box=document.createElement('div');box.id='mtrSwitchBox';box.setAttribute('data-mtr-free','1');
      box.innerHTML='<label for="mtrScopeSel" class="sr-only">Active team</label><select id="mtrScopeSel"></select><p class="mt-1.5 text-[10px] text-slate-400" id="mtrScopeHint"></p>';
      const label=document.getElementById('teamStaticLabel');
      label?label.insertAdjacentElement('afterend',box):card.appendChild(box);
      box.querySelector('select').addEventListener('change',event=>W.switchTeamView(event.target.value));
    }
    box.setAttribute('data-mtr-free','1');
    return box;
  }
  const inheritedRenderTeam=W.renderTeamSwitcher;
  W.renderTeamSwitcher=function(){
    const result=typeof inheritedRenderTeam==='function'?inheritedRenderTeam.apply(this,arguments):undefined;
    if(!isViewer())return result;
    const box=ensureViewerPicker();if(!box)return result;
    const teams=allKnownTeams(),select=box.querySelector('select');
    select.innerHTML=teams.map(team=>`<option value="${esc(team)}">${esc(team)}</option>`).join('');
    const active=teams.find(team=>key(team)===key(session()?.team||W.activeTeamView))||teams[0]||'';
    if(active)select.value=active;
    select.disabled=false;
    box.classList.remove('hidden');box.classList.add('v20-viewer-team-picker');
    document.getElementById('teamStaticLabel')?.classList.add('hidden');
    document.getElementById('teamAdminControls')?.classList.add('hidden');
    const hint=document.getElementById('mtrScopeHint');if(hint)hint.textContent='View only · choose any team.';
    const greet=document.getElementById('teamGreeting');if(greet)greet.textContent=active;
    return result;
  };
  try{renderTeamSwitcher=W.renderTeamSwitcher;}catch(_){}

  const inheritedSwitchTeam=W.switchTeamView;
  W.switchTeamView=async function(value){
    if(!isViewer())return typeof inheritedSwitchTeam==='function'?inheritedSwitchTeam.apply(this,arguments):undefined;
    const team=allKnownTeams().find(item=>key(item)===key(value));
    const user=session();
    if(!user||!team||key(team)===key(user.team))return;
    const previous=String(user.team||'');
    const select=document.querySelector('#mtrSwitchBox select');if(select)select.disabled=true;
    W.activeTeamView=team;user.team=team;W.__loadedTaskKey=null;
    try{bomTopFilterState?.Category?.clear?.();bomTopFilterState?.Member?.clear?.();}catch(_){}
    try{
      const ok=await W.fetchAllDataFromSheet({background:false,forceRender:true});
      if(ok===false)throw new Error('Unable to load the selected team.');
      try{W.initUserSession?.();}catch(_){}
      try{W.populateFilterOptions?.();}catch(_){}
      try{W.updateDashboardCharts?.();}catch(_){}
    }catch(error){
      W.activeTeamView=previous;user.team=previous;
      try{W.showAppNotification?.(error?.message||'Unable to switch team.','Team view');}catch(_){}
    }finally{W.renderTeamSwitcher();}
  };
  try{switchTeamView=W.switchTeamView;}catch(_){}

  const expandedProjects=new Set();
  function toggleProjectRow(row,force){
    const id=String(row.dataset.projectId||'');
    const expanded=force===undefined?!row.classList.contains('v20-project-expanded'):!!force;
    row.classList.toggle('v20-project-expanded',expanded);
    row.setAttribute('aria-expanded',String(expanded));
    if(id){if(expanded)expandedProjects.add(id);else expandedProjects.delete(id);}
  }
  const projectHost=document.getElementById('projectsTableBody');
  if(projectHost){
    projectHost.addEventListener('click',event=>{
      if(event.target.closest('button,input,select,textarea,a,[role="button"]'))return;
      const row=event.target.closest('.v13-project-table tbody tr[data-project-id]');if(row)toggleProjectRow(row);
    });
    projectHost.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      if(event.target.closest('button,input,select,textarea,a,[role="button"]'))return;
      const row=event.target.closest('.v13-project-table tbody tr[data-project-id]');if(!row)return;
      event.preventDefault();toggleProjectRow(row);
    });
    const prepareRows=()=>projectHost.querySelectorAll('.v13-project-table tbody tr[data-project-id]').forEach(row=>{const expanded=expandedProjects.has(String(row.dataset.projectId||''));row.classList.toggle('v20-project-expanded',expanded);row.tabIndex=0;row.setAttribute('aria-expanded',String(expanded));row.title='Click to expand or collapse the full project name and description';});
    new MutationObserver(()=>requestAnimationFrame(prepareRows)).observe(projectHost,{childList:true,subtree:true});
    requestAnimationFrame(prepareRows);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>W.renderTeamSwitcher?.(),{once:true});
  else requestAnimationFrame(()=>W.renderTeamSwitcher?.());
})();
