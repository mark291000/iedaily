(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').trim().toLowerCase();
const date=v=>{const x=typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(x)?x:'';};
const today=()=>typeof formatDateLocal==='function'?formatDateLocal(new Date()):new Date().toISOString().slice(0,10);

/* ---------- TO DO: open tasks due today or delayed ---------- */
const todoState={filter:'all',query:''};
function taskDone(t){return !!date(t?.actual||t?.actualDate)||/complete|completed|done|closed/i.test(String(t?.status||''));}
function taskPics(t){const raw=Array.isArray(t?.pics)?t.pics:String(t?.pic||t?.pics||'').split(',');return typeof window.canonicalPersonList==='function'?window.canonicalPersonList(raw):raw.map(x=>String(x).trim()).filter(Boolean);}
function todoItems(){
 const d=today();
 const me=norm(currentUser?.name||currentUser?.displayName||currentUser?.username||'');
 if(!me||(typeof isHiddenMember==='function'&&isHiddenMember(currentUser?.name||currentUser?.displayName||currentUser?.username||'')))return [];
 return (Array.isArray(window.dailyTasks)?window.dailyTasks:(typeof dailyTasks!=='undefined'?dailyTasks:[])).filter(t=>{
  const plan=date(t?.plan||t?.planDate);
  const assignedToMe=taskPics(t).some(p=>norm(p)===me);
  return assignedToMe&&!taskDone(t)&&!!plan&&plan<=d;
 }).map(t=>{const plan=date(t.plan||t.planDate);const days=Math.max(0,Math.round((new Date(d+'T00:00:00')-new Date(plan+'T00:00:00'))/86400000));return {t,plan,days,kind:plan===d?'today':'overdue'};})
 .sort((a,b)=>b.days-a.days||({High:0,Medium:1,Low:2}[a.t.priority]??3)-({High:0,Medium:1,Low:2}[b.t.priority]??3)||a.plan.localeCompare(b.plan));
}
function renderTodo(){
 const body=$('todoTableBody');if(!body)return;
 const list=todoItems();
 const badge=$('todoNavBadge');if(badge){badge.textContent=list.length>99?'99+':String(list.length);badge.classList.toggle('hidden',!list.length);badge.classList.toggle('flex',!!list.length);}
 if(!list.length){body.innerHTML='<tr class="todo-empty"><td colspan="9"><i class="fa-regular fa-circle-check"></i><b>Nothing needs action.</b><div>Your assigned tasks will appear here when their planned date is today or overdue.</div></td></tr>';return;}
 body.innerHTML=list.map(({t,plan,days,kind})=>{const id=encodeURIComponent(String(t.id??''));const pics=taskPics(t).join(', ');const delay=kind==='today'?'Due today':`${days} day${days===1?'':'s'}`;return `<tr><td><span class="todo-pill ${kind}"><i class="fa-solid ${kind==='today'?'fa-clock':'fa-triangle-exclamation'}"></i>${kind==='today'?'TODAY':'DELAYED'}</span></td><td><div class="todo-task-name">${esc(t.name||'Unnamed task')}</div><small>${esc(t.category||'')}</small></td><td class="todo-detail">${esc(t.items||'-')}</td><td class="todo-owner">${esc(pics||'-')}</td><td>${esc(plan)}</td><td class="todo-delay" style="color:${kind==='today'?'#b45309':'#b91c1c'}">${esc(delay)}</td><td>${esc(t.priority||'-')}</td><td>${Number(t.usageTime||0).toLocaleString(undefined,{maximumFractionDigits:1})}h</td><td><button type="button" class="todo-open" data-todo-id="${id}" title="Open task"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></td></tr>`;}).join('');
}
window.renderTodo=renderTodo;
function bindTodo(){
 document.querySelectorAll('[data-todo-filter]').forEach(b=>b.addEventListener('click',()=>{todoState.filter=b.dataset.todoFilter;document.querySelectorAll('[data-todo-filter]').forEach(x=>x.classList.toggle('is-active',x===b));renderTodo();}));
 $('todoSearch')?.addEventListener('input',e=>{todoState.query=e.target.value;renderTodo();});
 $('todoTableBody')?.addEventListener('click',e=>{const b=e.target.closest('[data-todo-id]');if(!b)return;const id=decodeURIComponent(b.dataset.todoId||'');if(typeof editDailyTask==='function')editDailyTask(id);});
}

/* ---------- Project summary ---------- */
function projectStatus(p){try{return typeof calculateProjectOverallStatus==='function'?calculateProjectOverallStatus(p):String(p?.status||'');}catch(_){return String(p?.status||'');}}
function updateProjectModernSummary(){
 const list=Array.isArray(window.projectsList)?window.projectsList:(typeof projectsList!=='undefined'?projectsList:[]);if(!$('pmSumTotal'))return;
 const statuses=list.map(projectStatus),done=statuses.filter(x=>/complete|done|closed/i.test(x)).length,risk=statuses.filter(x=>/risk|overdue|stuck|block|delay/i.test(x)).length;
 const tasks=list.reduce((n,p)=>n+(p.tasks||[]).length+(p.phases||[]).reduce((m,ph)=>m+(ph.tasks||[]).length,0),0);
 $('pmSumTotal').textContent=list.length.toLocaleString();$('pmSumDone').textContent=done.toLocaleString();$('pmSumRisk').textContent=risk.toLocaleString();$('pmSumActive').textContent=Math.max(0,list.length-done).toLocaleString();$('pmSumTasks').textContent=tasks.toLocaleString();
}
window.updateProjectModernSummary=updateProjectModernSummary;

/* ---------- Overall: dedicated all-team lazy data ---------- */
window.__overallV7Active=true;
const ov={year:new Date().getFullYear(),month:'',week:'',team:'',cache:new Map(),charts:{},loading:null,loadingKey:''};
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function jsDate(v){const s=date(v);if(!s)return null;const d=new Date(s+'T00:00:00');return Number.isNaN(d.getTime())?null:d;}
function mondayOf(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/864e5+1)/7);}
function workdays(s,e){if(!s||!e||s>e)return 0;let n=0;for(const d=new Date(s);d<=e;d.setDate(d.getDate()+1)){const k=d.getDay();if(k&&k!==6)n++;}return n;}
function weeksOf(y,m){const s=m===''?new Date(y,0,1):new Date(y,+m,1),e=m===''?new Date(y,11,31):new Date(y,+m+1,0),out=[];for(let a=mondayOf(s);a<=e;a.setDate(a.getDate()+7)){const b=new Date(a);b.setDate(a.getDate()+6);out.push({s:new Date(a),e:b});}return out;}
function period(){if(ov.week!==''){const w=weeksOf(ov.year,ov.month)[+ov.week];if(w){const e=new Date(w.e);e.setHours(23,59,59);return {s:w.s,e,mode:'week',wd:workdays(w.s,w.e)};}}if(ov.month!==''){const s=new Date(ov.year,+ov.month,1),e=new Date(ov.year,+ov.month+1,0,23,59,59);return {s,e,mode:'month',wd:workdays(s,e)};}const s=new Date(ov.year,0,1),e=new Date(ov.year,11,31,23,59,59);return {s,e,mode:'year',wd:workdays(s,e)};}
function overlap(a,b,p){const s=jsDate(a),e=jsDate(b)||s;return !!s&&s<=p.e&&e>=p.s;}
function teamOf(x){return String(x?.team||'').trim()||'Unassigned';}
async function paged(table,configure){const out=[];for(let from=0;;from+=1000){let q=supabaseClient.from(table).select('*');if(configure)q=configure(q);const r=await q.order('id',{ascending:true}).range(from,from+999);if(r.error)throw r.error;out.push(...(r.data||[]));if(!r.data||r.data.length<1000)break;}return out;}
async function loadOverallAllTeams(force=false){
 if(!supabaseClient&&typeof initSupabaseClient==='function')initSupabaseClient();if(!supabaseClient)return null;const key=String(ov.year),cached=ov.cache.get(key);if(!force&&cached&&Date.now()-cached.at<300000)return cached.data;
 if(ov.loading){const runningKey=ov.loadingKey;const running=await ov.loading;if(runningKey===key)return running;return loadOverallAllTeams(force);}
 ov.loadingKey=key;const status=$('ovLoadState');if(status){status.classList.remove('hidden');status.innerHTML='<i class="fa-solid fa-arrows-rotate"></i> Loading all teams…';}
 ov.loading=(async()=>{const start=`${ov.year}-01-01`,end=`${ov.year}-12-31`;const [ur,tr,rr,pr,mr]=await Promise.all([
   paged(SUPABASE_TABLES.Users),
   paged(SUPABASE_TABLES.Tasks,q=>q.or(`and(start_date.lte.${end},plan_date.gte.${start}),and(start_date.gte.${start},start_date.lte.${end}),and(plan_date.gte.${start},plan_date.lte.${end}),and(actual_date.gte.${start},actual_date.lte.${end})`)),
   paged(SUPABASE_TABLES.TimeOff_OT,q=>q.lte('start_date',end)),
   paged(SUPABASE_TABLES.Projects),
   (async()=>{try{const r=await supabaseClient.from('user_team_roles').select('id,user_id,team,role,is_primary').order('id',{ascending:true});return r.error?[]:(r.data||[]);}catch(_){return [];}})()
  ]);
  const baseUsers=ur.map(mapDbUserToApp);
  const membershipsByUser=new Map();
  mr.forEach(m=>{const id=String(m.user_id),team=String(m.team||'').trim();if(!team)return;const list=membershipsByUser.get(id)||[];list.push({...m,team});membershipsByUser.set(id,list);});
  const mainByUser=new Map();
  const headcountUsers=baseUsers.flatMap(user=>{
     const memberships=membershipsByUser.get(String(user.id))||[];
     const main=memberships.find(m=>m.is_primary===true)||memberships.find(m=>norm(m.team)===norm(user.team))||(memberships.length?memberships[0]:null);
     const fallbackTeam=String(user.team||'').trim();
     const mainTeam=String(main?.team||fallbackTeam).trim();
     if(!mainTeam)return []; /* App Admins and hidden (report:false) users are counted in headcount */
     mainByUser.set(norm(user.name||user.username||user.displayName||''),norm(mainTeam));
     return [{...user,team:mainTeam,role:main?.role||user.role,mainTeam}];
   });
  const knownNames=new Set(baseUsers.map(u=>norm(u.name||u.username||u.displayName||'')).filter(Boolean));
  const allowed=(name,team)=>{const person=norm(name);return !person||!knownNames.has(person)||(mainByUser.has(person)&&mainByUser.get(person)===norm(team));};
  const mappedTasks=tr.map(mapDbTaskToApp).map(task=>{const raw=taskPics(task),pics=raw.filter(name=>allowed(name,task.team));if(raw.length&&!pics.length)return null;return {...task,pics,pic:pics.join(', ')};}).filter(Boolean);
  const mappedRequests=rr.map(mapDbTimeoffToApp).filter(item=>allowed(item?.pic||item?.member||item?.name||'',item?.team));
  const mappedProjects=pr.map(mapDbProjectToApp).map(project=>{const raw=Array.isArray(project?.owners)?project.owners:String(project?.owner||'').split(',');const owners=raw.map(v=>String(v).trim()).filter(Boolean).filter(name=>allowed(name,project.team));return {...project,owners,owner:owners.join(', ')};});
  const data={users:headcountUsers,tasks:mappedTasks,requests:mappedRequests,projects:mappedProjects};ov.cache.set(key,{at:Date.now(),data});return data;
 })().catch(e=>{console.error('Overall all-team load failed',e);throw e;}).finally(()=>{ov.loading=null;ov.loadingKey='';if(status)status.classList.add('hidden');});
 return ov.loading;
}
function overallChartHost(id){
 let host=document.querySelector(`[data-overall-chart="${id}"]`);
 if(host)return host;
 const node=$(id);if(!node)return null;
 host=node.parentElement;host.dataset.overallChart=id;host.innerHTML='';return host;
}
function chartColor(source,index,fallback){if(Array.isArray(source))return source[index%source.length]||fallback;return source||fallback;}
function chart(id,cfg){
 const host=overallChartHost(id);if(!host)return;
 const labels=Array.isArray(cfg?.data?.labels)?cfg.data.labels:[];
 const sets=Array.isArray(cfg?.data?.datasets)?cfg.data.datasets:[];
 const num=v=>Number.isFinite(Number(v))?Number(v):0;
 if(!labels.length||!sets.length){host.innerHTML='<div class="ov-viz-empty">No data for this period</div>';return;}
  if(cfg.type==='column'){
   const values=(sets[0]?.data||[]).map(num),colors=sets[0]?.backgroundColor,total=values.reduce((a,b)=>a+b,0),max=Math.max(1,...values);
  host.innerHTML=`<div class="ov-column-summary">Total <b>${total.toLocaleString(undefined,{maximumFractionDigits:1})} h</b></div><div class="ov-column-scroll"><div class="ov-column-chart" style="--columns:${Math.max(1,labels.length)}">${labels.map((l,i)=>{const v=values[i]||0;const height=Math.max(v?3:0,Math.min(100,v/max*100));return `<div class="ov-column-item" title="${esc(l)}: ${v.toLocaleString(undefined,{maximumFractionDigits:1})} h"><b>${v.toLocaleString(undefined,{maximumFractionDigits:1})}</b><div><i style="height:${height}%;background:${chartColor(colors,i,'#f59e0b')}"></i></div><span>${esc(l)}</span></div>`;}).join('')}</div></div>`;
  return;
 }
 if(cfg.type==='doughnut'){
  const values=(sets[0].data||[]).map(num),total=values.reduce((a,b)=>a+b,0),colors=sets[0].backgroundColor||[];
  let run=0;const stops=values.map((v,i)=>{const a=total?run/total*360:0;run+=v;const b=total?run/total*360:0;return `${chartColor(colors,i,'#94a3b8')} ${a}deg ${b}deg`;});
  const gradient=total?`conic-gradient(${stops.join(',')})`:'conic-gradient(#e2e8f0 0 360deg)';
  host.innerHTML=`<div class="ov-donut-wrap"><div class="ov-donut" style="background:${gradient}"><span><b>${total.toLocaleString()}</b><small>projects</small></span></div><div class="ov-donut-legend">${labels.map((l,i)=>`<div><i style="background:${chartColor(colors,i,'#94a3b8')}"></i><span>${esc(l)}</span><b>${num(values[i]).toLocaleString()}</b></div>`).join('')}</div></div>`;return;
 }
 const max=Math.max(1,...sets.flatMap(s=>(s.data||[]).map(num)));
 if(sets.length===1){
  const data=sets[0].data||[],colors=sets[0].backgroundColor,percent=id==='ovC2',hours=id==='ovC3';
  host.innerHTML=`<div class="ov-hbar-list">${labels.map((l,i)=>{const v=num(data[i]);const width=percent?Math.max(v?2:0,Math.min(100,v)):Math.max(v?2:0,Math.min(100,v/max*100));return `<div class="ov-hbar-row" title="${esc(l)}: ${v.toLocaleString(undefined,{maximumFractionDigits:1})}${percent?'%':hours?' h':''}"><span title="${esc(l)}">${esc(l)}</span><div role="meter" aria-valuemin="0" aria-valuemax="${percent?'100':max}" aria-valuenow="${v}"><i style="width:${width}%;background:${chartColor(colors,i,'#4f46e5')}"></i></div><b>${v.toLocaleString(undefined,{maximumFractionDigits:1})}${percent?'%':hours?' h':''}</b></div>`;}).join('')}</div>`;return;
 }
 host.innerHTML=`<div class="ov-series-legend">${sets.map((s,i)=>`<span><i style="background:${chartColor(s.backgroundColor,0,i?'#8b5cf6':'#f59e0b')}"></i>${esc(s.label||'Series '+(i+1))}</span>`).join('')}</div><div class="ov-series-list">${labels.map((l,i)=>`<div class="ov-series-row"><span>${esc(l)}</span><div>${sets.map((s,j)=>{const v=num((s.data||[])[i]);return `<em title="${esc(s.label||'')}: ${v.toLocaleString(undefined,{maximumFractionDigits:1})} h"><i style="width:${Math.max(v?2:0,Math.min(100,v/max*100))}%;background:${chartColor(s.backgroundColor,i,j?'#8b5cf6':'#f59e0b')}"></i></em>`;}).join('')}</div><b>${sets.map(s=>num((s.data||[])[i]).toLocaleString(undefined,{maximumFractionDigits:1})).join(' / ')}</b></div>`).join('')}</div>`;
}
const axis=(suffix='')=>({x:{grid:{display:false},ticks:{font:{size:10},autoSkip:true,maxRotation:32}},y:{beginAtZero:true,grid:{color:'#edf2f7'},ticks:{font:{size:10},callback:v=>v+suffix}}});
function requestHours(o,p){const s=jsDate(o.startDate),e=jsDate(o.endDate)||s;if(!s)return 0;const a=new Date(Math.max(s,p.s)),b=new Date(Math.min(e,p.e));const inside=workdays(a,b),total=Math.max(1,workdays(s,e)),h=Number(o.hours);return (Number.isFinite(h)&&h>0?h:total*8)*inside/total;}
const isOT=o=>/overtime|over time|\bot\b/i.test(o?.type||''),isOff=o=>!isOT(o)&&/off|leave|vacation|absen/i.test(o?.type||'');
function overallProjectProgress(x,today=new Date()){const start=jsDate(x?.startDate),plan=jsDate(x?.dueDate),actual=jsDate(x?.actualDate);if(/complete|done|closed/i.test(String(x?.status||''))||actual)return 100;if(!start||!plan||plan<start)return 0;const now=new Date(today);now.setHours(0,0,0,0);if(now<=start)return 0;if(now>=plan)return 100;return Math.max(0,Math.min(100,Math.round((now-start)/Math.max(1,plan-start)*100)));}
function projectHealth(x,now){const progress=overallProjectProgress(x,now);if(progress>=100)return 'Completed';const due=jsDate(x?.dueDate);if(/hold|block|overdue|delay|stuck/i.test(x?.status||'')||(due&&due<now))return 'At risk';if(due&&(due-now)<14*864e5&&progress<70)return 'Watch';return 'On track';}
function renderOverallV7(data){
 const tab=$('tab-overall');if(!tab||tab.classList.contains('hidden')||!data)return;
 try{
  const p=period(),now=new Date();now.setHours(0,0,0,0);
  const hiddenNames=new Set((data.users||[]).filter(u=>u?.show===false).map(u=>norm(u.name||u.username||u.displayName||'')).filter(Boolean));
  /* Headcount and member visibility use Main team + Show = Yes only. Sub access is management-only. */
  const allUsers=(data.users||[]).filter(u=>norm(u.status||'Active')==='active'&&norm(u.role)!=='viewer');
  /* report:false users (e.g. Anny) count in headcount only - never in workload / capacity */
  const workloadUsers=allUsers.filter(u=>u.show!==false);
  const tasks=(data.tasks||[]).map(t=>{const rawPics=taskPics(t),pics=rawPics.filter(name=>!hiddenNames.has(norm(name)));return {...t,pics,__hadAssignedPIC:rawPics.length>0};}).filter(t=>!t.__hadAssignedPIC||t.pics.length>0);
  const req=(data.requests||[]).filter(x=>!hiddenNames.has(norm(x?.pic||x?.member||x?.name||''))),projects=data.projects||[];
  const teams=[...new Set([...allUsers,...tasks,...req,...projects].map(teamOf).filter(x=>x!=='Unassigned'))].sort((a,b)=>a.localeCompare(b));tab.style.setProperty('--ov-team-count',String(Math.max(1,teams.length)));
  const teamSel=$('ovTeam');
  teamSel.innerHTML='<option value="">All teams</option>'+teams.map(x=>`<option value="${esc(x)}" ${x===ov.team?'selected':''}>${esc(x)}</option>`).join('');
  const inTeam=x=>!ov.team||teamOf(x)===ov.team;
  const u=allUsers.filter(inTeam),wu=workloadUsers.filter(inTeam),t=tasks.filter(inTeam),r=req.filter(inTeam),pr=projects.filter(inTeam);
  const tp=t.filter(x=>overlap(x.start||x.plan,x.actual||x.plan||x.start,p));
  const tpAll=tasks.filter(x=>overlap(x.start||x.plan,x.actual||x.plan||x.start,p));
  /* Charts and Team scorecard always use the complete all-team set. */
  const selectedTeams=teams;
  const rows=selectedTeams.map(tm=>{
   const uu=allUsers.filter(x=>teamOf(x)===tm),wuu=workloadUsers.filter(x=>teamOf(x)===tm),tt=tpAll.filter(x=>teamOf(x)===tm),rr=req.filter(x=>teamOf(x)===tm&&overlap(x.startDate,x.endDate,p)),pp=projects.filter(x=>teamOf(x)===tm);
   const h=tt.reduce((sum,x)=>sum+(Number(x.usageTime)||0),0);
   const c=wuu.length*p.wd*8,util=c?h/c*100:0,ot=rr.filter(isOT).reduce((a,x)=>a+requestHours(x,p),0);
   const open=tt.filter(x=>!taskDone(x)).length,overdue=tt.filter(x=>!taskDone(x)&&jsDate(x.plan)&&jsDate(x.plan)<now).length,risk=pp.filter(x=>projectHealth(x,now)==='At risk').length;
   let level='g',label='On track',action='Maintain cadence';
   if(overdue>5||risk||util>110){level='r';label='Action';action=risk?`Escalate ${risk} project(s)`:overdue>5?`Recover ${overdue} delayed task(s)`:'Rebalance workload';}
   else if(overdue||util>95||(wuu.length&&util<50)){level='a';label='Monitor';action=overdue?`Close ${overdue} delayed`:util>95?'Hold new demand':'Check allocation';}
   return {tm,hc:uu.length,workloadHc:wuu.length,h,c,util,ot,open,overdue,risk,level,label,action};
  });
  const summaryRows=ov.team?rows.filter(x=>x.tm===ov.team):rows;
  const sum=k=>summaryRows.reduce((n,x)=>n+(Number(x[k])||0),0),HC=sum('hc'),H=sum('h'),C=sum('c'),UT=C?H/C*100:0,OT=sum('ot'),OD=sum('overdue'),OPEN=sum('open');
  const health=pr.map(x=>projectHealth(x,now)),active=health.filter(x=>x!=='Completed').length,risk=health.filter(x=>x==='At risk').length;
  const weekText=p.mode==='week'?`Week ${isoWeek(p.s)} (${date(p.s)} → ${date(p.e)})`:p.mode==='month'?`${months[+ov.month]} ${ov.year}`:`Year ${ov.year}`;
   $('ovScope').textContent=`${ov.team||'All teams'} · ${weekText} · ${p.wd} working days`;
  const fmt=(v,d=0)=>Number(v||0).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
  const K=[
    ['Headcount',fmt(HC),`${selectedTeams.length} teams`,'#4f46e5'],
    ['Utilization',fmt(UT)+'%',`${fmt(H)} / ${fmt(C)} h`,UT>110?'#dc2626':UT>95?'#d97706':'#059669'],
   ['Overtime',fmt(OT,1)+'h',`${HC?fmt(OT/HC,1):0} h / person`,'#d97706'],
   ['Open tasks',fmt(OPEN),`${tp.length} tasks in period`,'#0891b2'],
   ['Overdue',fmt(OD),'open past plan date',OD?'#dc2626':'#059669'],
   ['Active projects',fmt(active),`${pr.length} total`,'#0f766e'],
   ['Projects at risk',fmt(risk),`${health.filter(x=>x==='Watch').length} on watch`,risk?'#dc2626':'#059669']
  ];
  $('ovKpis').innerHTML=K.map(k=>`<div class="ov-k" style="--c:${k[3]}"><span>${k[0]}</span><b style="color:${k[3]}">${k[1]}</b><i>${k[2]}</i></div>`).join('');
  const pal=['#4f46e5','#0891b2','#059669','#7c3aed','#d97706','#db2777','#475569','#0f766e'];
  const headcountRows=rows.slice().sort((a,b)=>b.hc-a.hc||a.tm.localeCompare(b.tm));
  const utilizationRows=rows.slice().sort((a,b)=>a.util-b.util||a.tm.localeCompare(b.tm));
  const overtimeRows=rows.slice().sort((a,b)=>b.ot-a.ot||a.tm.localeCompare(b.tm));
  chart('ovC1',{type:'bar',data:{labels:headcountRows.map(x=>x.tm),datasets:[{data:headcountRows.map(x=>x.hc),backgroundColor:headcountRows.map((_,i)=>pal[i%pal.length])}]}});
  chart('ovC2',{type:'bar',data:{labels:utilizationRows.map(x=>x.tm),datasets:[{data:utilizationRows.map(x=>+x.util.toFixed(1)),backgroundColor:utilizationRows.map(x=>x.util>110?'#dc2626':x.util>95?'#d97706':x.util<50?'#94a3b8':'#059669')}]}});
  $('ovC3s').textContent=`total ${fmt(OT,1)} h`;
  chart('ovC3',{type:'bar',data:{labels:overtimeRows.map(x=>x.tm),datasets:[{label:'Overtime',data:overtimeRows.map(x=>+x.ot.toFixed(1)),backgroundColor:overtimeRows.map((_,i)=>['#f59e0b','#fb923c','#f97316','#ea580c'][i%4])}]}});
  const hs=['On track','Watch','At risk','Completed'];
  chart('ovC4',{type:'doughnut',data:{labels:hs,datasets:[{data:hs.map(h=>health.filter(x=>x===h).length),backgroundColor:['#059669','#f59e0b','#dc2626','#4f46e5']}]}});
  const order={r:0,a:1,g:2};
  $('ovTeamBody').innerHTML=rows.length?rows.slice().sort((a,b)=>order[a.level]-order[b.level]||b.overdue-a.overdue).map(x=>{
   const c=x.util>110?'#dc2626':x.util>95?'#d97706':x.util<50?'#94a3b8':'#059669';
   return `<tr><td><b>${esc(x.tm)}</b></td><td class="num" title="${fmt(x.workloadHc)} member(s) included in workload">${fmt(x.hc)}</td><td class="num"><div style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:118px"><div class="ov-bar" style="flex:0 1 78px"><div style="width:${Math.min(100,x.util)}%;background:${c}"></div></div><b style="color:${c};min-width:36px;text-align:right">${fmt(x.util)}%</b></div></td><td class="num">${fmt(x.ot,1)}</td><td class="num" style="${x.overdue?'color:#dc2626;font-weight:800':''}">${fmt(x.overdue)}</td><td class="num" style="${x.risk?'color:#dc2626;font-weight:800':''}">${fmt(x.risk)}</td><td><span class="ov-b ${x.level}">${x.label}</span></td><td>${esc(x.action)}</td></tr>`;
  }).join(''):'<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">No records for this period.</td></tr>';

  const delayedTasks=tp.filter(x=>!taskDone(x)&&jsDate(x.plan)&&jsDate(x.plan)<now).sort((a,b)=>String(a.plan||'').localeCompare(String(b.plan||'')));
  const riskyProjects=pr.filter(x=>projectHealth(x,now)==='At risk').sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||'')));
  const decisionRows=rows.filter(x=>(x.workloadHc&&x.util>110)||(x.workloadHc&&x.util<50)||x.overdue||x.risk).sort((a,b)=>order[a.level]-order[b.level]||b.util-a.util);
  const owners=x=>{const a=Array.isArray(x?.owners)?x.owners:taskPics(x).length?taskPics(x):String(x?.owner||x?.pic||'').split(',');return a.map(v=>String(v).trim()).filter(Boolean).join(', ')||'Unassigned';};
  const riskColumn=(title,tone,items,empty)=>`<section class="ov-risk-column ${tone}"><header><span>${esc(title)}</span><b>${items.length}</b></header><div class="ov-risk-list">${items.length?items.join(''):`<div class="ov-risk-empty"><i class="fa-regular fa-circle-check"></i>${esc(empty)}</div>`}</div></section>`;
  const taskItems=delayedTasks.map(x=>{const plan=jsDate(x.plan),days=plan?Math.max(1,Math.floor((now-plan)/864e5)):0;return `<article class="ov-risk-item"><strong>${esc(x.name||x.task||'Unnamed task')}</strong><div><b>PIC:</b> ${esc(owners(x))}</div><div><b>Team:</b> ${esc(teamOf(x))}</div><small>Plan ${esc(date(x.plan))} · ${days} day${days===1?'':'s'} delayed</small></article>`;});
  const projectItems=riskyProjects.map(x=>`<article class="ov-risk-item"><strong>${esc(x.name||'Unnamed project')}</strong><div><b>Owner:</b> ${esc(owners(x))}</div><div><b>Team:</b> ${esc(teamOf(x))}</div><small>${esc(x.status||projectHealth(x,now))}${x.dueDate?` · Due ${esc(date(x.dueDate))}`:''}</small></article>`);
  const decisionItems=decisionRows.map(x=>`<article class="ov-risk-item"><strong>${esc(x.tm)}</strong><div><b>Utilization:</b> ${fmt(x.util)}% · <b>Workload HC:</b> ${fmt(x.workloadHc)}/${fmt(x.hc)}</div><div><b>Decision:</b> ${esc(x.action)}</div><small>${x.overdue?`${fmt(x.overdue)} overdue task(s) · `:''}${x.risk?`${fmt(x.risk)} at-risk project(s) · `:''}${fmt(x.ot,1)} OT h</small></article>`);
  $('ovRisks').innerHTML=`<div class="ov-risk-columns">${riskColumn('Delayed tasks','danger',taskItems,'No delayed task')}${riskColumn('Projects at risk','warning',projectItems,'No project at risk')}${riskColumn('Capacity & decisions','info',decisionItems,'No capacity decision required')}</div>`;

   /* Project portfolio: the same all-team Project Management source used by the IE Overall KPIs. */
   const projectOwners=x=>{const list=Array.isArray(x?.owners)&&x.owners.length?x.owners:String(x?.owner||'').split(',');return list.map(v=>String(v).trim()).filter(Boolean).join(', ')||'Unassigned';};
   const childTasks=x=>[...(Array.isArray(x?.phases)?x.phases:[]).flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]),...(Array.isArray(x?.tasks)?x.tasks:[])];
   const projectStatus=x=>String(x?.status||projectHealth(x,now)||'Not Started');
   const projectStage=x=>String(x?.currentStage??x?.stage??'').trim()||'-';
   const projectProgress=x=>overallProjectProgress(x,now);
   const projectTotals=x=>{if(!childTasks(x).length)return {gainDemand:x?.gainDemand,saving:x?.saving,actualSaving:x?.actualSaving};try{if(typeof projectAggregateSummary==='function')return projectAggregateSummary(x)||{};}catch(_){}return {gainDemand:x?.gainDemand,saving:x?.saving,actualSaving:x?.actualSaving};};
   const projectGoal=x=>{const value=x?.archivedGoal??x?.detailedStatus??x?.achievedGoal??x?.archiveGoal??'';return String(value??'').trim()||'-';};
   const projectSaving=x=>{const totals=projectTotals(x),actual=Number(totals.actualSaving??x?.actualSaving),estimated=Number(totals.saving??x?.saving),value=Number.isFinite(actual)&&actual!==0?actual:(Number.isFinite(estimated)&&estimated!==0?estimated:0);return value?`$${value.toLocaleString(undefined,{maximumFractionDigits:0})}`:'-';};
   const projectDate=v=>{try{return typeof formatDateMMDDYYYY==='function'?(formatDateMMDDYYYY(v)||'-'):(date(v)||'-');}catch(_){return date(v)||'-';}};
   const statusTone=v=>/complete|done|closed/i.test(v)?'completed':/overdue|delay|stuck|block|risk/i.test(v)?'risk':/working|progress|process/i.test(v)?'working':'neutral';
   const projectRows=pr.filter(x=>x?.keyProject!==false&&!/^no$/i.test(String(x?.keyProject??''))).slice().sort((a,b)=>teamOf(a).localeCompare(teamOf(b))||String(a?.name||'').localeCompare(String(b?.name||'')));
   const projectBody=$('ovProjectBody'),projectCount=$('ovProjectCount');
   if(projectCount)projectCount.textContent=`${projectRows.length} key project${projectRows.length===1?'':'s'} · Project Management data`;
   if(projectBody)projectBody.innerHTML=projectRows.length?projectRows.map(x=>{const status=projectStatus(x),progress=projectProgress(x),tone=statusTone(status),name=x?.name||'Unnamed project',detail=x?.detail||'-';return `<tr><td><b>${esc(teamOf(x))}</b></td><td class="ov-project-name-cell" data-filter-value="${esc(name)}"><strong title="${esc(name)}">${esc(name)}</strong><small title="${esc(detail)}">${esc(detail)}</small></td><td>${esc(projectOwners(x))}</td><td>${esc(projectDate(x?.startDate))}</td><td>${esc(projectDate(x?.dueDate))}</td><td>${esc(projectDate(x?.actualDate))}</td><td><span class="ov-project-status ${tone}">${esc(status)}</span></td><td>${esc(projectStage(x))}</td><td class="num"><div class="ov-progress-cell"><div class="ov-progress-track"><i style="width:${progress}%"></i></div><b>${fmt(progress)}%</b></div></td><td>${esc(projectGoal(x))}</td><td class="num"><b>${esc(projectSaving(x))}</b></td></tr>`;}).join(''):'<tr><td colspan="11" class="ov-project-empty">No project data for the selected team.</td></tr>';
  }catch(e){
  console.error('Overall V9 render failed',e);
  $('ovTeamBody').innerHTML=`<tr><td colspan="8"><div class="ov-error"><b>IE Overall could not render one or more records.</b><br>${esc(e.message||e)}</div></td></tr>`;
 }
}
async function openOverall(force=false){try{const data=await loadOverallAllTeams(force);renderOverallV7(data);}catch(e){const b=$('ovTeamBody');if(b)b.innerHTML=`<tr><td colspan="11"><div class="ov-error"><b>Unable to load all-team data.</b><br>${esc(e.message||e)}</div></td></tr>`;}}
window.renderOverallDashboard=()=>openOverall(false);window.refreshOverallAllTeams=()=>openOverall(true);
function fillOverallControls(){
 const y=$('ovYear'),m=$('ovMonth'),w=$('ovWeek');if(!y||!m||!w)return;const now=new Date().getFullYear(),years=[...new Set([now-1,now,now+1,...(window.__taskYearUniverse||[]).map(Number).filter(Boolean)])].sort();y.innerHTML=years.map(v=>`<option value="${v}" ${v===ov.year?'selected':''}>${v}</option>`).join('');m.innerHTML='<option value="">All</option>'+months.map((x,i)=>`<option value="${i}" ${String(i)===String(ov.month)?'selected':''}>${x}</option>`).join('');w.innerHTML='<option value="">All</option>'+weeksOf(ov.year,ov.month).map((x,i)=>`<option value="${i}" ${String(i)===String(ov.week)?'selected':''}>W${String(isoWeek(x.s)).padStart(2,'0')} · ${x.s.getDate()}/${x.s.getMonth()+1}-${x.e.getDate()}/${x.e.getMonth()+1}</option>`).join('');
}
function bindOverall(){
 const head=$('tab-overall')?.querySelector('.ov-f');if(head&&!$('ovLoadState'))head.insertAdjacentHTML('beforeend','<span id="ovLoadState" class="ov-loading hidden"></span><button type="button" id="ovRefresh" class="ov-btn" title="Refresh all-team data"><i class="fa-solid fa-arrows-rotate"></i></button>');
 /* IE Overall opens on the current reporting week by default. */
 const nowDate=new Date();ov.year=nowDate.getFullYear();ov.month=String(nowDate.getMonth());const currentWeeks=weeksOf(ov.year,ov.month),currentMonday=mondayOf(nowDate).getTime();ov.week=String(Math.max(0,currentWeeks.findIndex(x=>x.s.getTime()===currentMonday)));fillOverallControls();
 $('ovYear')?.addEventListener('change',e=>{ov.year=Number(e.target.value)||new Date().getFullYear();ov.week='';fillOverallControls();openOverall(false);});$('ovMonth')?.addEventListener('change',e=>{ov.month=e.target.value;ov.week='';fillOverallControls();const c=ov.cache.get(String(ov.year));if(c)renderOverallV7(c.data);else openOverall(false);});$('ovWeek')?.addEventListener('change',e=>{ov.week=e.target.value;const c=ov.cache.get(String(ov.year));if(c)renderOverallV7(c.data);});$('ovTeam')?.addEventListener('change',e=>{ov.team=e.target.value;const c=ov.cache.get(String(ov.year));if(c)renderOverallV7(c.data);});$('ovRefresh')?.addEventListener('click',()=>openOverall(true));$('ovNow')?.addEventListener('click',()=>{const d=new Date();ov.year=d.getFullYear();ov.month=String(d.getMonth());const ws=weeksOf(ov.year,ov.month),ms=mondayOf(d).getTime();ov.week=String(Math.max(0,ws.findIndex(x=>x.s.getTime()===ms)));fillOverallControls();openOverall(false);});
}

