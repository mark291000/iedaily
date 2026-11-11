/* =====================================================================
   PERF INDEX - fast workload calculation
   The old functions scanned EVERY task (and re-normalised every PIC name
   with regex) for EVERY member x EVERY day cell -> Weekly Workload,
   Team Performance and tab switching were very slow.
   Here the same rules are computed from an index that is built once and
   reused until the current JS task finishes (or the data changes), so the
   numbers are identical but each cell is O(tasks of that person).
   ===================================================================== */
(function(){
'use strict';
const lower=v=>String(v??'').trim().toLowerCase();

/* ---------- 1. memoised name normalisation (pure string functions) ---------- */
const cleanCache=new Map();
const origClean=cleanPersonDisplayName;
cleanPersonDisplayName=function(value){
  const k=String(value??'');
  let r=cleanCache.get(k);
  if(r===undefined){r=origClean(k);if(cleanCache.size>20000)cleanCache.clear();cleanCache.set(k,r);}
  return r;
};
window.cleanPersonDisplayName=cleanPersonDisplayName;

/* ---------- 2. per-tick cache helper ---------- */
let tickCache=null;
function cache(){
  const tl=Array.isArray(dailyTasks)?dailyTasks:[], pl=Array.isArray(projectsList)?projectsList:[],
        ol=Array.isArray(timeoffOtList)?timeoffOtList:[], ul=Array.isArray(users)?users:[];
  if(tickCache&&tickCache.t===tl&&tickCache.tn===tl.length&&tickCache.p===pl&&tickCache.pn===pl.length&&tickCache.o===ol&&tickCache.on===ol.length&&tickCache.u===ul)return tickCache;
  tickCache={t:tl,tn:tl.length,p:pl,pn:pl.length,o:ol,on:ol.length,u:ul,picList:new WeakMap(),work:null,proj:null,off:null};
  setTimeout(()=>{tickCache=null;},0);           // data may change after this JS task
  return tickCache;
}

/* ---------- 3. taskPICs memo (per task object, per tick) ---------- */
const origTaskPICs=taskPICs;
taskPICs=function(task){
  if(!task||typeof task!=='object')return origTaskPICs(task);
  const c=cache();let r=c.picList.get(task);
  if(!r){r=origTaskPICs(task);c.picList.set(task,r);}
  return r.slice();
};
window.taskPICs=taskPICs;

/* ---------- 4. workload index: pic -> [{s,e,h}] (same rules as before) ---------- */
function workIndex(){
  const c=cache();if(c.work)return c.work;
  const idx=new Map();
  c.t.forEach(t=>{
    const startDate=cleanDateStr(t.start), endDate=cleanDateStr(t.actual||t.plan);
    if(!startDate||!endDate||startDate>endDate)return;
    const sD=new Date(startDate+'T00:00:00'), eD=new Date(endDate+'T00:00:00');
    const diffDays=Math.max(1,Math.round((eD-sD)/86400000)+1);
    const h=(Number(t.usageTime)||0)/diffDays;
    const seen=new Set();
    taskPICs(t).forEach(p=>{const k=lower(p);if(!k||seen.has(k))return;seen.add(k);let a=idx.get(k);if(!a)idx.set(k,a=[]);a.push({s:startDate,e:endDate,h});});
  });
  return c.work=idx;
}
/* Daily Tracking "Project processing" rows: pic -> [{pid,item,s,e}] */
function projIndex(){
  const c=cache();if(c.proj)return c.proj;
  const idx=new Map();
  c.t.forEach(t=>{
    if(!isProjectHoursTask(t))return;
    const s0=cleanDateStr(t.start||t.plan||t.actual), e0=cleanDateStr(t.actual||t.plan||t.start);
    if(!s0||!e0)return;
    const row={pid:String(t.projectId??''),item:lower(t.items),s:s0,e:e0};
    taskPICs(t).forEach(p=>{const k=lower(p);let a=idx.get(k);if(!a)idx.set(k,a=[]);a.push(row);});
  });
  return c.proj=idx;
}
/* time off: pic -> rows (overtime excluded, same as getTimeOffHoursForPIC) */
function offIndex(){
  const c=cache();if(c.off)return c.off;
  const idx=new Map();
  c.o.forEach(o=>{
    if(normalizePersonKey(o.type)==='over time')return;
    const k=normalizePersonKey(o.pic);let a=idx.get(k);if(!a)idx.set(k,a=[]);a.push(o);
  });
  return c.off=idx;
}

hasDailyProjectTaskFor=function(project,picName,dateIso){
  const list=projIndex().get(lower(picName));if(!list)return false;
  const pid=String(project?.id??''),name=lower(project?.name);
  return list.some(r=>((r.pid!==''&&r.pid===pid)||r.item===name)&&r.s<=dateIso&&dateIso<=r.e);
};
window.hasDailyProjectTaskFor=hasDailyProjectTaskFor;

getDailyTaskHoursForPIC=function(picName,dateIso){
  let total=0;
  const list=workIndex().get(lower(picName));
  if(list)for(const r of list)if(dateIso>=r.s&&dateIso<=r.e)total+=r.h;
  return total+getProjectHoursUsedForPIC(picName,dateIso);
};
window.getDailyTaskHoursForPIC=getDailyTaskHoursForPIC;

getTimeOffHoursForPIC=function(picName,dateIso){
  let total=0;
  const list=offIndex().get(normalizePersonKey(picName));if(!list)return 0;
  list.forEach(o=>{
    const start=cleanDateStr(o.startDate), end=cleanDateStr(o.endDate||o.startDate);
    if(!start||!end||dateIso<start||dateIso>end)return;
    const s=new Date(start+'T00:00:00'), e=new Date(end+'T00:00:00');
    const days=Math.max(1,Math.round((e-s)/86400000)+1);
    const entered=Number(o.hours)||0;
    if(o.type==='Saturday Off')total+=Math.min(getStandardDayHours(new Date(dateIso+'T00:00:00'))||7,7);
    else if(o.type==='Day Off')total+=getStandardDayHours(new Date(dateIso+'T00:00:00'));
    else total+=entered/days;
  });
  return total;
};
window.getTimeOffHoursForPIC=getTimeOffHoursForPIC;
window.__invalidateWorkloadIndex=()=>{tickCache=null;};
})();
