/* =====================================================================
   MULTI-TEAM ROLES V1
   - public.users            : 1 row per person (name, password, status).
                               users.team / users.role = PRIMARY team + role (kept for compatibility).
                               users.role = 'Admin'  -> App Admin (all teams).
   - public.user_team_roles  : 1 row per person + team  (role = Team Admin | Member | Viewer).
   - Session: a non-App-Admin works in ONE active team at a time. currentUser.team / role
     are switched to that team's values, so every existing permission check keeps working.
   - Team Admin: manages users only inside teams where they are Team Admin,
     can grant Member / Viewer only. Only App Admin grants Team Admin / App Admin.
   ===================================================================== */
(function(){
'use strict';
const TBL='user_team_roles';
const ROLES=['Team Admin','Member','Viewer'];
const N=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const $=id=>document.getElementById(id);
const esc=v=>(typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const PALETTE=['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#ef4444','#84cc16','#f97316'];
const MT={rows:[],ok:false,all:[],view:'user',q:'',fTeam:'',fRole:'',fStatus:'',showPw:new Set(),edit:null};
window.__mtr=MT;

const isAppAdmin=()=>!!currentUser&&!currentUser.isReadOnly&&(typeof window.isAdminSession==='function'?window.isAdminSession():currentUser.role==='Admin');
const roleOk=r=>ROLES.find(x=>N(x)===N(r))||'';
function normRole(v){
  const x=N(v).replace(/[^a-z ]/g,'');
  if(x==='app admin'||x==='admin'||x==='appadmin') return 'Admin';
  if(x==='team admin'||x==='teamadmin') return 'Team Admin';
  if(x==='member') return 'Member';
  if(x==='viewer') return 'Viewer';
  return '';
}
function avatarColor(name){let h=0;for(const ch of String(name||''))h=(h*31+ch.charCodeAt(0))>>>0;return PALETTE[h%PALETTE.length];}
function initials(name){return String(name||'?').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'?';}
function knownTeams(){return (window.computeKnownTeams?.()||[]).slice();}
function canonTeam(t){const k=knownTeams().find(x=>N(x)===N(t));return k||String(t||'').trim();}

/* ---------------- data ---------------- */
async function loadMemberships(){
  if(!window.supabaseClient&&typeof initSupabaseClient==='function') initSupabaseClient();
  try{
    const all=[];
    for(let from=0;;from+=1000){
      const r=await supabaseClient.from(TBL).select('id,user_id,team,role,is_primary').order('id',{ascending:true}).range(from,from+999);
      if(r.error) throw r.error;
      all.push(...(r.data||[]));
      if(!r.data||r.data.length<1000) break;
    }
    MT.rows=all; MT.ok=true;
  }catch(e){
    if(MT.ok!==false||!MT.__warned){console.warn('user_team_roles not available - run the SQL migration:',e?.message||e);MT.__warned=true;}
    MT.rows=[]; MT.ok=false;
  }
}
/* memberships of a BASE (unscoped) user object */
function membershipsOf(u){
  if(!u) return [];
  const id=String(u.id);
  const list=[];
  MT.rows.filter(r=>String(r.user_id)===id).forEach(r=>{
    const t=String(r.team||'').trim(); if(!t||list.some(x=>N(x.team)===N(t))) return;
    list.push({team:t,role:roleOk(r.role)||'Member',primary:!!r.is_primary});
  });
  const pt=String(u.team||'').trim();
  if(pt&&!list.some(x=>N(x.team)===N(pt))) list.unshift({team:pt,role:roleOk(u.role)||'Member',primary:true});
  if(pt) list.forEach(x=>x.primary=N(x.team)===N(pt));
  else if(list.length&&!list.some(x=>x.primary)) list[0].primary=true;
  return list.sort((a,b)=>Number(b.primary)-Number(a.primary)||a.team.localeCompare(b.team));
}
window.getUserMemberships=membershipsOf;
function baseUsers(){return MT.all.length?MT.all:(Array.isArray(users)?users:[]);}

/* teams the signed-in user may manage on the Users page */
function manageableTeams(){
  if(!currentUser||currentUser.isReadOnly) return [];
  if(isAppAdmin()) return knownTeams();
  return (currentUser.memberships||[]).filter(m=>m.role==='Team Admin').map(m=>m.team);
}
const canManageTeam=t=>isAppAdmin()||manageableTeams().some(x=>N(x)===N(t));
const canOpenUsersPage=()=>isAppAdmin()||manageableTeams().length>0;
window.mtrManageableTeams=manageableTeams;

/* ---------------- session: active team of a multi-team user ---------------- */
function applySessionTeam(){
  if(!currentUser||currentUser.isReadOnly) return;
  if(!currentUser.__base) currentUser.__base={team:String(currentUser.team||'').trim(),role:currentUser.role};
  if(isAppAdmin()){currentUser.memberships=membershipsOf({id:currentUser.id,team:currentUser.__base.team,role:'Member'});return;}
  const list=membershipsOf({id:currentUser.id,team:currentUser.__base.team,role:currentUser.__base.role});
  currentUser.memberships=list;
  if(!list.length) return;
  const want=String(window.activeTeamView||'').trim();
  const m=list.find(x=>N(x.team)===N(want))||list.find(x=>x.primary)||list[0];
  window.activeTeamView=m.team; currentUser.team=m.team; currentUser.role=m.role;
}
window.mtrApplySessionTeam=applySessionTeam;

/* scope arrays to the active team; users = everybody who has access to that team */
window.applyTeamScopeToState=function(){
  const base=(Array.isArray(users)?users:[]).map(u=>({...u}));
  MT.all=base;
  const seen=new Set();
  base.forEach(u=>{if(u.role!=='Admin'&&u.team)seen.add(String(u.team).trim());});
  MT.rows.forEach(r=>{if(r.team)seen.add(String(r.team).trim());});
  [capacityData,dailyTasks,projectsList,timeoffOtList].forEach(l=>(l||[]).forEach(r=>{if(r&&r.team)seen.add(String(r.team).trim());}));
  window.__seenTeams=[...seen].filter(Boolean);
  const v=typeof window.getViewTeam==='function'?window.getViewTeam():'';
  if(v&&v!==window.TEAM_ALL){
    users=base.flatMap(u=>{
      const m=membershipsOf(u).find(x=>N(x.team)===N(v));
      if(!m) return [];
      return [{...u,team:m.team,role:u.role==='Admin'?'Admin':m.role,primaryTeam:u.team,primaryRole:u.role}];
    });
    if(typeof window.scopeRowsToTeam==='function'){
      capacityData=window.scopeRowsToTeam(capacityData);dailyTasks=window.scopeRowsToTeam(dailyTasks);
      timeoffOtList=window.scopeRowsToTeam(timeoffOtList);projectsList=window.scopeRowsToTeam(projectsList);
    }
  }
  try{window.renderTeamSwitcher?.();}catch(_){}
};

const prevFetch=window.fetchAllDataFromSheet;
if(typeof prevFetch==='function'){
  const wrapped=async function(){
    if(currentUser&&!currentUser.isReadOnly){await loadMemberships();applySessionTeam();}
    const r=await prevFetch.apply(this,arguments);
    try{window.renderTeamSwitcher?.();syncNav();}catch(_){}
    return r;
  };
  window.fetchAllDataFromSheet=wrapped;
  try{fetchAllDataFromSheet=wrapped;}catch(_){}
}

/* ---------------- sidebar switcher for multi-team users ---------------- */
function ensureSwitchBox(){
  let box=$('mtrSwitchBox'); if(box) return box;
  const card=$('teamSwitcherCard'); if(!card) return null;
  box=document.createElement('div'); box.id='mtrSwitchBox'; box.className='hidden'; box.setAttribute('data-mtr-free','1');
  box.innerHTML='<label for="mtrScopeSel" class="sr-only">Active team</label><select id="mtrScopeSel"></select><p class="mt-1.5 text-[10px] text-slate-400" id="mtrScopeHint"></p>';
  const label=$('teamStaticLabel'); label?label.insertAdjacentElement('afterend',box):card.appendChild(box);
  box.querySelector('select').addEventListener('change',e=>window.switchTeamView(e.target.value));
  return box;
}
const prevRenderSwitcher=window.renderTeamSwitcher;
window.renderTeamSwitcher=function(){
  const r=typeof prevRenderSwitcher==='function'?prevRenderSwitcher.apply(this,arguments):undefined;
  const box=ensureSwitchBox(); if(!box) return r;
  const list=currentUser&&!currentUser.isReadOnly&&!isAppAdmin()?(currentUser.memberships||[]):[];
  if(list.length>1){
    const sel=box.querySelector('select');
    sel.innerHTML=list.map(m=>`<option value="${esc(m.team)}">${esc(m.team)} — ${m.primary?'Main':'Sub'} · ${esc(m.role)}</option>`).join('');
    sel.value=list.find(m=>N(m.team)===N(currentUser.team))?.team||list[0].team;
    $('mtrScopeHint').textContent=`You have access to ${list.length} teams.`;
    box.classList.remove('hidden'); $('teamStaticLabel')?.classList.add('hidden');
  }else{
    box.classList.add('hidden');
    if(!isAppAdmin()) $('teamStaticLabel')?.classList.remove('hidden');
  }
  return r;
};
const prevSwitchTeam=window.switchTeamView;
window.switchTeamView=async function(value){
  if(isAppAdmin()) return prevSwitchTeam?.apply(this,arguments);
  const m=(currentUser?.memberships||[]).find(x=>N(x.team)===N(value));
  if(!m) return;
  window.activeTeamView=m.team; currentUser.team=m.team; currentUser.role=m.role; window.__loadedTaskKey=null;
  try{bomTopFilterState.Category.clear();bomTopFilterState.Member.clear();}catch(_){}
  const ok=await window.fetchAllDataFromSheet({background:false,forceRender:true});
  try{initUserSession();}catch(_){}
  if(ok){try{populateFilterOptions();}catch(_){} try{updateDashboardCharts();}catch(_){}}
  window.renderTeamSwitcher();
  try{window.enforceAllTeamDropdowns?.();}catch(_){}
  try{if(!$('tab-bom-cs-scope')?.classList.contains('hidden')) window.renderScopeFromDb?.();}catch(_){}
  if(!$('tab-users')?.classList.contains('hidden')&&!canOpenUsersPage()) switchTab('dashboard');
};

/* ---------------- nav visibility ---------------- */
function syncNav(){
  if(!currentUser) return;
  const ok=canOpenUsersPage();
  $('nav-users')?.classList.toggle('hidden',!ok);
  $('nav-users-divider')?.classList.toggle('hidden',!ok);
  const badge=$('currentUserRoleBadge');
  if(badge&&!currentUser.isReadOnly) badge.textContent=isAppAdmin()?'App Admin':(currentUser.role||'Member');
  const adm=isAppAdmin();
  ['mtrImportBtn','mtrTemplateBtn'].forEach(id=>$(id)?.classList.toggle('hidden',!adm));
}
const prevInit=window.initUserSession;
if(typeof prevInit==='function'){
  const w=function(){const r=prevInit.apply(this,arguments);try{syncNav();window.renderTeamSwitcher();}catch(_){}return r;};
  window.initUserSession=w; try{initUserSession=w;}catch(_){}
}
const prevLogout=window.logout;
if(typeof prevLogout==='function'){
  const w=function(){MT.all=[];MT.rows=[];MT.showPw.clear();return prevLogout.apply(this,arguments);};
  window.logout=w; try{logout=w;}catch(_){}
}

/* ---------------- USERS PAGE ---------------- */
function buildUsersPage(){
  const tab=$('tab-users'); if(!tab||$('mtrUsers')) return;
  tab.innerHTML=`
  <div id="mtrUsers" data-mtr-free="1">
    <div class="mtr-bar">
      <div class="mtr-title"><i class="fa-solid fa-users-gear text-indigo-500"></i>Users &amp; Team Access</div>
      <button type="button" class="mtr-btn indigo" onclick="mtrOpenUser()"><i class="fa-solid fa-user-plus"></i> Add User</button>
      <button type="button" id="mtrImportBtn" class="mtr-btn blue hidden" onclick="document.getElementById('mtrImportInput').click()" title="App Admin only"><i class="fa-solid fa-file-import"></i> Import</button>
      <input type="file" id="mtrImportInput" accept=".xlsx,.xls,.csv" class="hidden">
      <button type="button" id="mtrTemplateBtn" class="mtr-btn hidden" onclick="mtrDownloadTemplate()"><i class="fa-solid fa-file-arrow-down"></i> Template</button>
      <button type="button" class="mtr-btn" onclick="openTeamModal()"><i class="fa-solid fa-people-group"></i> Add Team</button>
      <button type="button" class="mtr-btn" onclick="mtrExportAccess()"><i class="fa-solid fa-file-export"></i> Export</button>
    </div>
    <div class="mtr-kpis" id="mtrKpis"></div>
    <div class="mtr-bar">
      <label class="sr-only" for="mtrSearch">Search member</label>
      <input id="mtrSearch" class="mtr-in" placeholder="Search member..." autocomplete="off">
      <label class="sr-only" for="mtrFTeam">Team</label><select id="mtrFTeam" class="mtr-sel"></select>
      <label class="sr-only" for="mtrFRole">Role</label>
      <select id="mtrFRole" class="mtr-sel"><option value="">All roles</option><option value="Admin">App Admin</option><option>Team Admin</option><option>Member</option><option>Viewer</option></select>
      <label class="sr-only" for="mtrFStatus">Status</label>
      <select id="mtrFStatus" class="mtr-sel"><option value="">All status</option><option>Active</option><option>Inactive</option></select>
      <select id="mtrFShow" class="mtr-sel" aria-label="Show in reports"><option value="">Show: All</option><option value="yes">Show: Yes</option><option value="no">Show: No</option></select>
      <select id="mtrFMulti" class="mtr-sel" aria-label="Team count"><option value="">Any team count</option><option value="multi">Multi-team only</option></select>
      <button type="button" class="mtr-btn" onclick="mtrResetFilters()"><i class="fa-solid fa-rotate-left"></i> Reset</button>
      <span class="mtr-note" id="mtrCount" aria-live="polite" style="margin-right:auto"></span>
      <div class="mtr-seg" role="group" aria-label="View"><button type="button" data-v="user" class="on">By User</button><button type="button" data-v="team">By Team</button></div>
    </div>
    <div id="mtrViewUser" class="mtr-card"><div class="mtr-scroll">
      <table id="table-users"><thead><tr>
        <th style="min-width:190px">Member</th><th style="min-width:160px">Team</th><th style="width:130px">Main / Sub</th><th style="width:140px">Role</th><th style="width:90px">Status</th><th style="width:90px;text-align:center" title="No = excluded from headcount, PIC, workload and utilization">Show</th><th style="width:130px">Password</th><th style="width:90px;text-align:center">Action</th>
      </tr></thead><tbody id="userManagementTableBody"></tbody></table>
    </div></div>
    <div id="mtrViewTeam" class="hidden"><div class="mtr-grid" id="mtrTeamGrid"></div></div>
  </div>`;
  $('mtrSearch').addEventListener('input',e=>{MT.q=e.target.value;render();});
  $('mtrFTeam').addEventListener('change',e=>{MT.fTeam=e.target.value;render();});
  $('mtrFRole').addEventListener('change',e=>{MT.fRole=e.target.value;render();});
  $('mtrFStatus').addEventListener('change',e=>{MT.fStatus=e.target.value;render();});
  $('mtrFMulti').addEventListener('change',e=>{MT.fMulti=e.target.value;render();});
  $('mtrFShow').addEventListener('change',e=>{MT.fShow=e.target.value;render();});
  $('mtrImportInput').addEventListener('change',handleImport);
  tab.querySelectorAll('.mtr-seg button').forEach(b=>b.addEventListener('click',()=>{
    MT.view=b.dataset.v; tab.querySelectorAll('.mtr-seg button').forEach(x=>x.classList.toggle('on',x===b)); render();
  }));
}
window.mtrResetFilters=function(){
  MT.q=MT.fTeam=MT.fRole=MT.fStatus=MT.fMulti=MT.fShow='';
  ['mtrSearch','mtrFTeam','mtrFRole','mtrFStatus','mtrFMulti','mtrFShow'].forEach(id=>{const el=$(id);if(el)el.value='';});
  render();
};

function visibleUsers(){
  const all=baseUsers();
  if(isAppAdmin()) return all;
  const mt=manageableTeams();
  return all.filter(u=>u.role!=='Admin'&&membershipsOf(u).some(m=>mt.some(t=>N(t)===N(m.team))));
}
function chipClass(role){return role==='Team Admin'?'ta':role==='Viewer'?'vw':'mb';}
function chipHtml(m,extra=''){
  return `<span class="mtr-chip ${chipClass(m.role)}" ${extra} title="${esc(m.team)} — ${esc(m.role)}">${esc(m.team)} · ${esc(m.role==='Team Admin'?'TA':m.role)}</span>`;
}
function passFilters(u,ms){
  if(MT.q&&!N(u.name).includes(N(MT.q))) return false;
  if(MT.fStatus&&N(u.status)!==N(MT.fStatus)) return false;
  if(MT.fTeam&&!ms.some(m=>N(m.team)===N(MT.fTeam))) return false;
  if(MT.fRole){
    if(MT.fRole==='Admin'){if(u.role!=='Admin')return false;}
    else if(!ms.some(m=>m.role===MT.fRole&&(!MT.fTeam||N(m.team)===N(MT.fTeam)))) return false;
  }
  if(MT.fMulti==='multi'&&ms.length<2) return false;
  if(MT.fShow==='yes'&&u.show===false) return false;
  if(MT.fShow==='no'&&u.show!==false) return false;
  return true;
}
function userEditable(u){
  if(!currentUser||currentUser.isReadOnly) return false;
  if(isAppAdmin()) return true;
  if(u.role==='Admin') return false;
  return membershipsOf(u).some(m=>canManageTeam(m.team)&&m.role!=='Team Admin');
}

function render(){
  buildUsersPage();
  const tb=$('userManagementTableBody'); if(!tb) return;
  const list=visibleUsers();
  // team filter options
  const teamsForFilter=isAppAdmin()?knownTeams():manageableTeams();
  const fs=$('mtrFTeam');
  if(fs){fs.innerHTML='<option value="">All teams</option>'+teamsForFilter.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');fs.value=teamsForFilter.find(t=>N(t)===N(MT.fTeam))||'';}
  syncNav();
  // KPIs
  const withMs=list.map(u=>({u,ms:membershipsOf(u)}));
  const kp=$('mtrKpis');
  if(kp){
    const active=withMs.filter(x=>N(x.u.status)==='active').length;
    const multi=withMs.filter(x=>x.ms.length>1).length;
    const tas=withMs.filter(x=>x.ms.some(m=>m.role==='Team Admin')).length;
    kp.innerHTML=[[list.length,'Users'],[active,'Active'],[multi,'Multi-team users'],[tas,'Team Admins'],[teamsForFilter.length,'Teams']]
      .map(([v,l])=>`<div class="mtr-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  }
  const warn=$('mtrSqlWarn');
  if(warn){warn.classList.toggle('hidden',MT.ok);warn.innerHTML=MT.ok?'':'<i class="fa-solid fa-triangle-exclamation"></i><span>Multi-team is not enabled yet: run <b>supabase_user_team_roles.sql</b> in Supabase, then reload the app. Until then each user has only one team and access cannot be added.</span>';}
  const rows=withMs.filter(x=>passFilters(x.u,x.ms)).sort((a,b)=>String(a.u.name).localeCompare(String(b.u.name)));
  const cnt=$('mtrCount'); if(cnt) cnt.textContent=`${rows.length} of ${list.length} user(s)`;
  $('mtrViewUser').classList.toggle('hidden',MT.view!=='user');
  $('mtrViewTeam').classList.toggle('hidden',MT.view!=='team');
  // BY USER: one row per team access
  const html=[];
  rows.forEach(({u,ms})=>{
    const ed=userEditable(u), self=currentUser&&String(currentUser.id)===String(u.id);
    const pwShown=MT.showPw.has(String(u.id));
    const uid=esc(u.id);
    const userCell=`<div class="mtr-name"><span class="mtr-av" style="background:${avatarColor(u.name)}">${esc(initials(u.name))}</span><span>${esc(u.name)}${self?' <span class="text-[10px] text-slate-400 font-semibold">(you)</span>':''}</span></div>`;
    const shown=u.show!==false;
    const showCell=isAppAdmin()?`<button type="button" class="mtr-show ${shown?'on':'off'}" onclick="mtrToggleShow('${uid}')" title="Click to switch" aria-label="Show ${esc(u.name)} in reports: ${shown?'Yes':'No'}">${shown?'Yes':'No'}</button>`:`<span class="mtr-show ${shown?'on':'off'}">${shown?'Yes':'No'}</span>`;
    const status=`<span class="mtr-st ${N(u.status)==='active'?'on':'off'}">${esc(u.status||'Inactive')}</span>`;
    const pw=ed&&(isAppAdmin()||membershipsOf(u).every(m=>canManageTeam(m.team)))?`<span class="mtr-pw">${pwShown?esc(u.password):'••••••'}<button type="button" class="mtr-icon" onclick="mtrTogglePw('${uid}')" aria-label="${pwShown?'Hide':'Show'} password"><i class="fa-solid ${pwShown?'fa-eye-slash':'fa-eye'}"></i></button></span>`:'<span class="text-slate-300">—</span>';
    const acts=ed?`<button type="button" class="mtr-icon" onclick="mtrOpenUser('${uid}')" title="Edit user" aria-label="Edit ${esc(u.name)}"><i class="fa-solid fa-pen-to-square"></i></button>${self?'':`<button type="button" class="mtr-icon del" onclick="mtrDeleteUser('${uid}')" title="${isAppAdmin()?'Delete user':'Remove from my team(s)'}" aria-label="Delete ${esc(u.name)}"><i class="fa-solid fa-trash"></i></button>`}`:'<span class="text-[10px] text-slate-400">View only</span>';
    let teamHtml, roleHtml;
    if(u.role==='Admin'){
      teamHtml='<span class="mtr-allteams">All teams</span>';
      roleHtml='<span class="mtr-role-ro aa">App Admin</span>';
    }else if(!ms.length){
      teamHtml='<span class="text-red-500 text-xs font-semibold">No team</span>';
      roleHtml='<span class="text-slate-300">—</span>';
    }else{
      const order={'Team Admin':0,'Member':1,'Viewer':2};
      teamHtml='<div class="mtr-tchips">'+ms.slice().sort((x,y)=>(y.primary?1:0)-(x.primary?1:0)||order[x.role]-order[y.role]||String(x.team).localeCompare(String(y.team)))
        .map(m=>`<span class="mtr-tchip ${chipClass(m.role)}" title="${esc(m.team)} — ${esc(m.role)}${m.primary?' (primary team)':''}">${esc(m.team)}${m.role==='Team Admin'?'<em>TA</em>':m.role==='Viewer'?'<em>View</em>':''}</span>`).join('')+'</div>';
      const top=ms.some(m=>m.role==='Team Admin')?'Team Admin':ms.some(m=>m.role==='Member')?'Member':'Viewer';
      roleHtml=`<span class="mtr-role-ro ${chipClass(top)}">${top}</span>`;
    }
    const membershipHtml=u.role==='Admin'?'<span class="mtr-role-ro aa">All teams</span>':(ms.length?`<div class="mtr-tchips">${ms.slice().sort((a,b)=>Number(b.primary)-Number(a.primary)||String(a.team).localeCompare(String(b.team))).map(m=>`<span class="mtr-membership ${m.primary?'main':'sub'}" title="${esc(m.team)}: ${m.primary?'Main team — counted as member':'Sub team — management access only'}">${m.primary?'Main':'Sub'} · ${esc(m.team)}</span>`).join('')}</div>`:'<span class="text-slate-300">—</span>');
    html.push(`<tr class="g-first"><td class="c-user">${userCell}</td><td>${teamHtml}</td><td>${membershipHtml}</td><td>${roleHtml}</td><td>${status}</td><td style="text-align:center">${showCell}</td><td>${pw}</td><td style="text-align:center;white-space:nowrap">${acts}</td></tr>`);
  });
  tb.innerHTML=html.length?html.join(''):`<tr><td colspan="8"><div class="mtr-empty">No user matches the current filters.</div></td></tr>`;
  // BY TEAM
  const grid=$('mtrTeamGrid');
  if(grid&&MT.view==='team'){
    const teams=(MT.fTeam?[MT.fTeam]:teamsForFilter);
    grid.innerHTML=teams.length?teams.map(t=>{
      const mem=rows.map(x=>({u:x.u,m:x.ms.find(m=>N(m.team)===N(t))})).filter(x=>x.m);
      const grp=r=>mem.filter(x=>x.m.role===r).sort((a,b)=>String(a.u.name).localeCompare(String(b.u.name)));
      const sec=(r,label)=>{const g=grp(r);return g.length?`<div class="mtr-grp">${label} (${g.length})</div>`+g.map(x=>`<span class="mtr-chip ${chipClass(r)}" role="button" tabindex="0" onclick="mtrOpenUser('${esc(x.u.id)}')" onkeydown="if(event.key==='Enter')mtrOpenUser('${esc(x.u.id)}')" title="${N(x.u.status)!=='active'?'Inactive':''}">${N(x.u.status)!=='active'?'<i class="fa-solid fa-ban"></i>':''}${esc(x.u.name)}</span>`).join(''):'';};
      const can=canManageTeam(t);
      return `<div class="mtr-team"><div class="mtr-team-h"><b title="${esc(t)}">${esc(t)}</b><small>${mem.length} user(s)</small>${can?`<button type="button" class="mtr-btn" onclick="mtrOpenUser('', '${esc(t).replace(/'/g,'&#39;')}')"><i class="fa-solid fa-plus"></i></button>`:''}</div>
        <div class="mtr-team-b">${sec('Team Admin','<i class="fa-solid fa-crown"></i> Team Admin')}${sec('Member','Member')}${sec('Viewer','Viewer')}${mem.length?'':'<div class="mtr-note" style="padding:8px 0">No user in this team.</div>'}</div></div>`;
    }).join(''):'<div class="mtr-empty">No team.</div>';
  }
  try{recomputeAdvancedTableFilter?.('table-users');}catch(_){}
}
async function mutate(uid,fn,okMsg){
  const u=baseUsers().find(x=>String(x.id)===String(uid)); if(!u) return;
  if(!MT.ok) return showAppNotification('Run supabase_user_team_roles.sql first.','Multi-team not enabled');
  const ms=membershipsOf(u).map(m=>({...m}));
  const next=fn(ms); if(!next) return;
  if(next.length&&!next.some(m=>m.primary)) next[0].primary=true;
  try{
    await persistUser(u,{name:u.name,password:u.password,status:u.status,appAdmin:u.role==='Admin'},next,isAppAdmin()?null:manageableTeams());
    MT.adding=null;
    await window.fetchAllDataFromSheet({background:true});
    render(); if(okMsg) showAppNotification(okMsg);
  }catch(err){console.error(err);showAppNotification(err?.message||'Save failed','Database Error');render();}
}
window.mtrSetRole=(uid,team,role)=>{
  if(!isAppAdmin()&&role==='Team Admin') return showAppNotification('Only App Admin can grant Team Admin.','Permission denied');
  mutate(uid,ms=>{const m=ms.find(x=>N(x.team)===N(team));if(!m)return null;m.role=role;return ms;});
};
window.mtrSetPrimary=(uid,team)=>mutate(uid,ms=>{ms.forEach(m=>m.primary=N(m.team)===N(team));return ms;});
window.mtrRemoveAccess=async(uid,team)=>{
  const u=baseUsers().find(x=>String(x.id)===String(uid));
  if(!(await showAppConfirm(`Remove access of "${u?.name}" to team "${team}"?`,'Remove access'))) return;
  mutate(uid,ms=>ms.filter(m=>N(m.team)!==N(team)),'Access removed.');
};
window.mtrQuickOpen=uid=>{MT.adding=String(uid);render();setTimeout(()=>document.getElementById('mtrQTeam')?.focus(),0);};
window.mtrQuickCancel=()=>{MT.adding=null;render();};
window.mtrQuickAdd=uid=>{
  const team=document.getElementById('mtrQTeam')?.value, role=document.getElementById('mtrQRole')?.value||'Member';
  if(!team) return showAppNotification('No team left to add.','Validation');
  if(!isAppAdmin()&&(role==='Team Admin'||!canManageTeam(team))) return showAppNotification('Permission denied.','Permission denied');
  mutate(uid,ms=>{if(ms.some(m=>N(m.team)===N(team)))return null;ms.push({team,role,primary:false});return ms;},`Added ${team} · ${role}.`);
};
window.mtrToggleShow=async function(id){
  if(!isAppAdmin()) return showAppNotification('Only App Admin can change Show.','Permission denied');
  const u=baseUsers().find(x=>String(x.id)===String(id)); if(!u) return;
  const next=u.show===false;
  try{
    const r=await supabaseClient.from('users').update({show_in_reports:next}).eq('id',Number(id));
    if(r.error) throw r.error;
    [users,MT.all].forEach(l=>(l||[]).forEach(x=>{if(String(x.id)===String(id))x.show=next;}));
    window.invalidateHiddenMembers?.(); render();
    await window.fetchAllDataFromSheet({background:true,forceRender:true});
    showAppNotification(`${u.name}: Show = ${next?'Yes':'No'}.`);
  }catch(err){console.error(err);showAppNotification((err?.message||'Save failed')+'\nRun the SQL that adds users.show_in_reports.','Database Error');}
};
window.mtrTogglePw=function(id){MT.showPw.has(id)?MT.showPw.delete(id):MT.showPw.add(id);render();};
window.renderUserManagementTable=render;
try{renderUserManagementTable=render;}catch(_){}

/* ---------------- MODAL ---------------- */
function roleOptionsFor(team,current){
  const all=isAppAdmin();
  return ROLES.map(r=>{const dis=!all&&r==='Team Admin';return `<option ${dis?'disabled':''} ${r===current?'selected':''}>${r}</option>`;}).join('');
}
function teamOptions(selected){
  const opts=isAppAdmin()?knownTeams():manageableTeams();
  if(selected&&!opts.some(t=>N(t)===N(selected))) opts.push(selected);
  return '<option value="">-- Select team --</option>'+opts.sort((a,b)=>a.localeCompare(b)).map(t=>`<option value="${esc(t)}" ${N(t)===N(selected)?'selected':''}>${esc(t)}</option>`).join('')+(isAppAdmin()?'<option value="__new__">+ New team...</option>':'');
}
function accessRowHtml(m,locked){
  const team=m?.team||'', role=m?.role||'Member';
  if(locked) return `<div class="mtr-row locked" data-locked="1" data-team="${esc(team)}" data-role="${esc(role)}" data-primary="${m?.primary?1:0}">
      <span class="text-xs font-semibold truncate" title="Managed by another Team Admin / App Admin"><i class="fa-solid fa-lock text-slate-400 mr-1"></i>${esc(team)}</span>
      <span class="text-xs">${esc(role)}</span>
      <span class="mtr-membership ${m?.primary?'main':'sub'}">${m?.primary?'Main':'Sub'}</span>
      <span></span></div>`;
  return `<div class="mtr-row" data-locked="0" data-primary="${m?.primary?1:0}">
      <select class="mtr-f mtr-team-sel" aria-label="Team">${teamOptions(team)}</select>
      <select class="mtr-f mtr-role-sel" aria-label="Role">${roleOptionsFor(team,role)}</select>
      <select class="mtr-f mtr-type-sel" aria-label="Main or Sub team"><option value="Main" ${m?.primary?'selected':''}>Main</option><option value="Sub" ${m?.primary?'':'selected'}>Sub</option></select>
      <button type="button" class="mtr-btn" style="padding:0 9px" onclick="this.closest('.mtr-row').remove()" aria-label="Remove access"><i class="fa-solid fa-xmark"></i></button></div>`;
}
function wireRows(){
  $('mtrAccessRows').querySelectorAll('.mtr-team-sel').forEach(sel=>{
    if(sel.__w) return; sel.__w=1;
    sel.addEventListener('change',()=>{
      if(sel.value!=='__new__') return;
      const name=String(prompt('New team name:')||'').trim();
      if(!name){sel.value='';return;}
      const opt=new Option(name,name,true,true); opt.dataset.newTeam='1';
      sel.add(opt,sel.options[sel.options.length-1]); sel.value=name;
    });
  });
}
window.mtrAddAccessRow=function(team){
  const box=$('mtrAccessRows');
  const makeMain=!box.querySelector('.mtr-row');
  box.insertAdjacentHTML('beforeend',accessRowHtml({team:team||'',role:'Member',primary:makeMain},false));
  wireRows();
};
function showModal(){ $('mtrUserModal').classList.remove('opacity-0','pointer-events-none'); document.body.classList.add('modal-active'); setTimeout(()=>$('mtrName')?.focus(),50); }
window.mtrCloseUser=function(){ $('mtrUserModal').classList.add('opacity-0','pointer-events-none'); document.body.classList.remove('modal-active'); MT.edit=null; };

window.mtrOpenUser=function(id,presetTeam){
  if(!canOpenUsersPage()) return showAppNotification('Only App Admin or Team Admin can manage users.','Permission denied');
  const u=id?baseUsers().find(x=>String(x.id)===String(id)):null;
  if(id&&!u) return;
  if(u&&!userEditable(u)) return showAppNotification('You can only edit Member / Viewer accounts in the teams you manage.','Permission denied');
  MT.edit=u||null;
  const admin=isAppAdmin();
  $('mtrModalTitle').textContent=u?`Edit User — ${u.name}`:'Add User';
  $('mtrEditId').value=u?u.id:'';
  $('mtrName').value=u?.name||''; $('mtrPassword').value=u?.password||''; $('mtrStatus').value=u?.status||'Active';
  $('mtrIsAppAdmin').checked=u?.role==='Admin';
  $('mtrAppAdminBox').classList.toggle('hidden',!admin);
  const ms=u?membershipsOf(u):[];
  // Team Admin cannot change identity fields of a user who also belongs to teams they do not manage
  const foreign=!admin&&ms.some(m=>!canManageTeam(m.team));
  ['mtrName','mtrPassword','mtrStatus'].forEach(i=>{$(i).disabled=!!foreign;});
  const note=$('mtrLockNote');
  note.classList.toggle('hidden',!foreign);
  note.textContent=foreign?'This user also belongs to teams you do not manage. You can change access only for your team(s); name, password and status are managed by App Admin.':'';
  const box=$('mtrAccessRows');
  box.innerHTML=ms.map(m=>accessRowHtml(m,!admin&&(!canManageTeam(m.team)||m.role==='Team Admin'))).join('');
  if(!u){ const t=presetTeam||(admin?'':(manageableTeams().find(x=>N(x)===N(currentUser.team))||manageableTeams()[0]||'')); mtrAddAccessRow(t); }
  wireRows();
  showModal();
};
window.openAddUserModal=function(){mtrOpenUser();};
window.openEditUserModal=function(idx){const u=(Array.isArray(users)?users:[])[idx];if(u)mtrOpenUser(u.id);};
try{openAddUserModal=window.openAddUserModal;openEditUserModal=window.openEditUserModal;}catch(_){}

function readAccessRows(){
  const out=[], errs=[], newTeams=[];
  $('mtrAccessRows').querySelectorAll('.mtr-row').forEach((row,i)=>{
    if(row.dataset.locked==='1'){out.push({team:row.dataset.team,role:row.dataset.role,primary:row.dataset.primary==='1',locked:true});return;}
    const sel=row.querySelector('.mtr-team-sel'); const team=String(sel.value||'').trim();
    const role=row.querySelector('.mtr-role-sel').value;
    const primary=row.querySelector('.mtr-type-sel')?.value==='Main';
    if(!team||team==='__new__'){errs.push(`Access row ${i+1}: select a team.`);return;}
    if(sel.selectedOptions[0]?.dataset.newTeam) newTeams.push(team);
    if(!isAppAdmin()&&!canManageTeam(team)) errs.push(`You do not manage team "${team}".`);
    if(!isAppAdmin()&&role==='Team Admin') errs.push('Only App Admin can grant Team Admin.');
    out.push({team:canonTeam(team),role,primary,locked:false});
  });
  const seen=new Set();
  out.forEach(m=>{const k=N(m.team);if(seen.has(k))errs.push(`Team "${m.team}" is listed twice.`);seen.add(k);});
  const mainCount=out.filter(m=>m.primary).length;
  if(out.length&&mainCount!==1) errs.push('Select exactly one Main team. All other team access rows must be Sub.');
  return {list:out,errs,newTeams};
}
async function ensureTeams(names){
  const known=new Set(knownTeams().map(N));
  const add=[...new Set(names.map(x=>String(x).trim()).filter(Boolean))].filter(t=>!known.has(N(t)));
  if(!add.length) return [];
  if(!isAppAdmin()) throw new Error(`Team(s) not found: ${add.join(', ')}. Only App Admin can create teams.`);
  const {error}=await supabaseClient.from('teams').insert(add.map(code=>({code,name:code})));
  if(error) throw new Error(`Unable to create team(s) ${add.join(', ')}: ${error.message}`);
  await window.loadTeamsTable?.();
  window.__seenTeams=[...(window.__seenTeams||[]),...add];
  return add;
}
/* write users row + memberships. `ms` = full desired list; `scopeTeams` = teams this session may touch (null = all) */
async function persistUser(existing,fields,ms,scopeTeams){
  if(!MT.ok) throw new Error('Table public.user_team_roles does not exist yet. Run the SQL migration first.');
  const primary=ms.find(m=>m.primary)||ms[0]||null;
  const payload={name:fields.name,password:fields.password,status:fields.status,
    role:fields.appAdmin?'Admin':(primary?primary.role:'Member'),
    team:fields.appAdmin?null:(primary?primary.team:null)};
  const id=Number(existing?.id);
  const res=(Number.isSafeInteger(id)&&id>0)
    ?await supabaseClient.from('users').update(payload).eq('id',id).select('*').single()
    :await supabaseClient.from('users').insert(payload).select('*').single();
  if(res.error) throw res.error;
  const uid=res.data.id;
  // remove access that was dropped (only inside the teams this session controls)
  const cur=MT.rows.filter(r=>String(r.user_id)===String(uid));
  const keep=new Set(ms.map(m=>N(m.team)));
  const drop=cur.filter(r=>!keep.has(N(r.team))&&(!scopeTeams||scopeTeams.some(t=>N(t)===N(r.team)))).map(r=>r.id);
  if(drop.length){const d=await supabaseClient.from(TBL).delete().in('id',drop);if(d.error)throw d.error;}
  if(ms.length){
    const up=await supabaseClient.from(TBL).upsert(ms.map(m=>({user_id:uid,team:m.team,role:m.role,is_primary:!!(primary&&N(primary.team)===N(m.team))})),{onConflict:'user_id,team'});
    if(up.error) throw up.error;
  }
  return res.data;
}

$('mtrUserForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('mtrSaveBtn'); if(btn.disabled) return;
  const u=MT.edit, admin=isAppAdmin();
  const name=$('mtrName').value.trim(), password=$('mtrPassword').value, status=$('mtrStatus').value;
  const appAdmin=admin?$('mtrIsAppAdmin').checked:(u?.role==='Admin');
  if(!name||!password) return showAppNotification('Member and Password are required.','Validation');
  if(baseUsers().some(x=>N(x.name)===N(name)&&String(x.id)!==String(u?.id))) return showAppNotification(`Member "${name}" already exists. Edit that user to add more team access.`,'Validation');
  const {list,errs,newTeams}=readAccessRows();
  if(errs.length) return showAppNotification(errs.join('\n'),'Validation');
  if(!appAdmin&&!list.length) return showAppNotification('Add at least one team access.','Validation');
  if(u&&currentUser&&String(u.id)===String(currentUser.id)&&admin&&!appAdmin&&!(await showAppConfirm('You are removing App Admin from your own account. Continue?','Confirm'))) return;
  btn.disabled=true;
  try{
    await ensureTeams(newTeams);
    const ms=list.map(({team,role,primary})=>({team,role,primary}));
    await persistUser(u,{name,password,status,appAdmin},ms,admin?null:manageableTeams());
    mtrCloseUser();
    await window.fetchAllDataFromSheet({background:false,forceRender:true});
    render();
    showAppNotification(u?'User updated successfully.':'User created successfully.');
  }catch(err){
    console.error('Save user error:',err);
    showAppNotification(`Unable to save user. ${err?.message||''}`,'Database Error');
  }finally{btn.disabled=false;}
});
window.saveUser=function(e){e?.preventDefault?.();};
try{saveUser=window.saveUser;}catch(_){}

window.mtrDeleteUser=async function(id){
  const u=baseUsers().find(x=>String(x.id)===String(id)); if(!u) return;
  if(!userEditable(u)) return showAppNotification('You cannot delete this account.','Permission denied');
  if(currentUser&&String(currentUser.id)===String(u.id)) return showAppNotification('You cannot delete your own account.','Permission denied');
  try{
    if(isAppAdmin()){
      if(!(await showAppConfirm(`Delete user "${u.name}" and all of their team access?`,'Delete User'))) return;
      if(MT.ok){const d=await supabaseClient.from(TBL).delete().eq('user_id',u.id);if(d.error)throw d.error;}
      const {error}=await supabaseClient.from('users').delete().eq('id',u.id); if(error) throw error;
    }else{
      const ms=membershipsOf(u), mine=ms.filter(m=>canManageTeam(m.team)&&m.role!=='Team Admin'), rest=ms.filter(m=>!mine.includes(m));
      if(!(await showAppConfirm(`Remove "${u.name}" from: ${mine.map(m=>m.team).join(', ')}?${rest.length?'':' The account has no other team and will be deleted.'}`,'Remove access'))) return;
      if(!rest.length){
        if(MT.ok){const d=await supabaseClient.from(TBL).delete().eq('user_id',u.id);if(d.error)throw d.error;}
        const {error}=await supabaseClient.from('users').delete().eq('id',u.id); if(error) throw error;
      }else{
        if(!rest.some(m=>m.primary)) rest[0].primary=true;
        await persistUser(u,{name:u.name,password:u.password,status:u.status,appAdmin:false},rest,manageableTeams());
      }
    }
    await window.fetchAllDataFromSheet({background:false,forceRender:true});
    render();
    showAppNotification('Done.');
  }catch(err){
    console.error('Delete user error:',err);
    showAppNotification(`Unable to delete. ${err?.message||''}`,'Database Error');
  }
};
window.deleteUser=function(idx){const u=(Array.isArray(users)?users:[])[idx];if(u)mtrDeleteUser(u.id);};
try{deleteUser=window.deleteUser;}catch(_){}

/* ---------------- IMPORT (App Admin only) ----------------
   Columns: Member | Team | Main/Sub | Role   (optional: Password, Status)
   - Same Member on several rows  -> ONE account with several team accesses.
   - Existing Member              -> access is added / role updated; other teams are kept.
   - Missing Team                 -> created automatically (after confirmation).
   - Role "App Admin"             -> account becomes App Admin (Team may be blank).
------------------------------------------------------------ */
async function handleImport(e){
  const input=e.target, file=input.files?.[0]; if(!file) return;
  try{
    if(!isAppAdmin()) throw new Error('Only App Admin can import users.');
    if(!MT.ok) throw new Error('Table public.user_team_roles does not exist yet. Run the SQL migration first.');
    const wb=XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]]; if(!ws) throw new Error('The file has no worksheet.');
    const raw=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
    if(!raw.length) throw new Error('The file is empty.');
    const hk=k=>String(k).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    const errs=[], groups=new Map(), seenPair=new Set();
    raw.forEach((row,i)=>{
      const m={}; Object.keys(row).forEach(k=>m[hk(k)]=row[k]);
      const name=String(m.member??m.membername??m.name??'').trim(), team=String(m.team??'').trim(), role=normRole(m.role);
      const membership=String(m.mainsub??m.membership??m.teamtype??'').trim();
      const pw=String(m.password??'').trim(), st=String(m.status??'').trim();
      const r=i+2;
      if(!name&&!team&&!m.role) return; // blank line
      if(!name){errs.push(`Row ${r}: Member is required.`);return;}
      if(!role){errs.push(`Row ${r}: Role must be Team Admin, Member, Viewer or App Admin.`);return;}
      if(role!=='Admin'&&!team){errs.push(`Row ${r}: Team is required.`);return;}
      if(role!=='Admin'&&!/^(main|sub)$/i.test(membership)){errs.push(`Row ${r}: Main/Sub must be Main or Sub.`);return;}
      if(st&&!['active','inactive'].includes(N(st))) errs.push(`Row ${r}: Status must be Active or Inactive.`);
      if(team){const k=N(name)+'|'+N(team);if(seenPair.has(k))errs.push(`Row ${r}: "${name}" + "${team}" appears twice.`);seenPair.add(k);}
      const g=groups.get(N(name))||{name,password:'',status:'',appAdmin:false,ms:[]};
      if(pw) g.password=pw; if(st) g.status=N(st)==='active'?'Active':'Inactive';
      if(role==='Admin') g.appAdmin=true;
      if(team) g.ms.push({team:canonTeam(team),role:role==='Admin'?'Team Admin':role,primary:/^main$/i.test(membership)});
      groups.set(N(name),g);
    });
    groups.forEach(g=>{if(!g.appAdmin&&g.ms.length&&g.ms.filter(m=>m.primary).length!==1)errs.push(`${g.name}: select exactly one Main team; all others must be Sub.`);});
    if(errs.length) throw new Error(errs.slice(0,15).join('\n')+(errs.length>15?`\n...and ${errs.length-15} more.`:''));
    const known=new Set(knownTeams().map(N));
    const newTeams=[...new Set([...groups.values()].flatMap(g=>g.ms.map(m=>m.team)).filter(t=>!known.has(N(t))))];
    const existing=[...groups.values()].filter(g=>baseUsers().some(u=>N(u.name)===N(g.name)));
    const accessCount=[...groups.values()].reduce((s,g)=>s+g.ms.length,0);
    const msg=`Import ${groups.size} member(s), ${accessCount} team access row(s).\n`+
      `• New accounts: ${groups.size-existing.length} (password = Password column, or the Member name if blank)\n`+
      `• Existing accounts updated: ${existing.length} (access added / role updated, other teams kept)\n`+
      (newTeams.length?`• New team(s) will be created: ${newTeams.join(', ')}`:'• No new team');
    if(!(await showAppConfirm(msg,'Import Users'))) return;
    await ensureTeams(newTeams);
    let done=0; const fails=[];
    for(const g of groups.values()){
      try{
        const u=baseUsers().find(x=>N(x.name)===N(g.name));
        const cur=u?membershipsOf(u):[];
        const merged=cur.map(m=>({...m}));
        const importedMain=g.ms.find(m=>m.primary);if(importedMain)merged.forEach(x=>x.primary=false);
        g.ms.forEach(m=>{const f=merged.find(x=>N(x.team)===N(m.team)); if(f){f.role=m.role;f.primary=!!m.primary;} else merged.push({team:m.team,role:m.role,primary:!!m.primary});});
        if(merged.filter(m=>m.primary).length!==1) throw new Error('Exactly one Main team is required.');
        await persistUser(u,{name:u?.name||g.name,password:g.password||u?.password||g.name,status:g.status||u?.status||'Active',appAdmin:g.appAdmin||u?.role==='Admin'},merged,null);
        done++;
      }catch(err){fails.push(`${g.name}: ${err?.message||err}`);}
    }
    await window.fetchAllDataFromSheet({background:false,forceRender:true});
    render();
    showAppNotification(`${done} member(s) imported.`+(fails.length?`\nFailed:\n${fails.slice(0,10).join('\n')}`:''),fails.length?'Import finished with errors':'Import Complete');
  }catch(err){
    console.error('User import error:',err);
    showAppNotification(err?.message||'User import failed.','Import Error');
  }finally{input.value='';}
}
window.handleUserImport=e=>handleImport(e);

window.mtrDownloadTemplate=function(){
  const ws=XLSX.utils.aoa_to_sheet([['Member','Team','Main/Sub','Role','Password','Status'],
    ['Jenny Nguyen','Pattern','Main','Team Admin','','Active'],['Jenny Nguyen','Cover Drawing','Sub','Team Admin','','Active'],['Jenny Nguyen','Kit','Sub','Team Admin','','Active'],
    ['An Tran','Kit','Main','Member','','Active']]);
  ws['!cols']=[{wch:22},{wch:20},{wch:12},{wch:14},{wch:14},{wch:10}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Users'); XLSX.writeFile(wb,'User_Import_Template.xlsx');
};
window.mtrExportAccess=function(){
  const out=[['Member','Team','Main/Sub','Role','Status']];
  visibleUsers().map(u=>({u,ms:membershipsOf(u)})).filter(x=>passFilters(x.u,x.ms))
    .sort((a,b)=>String(a.u.name).localeCompare(String(b.u.name))).forEach(({u,ms})=>{
      if(u.role==='Admin') out.push([u.name,'','','App Admin',u.status||'']);
      ms.forEach(m=>out.push([u.name,m.team,m.primary?'Main':'Sub',m.role,u.status||'']));
      if(u.role!=='Admin'&&!ms.length) out.push([u.name,'','','',u.status||'']);
    });
  const ws=XLSX.utils.aoa_to_sheet(out); ws['!cols']=[{wch:24},{wch:20},{wch:12},{wch:14},{wch:10}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'User Access'); XLSX.writeFile(wb,'User_Team_Access.xlsx');
};

/* tab hook: always render the new page when Users is opened */
const prevSwitch=window.switchTab;
if(typeof prevSwitch==='function'){
  const w=function(id){
    if(id==='users'&&currentUser&&!canOpenUsersPage()) id='dashboard';
    const r=prevSwitch.call(this,id); if(id==='users') render(); return r;
  };
  window.switchTab=w; try{switchTab=w;}catch(_){}
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{buildUsersPage();ensureSwitchBox();},{once:true});
else {buildUsersPage();ensureSwitchBox();}
})();
