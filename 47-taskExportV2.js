/* =====================================================================
   TASK EXPORT V2 - Daily Tracking / My Tasks
   Columns: always PIC; 'Usage Time' without 'h'; every cell formatted as Text.
   Old export copied the HTML table, so:
   - My Tasks has no PIC column on screen -> no PIC in the file
   - Daily Tracking showed "-" for PICs hidden from reports / other teams
   - only the first page of rows (Show all ...) was exported
   New export builds the file from the task data:
   - always includes PIC (all assigned people) + Team
   - exports ALL rows that pass the current filters (top filters + column filters)
   ===================================================================== */
(function(){
'use strict';
(window.__appFiles=window.__appFiles||{})['47-taskExportV2']='1.4.1';
const W=window;
const COLS=['Category','Task Name','Detail','Scope','Priority','PIC','Team','Start','Plan','Actual','Usage Time','Discipline','Status','Created By'];
const WIDTH=[18,28,40,16,10,24,14,12,12,12,10,12,12,16];
const N=v=>String(v??'').trim().toLowerCase();
const fmt=v=>{const s=typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'');if(!s)return '';const [y,m,d]=s.split('-');return y&&m&&d?`${m}/${d}/${y}`:s;};
/* Usage Time as plain text number: 0.5 -> "0.5", 4 -> "4" (no "h") */
const usageText=v=>{const s=String(v??'').replace(/\s*h(ours?)?\s*$/i,'').trim();if(s==='')return '';const n=Number(s);return Number.isFinite(n)?String(n):s;};
const pics=t=>{try{return taskPICs(t);}catch(_){return String(t?.pic||'').split(',').map(x=>x.trim()).filter(Boolean);}};
const tasksSrc=()=>(W.bomFilteredTasks||(typeof dailyTasks!=='undefined'?dailyTasks:[]));

function baseList(tab){
  let list=tasksSrc();
  if(tab==='tab-daily-tracking'){
    try{list=list.filter(taskPassesBomTopFilters);}catch(_){}
  }else{
    const me=N(currentUser?.name||currentUser?.username||'');
    list=list.filter(t=>pics(t).some(p=>N(p)===me));
  }
  try{list=list.slice().sort(compareByCreationTimeDesc);}catch(_){list=list.slice();}
  return list;
}
/* Respect Excel-style column filters: when a column filter is active the table renders all
   rows and hides the filtered-out ones, so keep only tasks whose row is visible. */
function applyColumnFilters(tab,list){
  const tbody=document.getElementById(tab==='tab-daily-tracking'?'dailyTrackingTableBody':'myTasksTableBody');
  if(!tbody)return list;
  const rows=[...tbody.querySelectorAll(':scope > tr[id^="task-row-"]')];
  if(!rows.some(r=>r.classList.contains('hidden')||r.style.display==='none'))return list;
  const prefix=tab==='tab-daily-tracking'?'task-row-':'task-row-my-';
  const visible=new Set(rows.filter(r=>!r.classList.contains('hidden')&&r.style.display!=='none').map(r=>r.id.slice(prefix.length)));
  return list.filter(t=>visible.has(String(t.id)));
}
function exportTasks(tab){
  if(!W.XLSX){showAppNotification('Excel library is not loaded.','Export Error');return;}
  const list=applyColumnFilters(tab,baseList(tab));
  if(!list.length){showAppNotification('No task data to export.','Export');return;}
  const body=list.map(t=>{try{calculateTaskMetadata(t);}catch(_){}
    return [t.category||'',t.name||'',t.items||'',t.scope||(typeof getDailyTaskScope==='function'?getDailyTaskScope(t):'')||'',t.priority||'',pics(t).join(', '),t.team||'',
            fmt(t.start||t.startDate),fmt(t.plan||t.planDate),fmt(t.actual||t.actualDate),usageText(t.usageTime),t.discipline||'',t.status||'',t.createdBy||''].map(v=>String(v??''));});
  const ws=XLSX.utils.aoa_to_sheet([COLS,...body]);
  ws['!cols']=WIDTH.map(w=>({wch:w}));
  ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(COLS.length-1)}${body.length+1}`};
  ws['!freeze']={xSplit:0,ySplit:1};ws['!views']=[{state:'frozen',ySplit:1}];
  const border={top:{style:'thin',color:{rgb:'D1D5DB'}},bottom:{style:'thin',color:{rgb:'D1D5DB'}},left:{style:'thin',color:{rgb:'D1D5DB'}},right:{style:'thin',color:{rgb:'D1D5DB'}}};
  for(let r=0;r<=body.length;r++)for(let c=0;c<COLS.length;c++){
    const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell)continue;
    /* every cell is TEXT (@): keeps leading zeros, no auto date/number conversion */
    cell.t='s';cell.v=String(cell.v??'');cell.z='@';
    cell.s=r===0?{font:{bold:true,color:{rgb:'0F172A'}},fill:{patternType:'solid',fgColor:{rgb:'E2E8F0'}},alignment:{horizontal:'center',vertical:'center'},border,numFmt:'@'}
               :{border,alignment:{vertical:'center',wrapText:c===2},numFmt:'@'};
  }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,tab==='tab-daily-tracking'?'Daily Tracking':'My Tasks');
  XLSX.writeFile(wb,`${tab.replace('tab-','')}_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
}
const prev=W.exportCurrentPageData||(typeof exportCurrentPageData==='function'?exportCurrentPageData:null);
const next=function(tabId){
  if(tabId==='tab-daily-tracking'||tabId==='tab-my-tasks'){
    try{return exportTasks(tabId);}catch(e){console.error('Task export failed',e);showAppNotification(`Export failed. ${e?.message||e}`,'Export Error');return;}
  }
  return prev?prev.apply(this,arguments):undefined;
};
W.exportCurrentPageData=next;try{exportCurrentPageData=next;}catch(_){}
})();