/* ---------- Page-level rendering; expensive pages render only after navigation ---------- */
function onPage(id){
 if(id==='todo')renderTodo();
 if(id==='projects'){updateProjectModernSummary();requestAnimationFrame(()=>{try{typeof syncProjectBottomScroll==='function'&&syncProjectBottomScroll();}catch(_){}});}
 if(id==='overall')openOverall(false);
}
const priorSwitch=window.switchTab;if(typeof priorSwitch==='function'&&!priorSwitch.__v7){const wrapped=function(id){const r=priorSwitch.apply(this,arguments);onPage(id);return r;};wrapped.__v7=true;window.switchTab=wrapped;try{switchTab=wrapped;}catch(_){}}
const priorProjectRender=window.renderProjectsTable;if(typeof priorProjectRender==='function'&&!priorProjectRender.__v7){const wrapped=function(){const r=priorProjectRender.apply(this,arguments);updateProjectModernSummary();return r;};wrapped.__v7=true;window.renderProjectsTable=wrapped;try{renderProjectsTable=wrapped;}catch(_){}}
const priorFetch=window.fetchAllDataFromSheet;if(typeof priorFetch==='function'&&!priorFetch.__v7){const wrapped=async function(){const r=await priorFetch.apply(this,arguments);renderTodo();updateProjectModernSummary();const active=document.querySelector('.tab-content:not(.hidden)')?.id?.replace(/^tab-/,'');if(active==='overall')openOverall(true);return r;};wrapped.__v7=true;window.fetchAllDataFromSheet=wrapped;try{fetchAllDataFromSheet=wrapped;}catch(_){}}
const priorTaskSave=window.saveDailyTask;if(typeof priorTaskSave==='function'&&!priorTaskSave.__v7){const wrapped=async function(){const r=await priorTaskSave.apply(this,arguments);renderTodo();return r;};wrapped.__v7=true;window.saveDailyTask=wrapped;try{saveDailyTask=wrapped;}catch(_){}}
const priorTaskDelete=window.deleteDailyTask;if(typeof priorTaskDelete==='function'&&!priorTaskDelete.__v7){const wrapped=async function(){const r=await priorTaskDelete.apply(this,arguments);renderTodo();return r;};wrapped.__v7=true;window.deleteDailyTask=wrapped;try{deleteDailyTask=wrapped;}catch(_){}}
function init(){bindTodo();bindOverall();renderTodo();updateProjectModernSummary();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
