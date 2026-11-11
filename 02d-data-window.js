/* =====================================================================
   DATA WINDOW - load only the tasks that are needed
   - On login: only the CURRENT WEEK (+ every task that is still open, so
     To Do / Overdue / In progress lists stay complete).
   - Top filters (Year / Month / Week) or Weekly Workload navigation
     (prev / next / Week-Month-Year view): load ONLY that period, and only
     the Tasks table (not every table like before).
   - Clearing every Year/Month/Week filter = "all dates" -> loads all tasks.
   - Capacity "workload" averages are calculated on the server data
     (light columns only), so they do not depend on the loaded period.
   ===================================================================== */
(function(){
'use strict';
(window.__appFiles=window.__appFiles||{})['02d-data-window']='1.4.1';
const W=window;
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return iso(d);};
const mondayOf=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
const union=(a,b)=>!a?b:!b?a:{s:a.s<b.s?a.s:b.s,e:a.e>b.e?a.e:b.e};
const DW=W.__dataWindow={loaded:null,busy:null};

function currentWeek(){const m=mondayOf(new Date());return {s:iso(m),e:addDays(iso(m),6)};}

/* Year / Month / Week top filters -> date range. null = no date filter = all tasks */
function filterRange(){
  if(!W._bomDefaultsInitialized)return currentWeek();          // first load = current week
  let st;try{st=bomTopFilterState;}catch(_){return currentWeek();}
  const years=[...st.Year].map(Number).filter(Boolean).sort((a,b)=>a-b);
  const months=[...st.Month].map(Number).filter(Boolean).sort((a,b)=>a-b);
  const weeks=[...st.Week].map(Number).filter(Boolean).sort((a,b)=>a-b);
  if(!years.length&&!months.length&&!weeks.length)return null;
  const ys=years.length?years:[new Date().getFullYear()];
  let r=null;
  if(weeks.length){
    ys.forEach(y=>weeks.forEach(w=>{const x=getIsoWeekRange(y,w);if(x)r=union(r,{s:x.start,e:x.end});}));
    if(r)return r;
  }
  if(months.length){
    /* BOM month = 26th of the previous month .. 25th; keep the calendar month too */
    ys.forEach(y=>months.forEach(m=>{r=union(r,{s:iso(new Date(y,m-2,26)),e:iso(new Date(y,m,0))});}));
    return r;
  }
  ys.forEach(y=>{r=union(r,{s:iso(new Date(y-1,11,26)),e:`${y}-12-31`});});
  return r;
}
/* Weekly Workload view (week / month / year around the anchor date) */
function calendarRange(){
  let view,anchor;
  try{view=currentCalendarView;anchor=currentCalendarAnchor;}catch(_){return null;}
  if(!(anchor instanceof Date)||isNaN(anchor))return null;
  if(view==='year'){const y=anchor.getFullYear();return {s:`${y}-01-01`,e:`${y}-12-31`};}
  if(view==='month'){const a=new Date(anchor.getFullYear(),anchor.getMonth(),1),b=new Date(anchor.getFullYear(),anchor.getMonth()+1,0);return {s:addDays(iso(a),-7),e:addDays(iso(b),7)};}
  const m=mondayOf(anchor);return {s:iso(m),e:addDays(iso(m),6)};
}
function wantedRange(){
  const f=filterRange();
  if(!f)return null;                      // all dates requested
  return union(f,calendarRange());
}
function teamKey(){try{return serverTeamFilter(SUPABASE_TABLES.Tasks)||'*';}catch(_){return '*';}}
function covered(want){
  const L=DW.loaded;if(!L||L.team!==teamKey())return false;
  if(L.all)return true;
  return !!want&&L.s<=want.s&&L.e>=want.e;
}

/* ---------- server query for tasks ---------- */
function applyRange(q,r){
  if(!r)return q;
  /* task overlaps [s,e]  OR  task is still open (needed for To Do / Overdue) */
  return q.or(`start_date.lte.${r.e},start_date.is.null`)
          .or(`actual_date.gte.${r.s},plan_date.gte.${r.s},actual_date.is.null`);
}
async function fetchTasks(r,pageSize=1000){
  const team=teamKey()==='*'?null:teamKey();
  const all=[];
  for(let from=0;;from+=pageSize){
    let q=supabaseClient.from(SUPABASE_TABLES.Tasks).select('*');
    if(team)q=q.eq('team',team);
    q=applyRange(q,r);
    const {data,error}=await q.order('updated_at',{ascending:true}).order('id',{ascending:true}).range(from,from+pageSize-1);
    if(error)return {data:null,error};
    all.push(...(data||[]));
    if(!data||data.length<pageSize)break;
  }
  return {data:all,error:null};
}

/* every full load (login, Sync Cloud, team switch, realtime) uses the window too */
const origFetchAllRows=fetchAllRows;
fetchAllRows=async function(table,orderCol,pageSize=1000){
  if(table!==SUPABASE_TABLES.Tasks||!currentUser)return origFetchAllRows.apply(this,arguments);
  const r=wantedRange();
  const res=await fetchTasks(r,pageSize);
  if(!res.error){DW.loaded=r?{team:teamKey(),s:r.s,e:r.e,all:false}:{team:teamKey(),all:true};W.__loadedTaskKey=JSON.stringify(DW.loaded);}
  return res;
};
W.fetchAllRows=fetchAllRows;
getTaskLoadWindow=function(){const r=wantedRange();return r?{start:r.s,end:r.e,key:r.s+'_'+r.e}:null;};
W.getTaskLoadWindow=getTaskLoadWindow;

/* ---------- reload ONLY tasks when the period changes ---------- */
async function ensureTaskRange(){
  if(!currentUser||!initSupabaseClient())return false;
  const want=wantedRange();
  if(covered(want))return false;
  if(DW.busy){await DW.busy;if(covered(wantedRange()))return false;}
  DW.busy=(async()=>{
    try{await (sheetSaveQueues&&sheetSaveQueues.Tasks);}catch(_){}
    const ind=document.getElementById('dwLoading');if(ind)ind.classList.remove('hidden');
    try{
      const r=wantedRange();
      const res=await fetchTasks(r);
      if(res.error)throw res.error;
      let rows=(res.data||[]).map(mapDbTaskToApp);
      if(typeof W.scopeRowsToTeam==='function')rows=W.scopeRowsToTeam(rows);
      rows.forEach(x=>{x.start=cleanDateStr(x.start);x.plan=cleanDateStr(x.plan);x.actual=cleanDateStr(x.actual);if(!x.pics)x.pics=[];});
      ensureTaskIds(rows);rows=dedupeTasks(rows);
      dailyTasks=rows;
      try{synchronizePICReferences();}catch(_){}
      sheetSyncSnapshots.Tasks=JSON.parse(JSON.stringify(dailyTasks));
      DW.loaded=r?{team:teamKey(),s:r.s,e:r.e,all:false}:{team:teamKey(),all:true};
      W.__loadedTaskKey=JSON.stringify(DW.loaded);
      try{W.__invalidateWorkloadIndex?.();}catch(_){}
      return true;
    }catch(e){console.error('Task period load failed',e);showAppNotification(`Unable to load tasks for this period. ${e?.message||e}`,'Database Error');return false;}
    finally{if(ind)ind.classList.add('hidden');DW.busy=null;}
  })();
  return DW.busy;
}
W.ensureTaskRange=ensureTaskRange;
ensureTaskYearsLoaded=ensureTaskRange;W.ensureTaskYearsLoaded=ensureTaskRange;

/* Top filters: load the period first, then filter/render (all keys, not only Year).
   Installed after every script so it is the OUTERMOST wrapper. */
function wrapApply(){
  const inner=W.applyBomUnifiedFilters||applyBomUnifiedFilters;
  if(inner.__dw)return;
  let seq=0;
  const outer=function(){
    const self=this,args=arguments,my=++seq;
    if(covered(wantedRange()))return inner.apply(self,args);
    ensureTaskRange().then(()=>{if(my===seq)inner.apply(self,args);});
  };
  outer.__dw=true;W.applyBomUnifiedFilters=outer;applyBomUnifiedFilters=outer;
}
if(document.readyState==='complete')wrapApply();else W.addEventListener('load',wrapApply,{once:true});

/* Weekly Workload navigation */
['changeCalendarPeriod','setCalendarView','currentPeriodToday'].forEach(name=>{
  let fn;try{fn=(0,eval)(name);}catch(_){return;}
  if(typeof fn!=='function')return;
  const w=function(){
    const r=fn.apply(this,arguments);
    ensureTaskRange().then(changed=>{if(changed){try{W.bomFilteredTasks=dailyTasks.filter(taskPassesBomTopFilters);}catch(_){}renderWeeklyCalendar();}});
    return r;
  };
  W[name]=w;try{(0,eval)(`${name}=window.${name};`);}catch(_){}
});

/* Week list of the filter no longer depends on loaded tasks */
const origUniverse=getBomFilterUniverse;
getBomFilterUniverse=function(key){
  if(key==='Week'){
    let st;try{st=bomTopFilterState;}catch(_){return origUniverse(key);}
    const ys=[...st.Year].map(Number).filter(Boolean);const years=ys.length?ys:[new Date().getFullYear()];
    const months=st.Month;const out=new Set();
    years.forEach(y=>{for(let w=1;w<=53;w++){const r=getIsoWeekRange(y,w);if(!r)continue;if(w===53&&Number(r.end.slice(0,4))>y&&Number(r.start.slice(0,4))>y)continue;
      const m=String(Number(r.end.slice(5,7)));if(months.size&&!months.has(m))continue;out.add(String(w));}});
    return [...out].sort((a,b)=>a-b);
  }
  const base=origUniverse(key);
  if(key==='Category'){const s=new Set(base);(capacityData||[]).forEach(c=>c?.category&&s.add(String(c.category)));return [...s].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));}
  if(key==='Member'){const s=new Set(base);(users||[]).forEach(u=>{const n=u?.name;if(n&&String(u.status||'Active').toLowerCase()==='active'&&!isHiddenMember(n))s.add(String(n));});return [...s].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));}
  return base;
};
W.getBomFilterUniverse=getBomFilterUniverse;

