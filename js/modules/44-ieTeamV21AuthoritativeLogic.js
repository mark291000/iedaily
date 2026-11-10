(function(){
  'use strict';
  const W=window;
  const k=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
  const activeTeam=()=>{try{const t=W.getViewTeam?.();return t===W.TEAM_ALL?'':String(t||'').trim();}catch(_){return String(W.activeTeamView||'').trim();}};
  const baseUsers=()=>W.__mtr?.all?.length?W.__mtr.all:(Array.isArray(W.users)?W.users:(typeof users!=='undefined'?users:[]));
  const memberships=user=>{try{return W.getUserMemberships?.(user)||[];}catch(_){return [];}};
  function primaryTeam(user){const list=memberships(user);const main=list.find(m=>m.primary)||list.find(m=>k(m.team)===k(user?.team));return String(main?.team||(!list.length?user?.team:'')||'').trim();}
  function rebuildExclusions(){
    const team=activeTeam(),excluded=new Set();
    baseUsers().forEach(user=>{const name=k(user?.name||user?.username||user?.displayName||'');if(!name)return;const main=primaryTeam(user);if(user?.show===false||(team&&k(main)!==k(team)))excluded.add(name);});
    W.__v21ExcludedMembers=excluded;
    return excluded;
  }
  const inheritedHidden=typeof W.isHiddenMember==='function'?W.isHiddenMember:null;
  const exclusionSet=()=>W.__v21ExcludedMembers instanceof Set?W.__v21ExcludedMembers:rebuildExclusions();
  const hidden=function(name){const nameKey=k(name);return !!nameKey&&(exclusionSet().has(nameKey)||(inheritedHidden?inheritedHidden(name):false));};
  W.isHiddenMember=hidden;try{isHiddenMember=hidden;}catch(_){ }
  W.isReportableActiveUser=user=>!!user&&k(user.status||'Active')==='active'&&!hidden(user.name||user.username||user.displayName||'');
  W.reportableTaskPICs=task=>{const list=typeof taskPICs==='function'?taskPICs(task):(Array.isArray(task?.pics)?task.pics:String(task?.pic||'').split(','));return list.filter(name=>!hidden(name));};
  try{reportableTaskPICs=W.reportableTaskPICs;isReportableActiveUser=W.isReportableActiveUser;}catch(_){ }

  /* Scope every member-facing page to Main + Show Yes. Sub remains available for management/session switching only. */
  const inheritedScope=W.applyTeamScopeToState;
  if(typeof inheritedScope==='function'){
    const scoped=function(){
      const result=inheritedScope.apply(this,arguments),team=activeTeam(),all=baseUsers(),byName=new Map();
      all.forEach(user=>byName.set(k(user?.name||user?.username||user?.displayName||''),user));
      const allowedUser=user=>{const base=byName.get(k(user?.name||user?.username||user?.displayName||''))||user;const main=primaryTeam(base);return base?.show!==false&&!!main&&(!team||k(main)===k(team));};
      if(Array.isArray(users))users=users.filter(allowedUser).map(user=>({...user,team:primaryTeam(byName.get(k(user.name))||user)||user.team,membershipType:'Main'}));
      W.users=users;rebuildExclusions();W.invalidateHiddenMembers?.();
      return result;
    };
    W.applyTeamScopeToState=scoped;
  }

  function installProjectColumns(){
    document.querySelectorAll('#tab-projects .v13-project-table').forEach(table=>{
      const labels=['Project name','Owner','Start','Plan Completed','Actual','Status','Current Stage','%Progress','Archived goal','Saving (if have)','Key Project','Action'];
      let group=table.querySelector(':scope > colgroup.v21-project-cols');
      if(!group){group=document.createElement('colgroup');group.className='v21-project-cols';group.innerHTML='<col class="v21-project"><col class="v21-owner"><col class="v21-date"><col class="v21-date"><col class="v21-date"><col class="v21-status"><col class="v21-stage"><col class="v21-progress"><col class="v21-goal"><col class="v21-saving"><col class="v21-key"><col class="v21-action">';table.insertBefore(group,table.firstChild);}
      const heads=[...table.querySelectorAll('thead th')];
      heads.forEach((th,index)=>{const label=labels[index]||'';const span=th.querySelector('.v13-filter-head>span');if(span&&label)span.textContent=label;else if(index===heads.length-1&&label)th.textContent=label;th.dataset.columnLabel=label;th.setAttribute('aria-label',label);});
    });
  }
  const projectHost=document.getElementById('projectsTableBody');
  if(projectHost){new MutationObserver(()=>requestAnimationFrame(installProjectColumns)).observe(projectHost,{childList:true,subtree:true});requestAnimationFrame(installProjectColumns);}
  const inheritedProjectRender=W.renderProjectsTable;
  if(typeof inheritedProjectRender==='function'){
    const wrapped=function(){const result=inheritedProjectRender.apply(this,arguments);requestAnimationFrame(()=>requestAnimationFrame(installProjectColumns));return result;};
    wrapped.__v21=true;W.renderProjectsTable=wrapped;try{renderProjectsTable=wrapped;}catch(_){ }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{rebuildExclusions();installProjectColumns();},{once:true});else requestAnimationFrame(()=>{rebuildExclusions();installProjectColumns();});
})();
