/* =====================================================================
   RENDER SKIP - faster page switching
   switchTab() re-built Team Performance charts, Weekly Workload and
   My Tasks on EVERY visit, even when nothing changed. Now, during a page
   switch, the render is skipped if the data + filters are exactly the same
   as the last time that page was rendered. Any change in data (tasks,
   time off, projects, users), filters or team re-renders as before.
   ===================================================================== */
(function(){
'use strict';
const W=window;
let inSwitch=0;
function h(str,acc){for(let i=0;i<str.length;i++){acc^=str.charCodeAt(i);acc=Math.imul(acc,16777619);}return acc>>>0;}
function hashList(list,fields){
  let acc=2166136261>>>0;
  if(!Array.isArray(list))return 'x';
  for(const r of list){if(!r)continue;for(const f of fields){const v=r[f];acc=h(Array.isArray(v)?v.join(','):String(v??''),acc);acc=h('|',acc);}}
  return list.length+':'+acc;
}
function filterState(){
  try{return JSON.stringify(Object.entries(bomTopFilterState).map(([k,v])=>[k,v instanceof Set?[...v].sort():v]));}catch(_){return '';}
}
function controls(root){
  if(!root)return '';
  return [...root.querySelectorAll('select,input')].map(e=>e.type==='checkbox'||e.type==='radio'?(e.checked?1:0):e.value).join('\u0001');
}
function signature(rootIds){
  const T=typeof dailyTasks!=='undefined'?dailyTasks:[], O=typeof timeoffOtList!=='undefined'?timeoffOtList:[],
        P=typeof projectsList!=='undefined'?projectsList:[], U=typeof users!=='undefined'?users:[];
  return [
    hashList(T,['id','category','name','pic','start','plan','actual','usageTime','status','team','scope','priority']),
    hashList(O,['id','type','pic','startDate','endDate','hours','team']),
    hashList(P,['id','name','owner','status','startDate','dueDate','actualDate','team','progress']),
    hashList(U,['name','team','role','status','show']),
    (W.bomFilteredTasks||[]).length, filterState(), String(W.activeTeamView||''),
    String(currentUser?.name||''), String(!!currentUser?.isReadOnly), new Date().toDateString(),
    rootIds.map(id=>controls(document.getElementById(id))).join('\u0002')
  ].join('\u0003');
}
const visible=ids=>ids.some(id=>{const el=document.getElementById(id);return el&&!el.classList.contains('hidden');});
const last={};
function guard(name,rootIds){
  const fn=W[name];if(typeof fn!=='function'||fn.__skipGuard)return;
  const g=function(){
    if(inSwitch&&visible(rootIds)&&last[name]){
      let sig='';try{sig=signature(rootIds);}catch(_){}
      if(sig&&sig===last[name])return;          // nothing changed -> keep the current DOM
      if(W.__skipDebug){const a=sig.split('\u0003'),b=last[name].split('\u0003');console.log('render',name,'changed parts',a.map((x,i)=>x===b[i]?'':i).filter(String).join(','),JSON.stringify(a[10]).slice(0,300),JSON.stringify(b[10]).slice(0,300));}
    }
    if(W.__skipDebug)console.log('render-run',name,'inSwitch='+inSwitch,'hasLast='+!!last[name],'vis='+visible(rootIds));
    const r=fn.apply(this,arguments);
    if(visible(rootIds)){try{last[name]=signature(rootIds);}catch(_){last[name]='';}}
    return r;
  };
  g.__skipGuard=true;W[name]=g;try{(0,eval)(`${name}=window.${name};`);}catch(_){}
}
guard('updateDashboardCharts',['tab-dashboard']);
guard('renderWeeklyCalendar',['tab-weekly-calendar','tab-dashboard']);
guard('renderMyTasksTable',['tab-my-tasks']);

/* must be the OUTERMOST switchTab wrapper (other patches wrap it on load) */
function wrapSwitch(){
  const sw=W.switchTab;
  if(typeof sw!=='function'||sw.__skipGuard)return;
  const s=function(){inSwitch++;try{return sw.apply(this,arguments);}finally{inSwitch--;}};
  s.__skipGuard=true;W.switchTab=s;try{switchTab=s;}catch(_){}
}
wrapSwitch();
if(document.readyState==='complete')setTimeout(wrapSwitch,0);
else W.addEventListener('load',()=>setTimeout(wrapSwitch,0),{once:true});
/* if another patch re-wraps switchTab later (e.g. after login), wrap again */
const prevInitSession=W.initUserSession;
if(typeof prevInitSession==='function'){
  const f=function(){const r=prevInitSession.apply(this,arguments);setTimeout(wrapSwitch,0);return r;};
  W.initUserSession=f;try{initUserSession=f;}catch(_){}
}
/* data reload / logout / team switch -> always render fresh next time */
['fetchAllDataFromSheet','logout','switchTeamView','initUserSession'].forEach(n=>{
  const f=W[n];if(typeof f!=='function'||f.__skipReset)return;
  const w=function(){if(W.__skipDebug)console.log('render-reset',n);for(const k in last)delete last[k];return f.apply(this,arguments);};
  w.__skipReset=true;W[n]=w;try{(0,eval)(`${n}=window.${n};`);}catch(_){}
});
})();