/* Capacity workload averages: computed from ALL tasks of the team on the server (light columns) */
async function serverCapacityBuckets(){
  const team=teamKey()==='*'?null:teamKey();
  const buckets=new Map();
  for(let from=0;;from+=1000){
    let q=supabaseClient.from(SUPABASE_TABLES.Tasks).select('id,team,category,name,usage_time');
    if(team)q=q.eq('team',team);
    const {data,error}=await q.order('id',{ascending:true}).range(from,from+999);
    if(error)throw error;
    (data||[]).forEach(t=>{
      const category=String(t?.category||'').trim(),task=String(t?.name||'').trim(),hours=Number(t?.usage_time);
      if(!category||!task||!Number.isFinite(hours)||hours<=0)return;
      const key=`${teamKeyOf(t)}###${normalizeWorkloadKey(category)}|||${normalizeWorkloadKey(task)}`;
      const b=buckets.get(key)||{sum:0,count:0};b.sum+=hours;b.count+=1;buckets.set(key,b);
    });
    if(!data||data.length<1000)break;
  }
  return buckets;
}
let lastBuckets=null;
recalculateCapacityWorkloadsFromTasks=function(){
  if(DW.loaded&&!DW.loaded.all&&!lastBuckets)return capacityData;   // partial tasks: never overwrite with partial averages
  if(!lastBuckets)return capacityData;
  capacityData.forEach(c=>{const b=lastBuckets.get(`${teamKeyOf(c)}###${normalizeWorkloadKey(c?.category)}|||${normalizeWorkloadKey(c?.task)}`);c.workload=b?+(b.sum/b.count).toFixed(2):0;});
  return capacityData;
};
W.recalculateCapacityWorkloadsFromTasks=recalculateCapacityWorkloadsFromTasks;
syncCapacityWorkloadsFromTasks=async function(){
  try{lastBuckets=await serverCapacityBuckets();}catch(e){console.warn('Capacity server recalculation failed',e);return;}
  recalculateCapacityWorkloadsFromTasks();
  await saveSheetData('Capacity',capacityData);
  renderCapacityTable();
};
W.syncCapacityWorkloadsFromTasks=syncCapacityWorkloadsFromTasks;
})();
