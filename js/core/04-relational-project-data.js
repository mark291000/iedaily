(function(){
'use strict';
/* ================================================================
   FINAL RELATIONAL DATA LAYER
   Projects -> project_phases -> project_tasks
   project_tasks.phase_id = NULL means a task directly under Project.
   projects.hours_used contains ONLY project daily hours.
   ================================================================ */
const REL_PHASE_TABLE='project_phases';
const REL_TASK_TABLE='project_tasks';
SUPABASE_TABLES.ProjectPhases=REL_PHASE_TABLE;
SUPABASE_TABLES.ProjectTasks=REL_TASK_TABLE;
let relationalPhaseSnapshot=[];
let relationalTaskSnapshot=[];

const dbId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const numOrNull=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const dateOrNull=v=>cleanDateStr(v)||null;
const orderOf=v=>Number.isFinite(Number(v))?Number(v):0;

function phaseDates(ph){
 const ts=Array.isArray(ph?.tasks)?ph.tasks:[];
 const starts=ts.map(t=>dateOrNull(t?.startDate)).filter(Boolean).sort();
 const plans=ts.map(t=>dateOrNull(t?.dueDate)).filter(Boolean).sort();
 const actuals=ts.map(t=>dateOrNull(t?.actualDate)).filter(Boolean).sort();
 const allTasksHaveActual=ts.length>0 && actuals.length===ts.length;
 return {startDate:starts[0]||'',dueDate:plans.at(-1)||'',actualDate:allTasksHaveActual?(actuals.at(-1)||''):''};
}

function normalizeProjectTree(p){
 if(!p)return p;
 p.phases=(Array.isArray(p.phases)?p.phases:[]).map((ph,i)=>{
  ph=ph||{};
  ph.sortOrder=orderOf(ph.sortOrder??i);
  ph.tasks=(Array.isArray(ph.tasks)?ph.tasks:[]).map((t,j)=>({...t,sortOrder:orderOf(t?.sortOrder??j)})).sort((a,b)=>a.sortOrder-b.sortOrder);
  const d=phaseDates(ph); ph.startDate=d.startDate;ph.dueDate=d.dueDate;ph.actualDate=d.actualDate;
  return ph;
 }).sort((a,b)=>a.sortOrder-b.sortOrder);
 p.tasks=(Array.isArray(p.tasks)?p.tasks:[]).map((t,i)=>({...t,sortOrder:orderOf(t?.sortOrder??i)})).sort((a,b)=>a.sortOrder-b.sortOrder);
 return p;
}

function phasePayload(project,ph,index){
 const d=phaseDates(ph);
 return {
  project_id:Number(project.id),
  name:String(ph.name||'').trim(),
  sort_order:index,
  start_date:d.startDate||null,
  plan_date:d.dueDate||null,
  actual_date:d.actualDate||null,
  status:ph.status||null,
  detail:ph.detail||null
 };
}

function taskPayload(project,t,index,phaseId){
 return {
  project_id:Number(project.id),
  phase_id:dbId(phaseId)?Number(phaseId):null,
  sort_order:index,
  name:String(t.name||'').trim(),
  owner:String(t.owner||'').trim()||null,
  start_date:dateOrNull(t.startDate),
  plan_date:dateOrNull(t.dueDate),
  actual_date:dateOrNull(t.actualDate),
  gain_demand:numOrNull(t.gainDemand),
  est_saving:numOrNull(t.estSaving),
  actual_saving:numOrNull(t.actualSaving),
  detailed_status:String(t.detail||'').trim()||null,
  status:String(t.status||calculateProjectTaskStatus(t)).trim()||null,
  progress:Math.max(0,Math.min(100,Number(t.progress)||0)),
  note:String(t.note||'').trim()||null
 };
}

function mapPhase(r){return {
 id:r.id,projectId:r.project_id,name:r.name||'',sortOrder:orderOf(r.sort_order),
 startDate:dateOrNull(r.start_date),dueDate:dateOrNull(r.plan_date),actualDate:dateOrNull(r.actual_date),
 status:r.status||'',detail:r.detail||'',tasks:[]
};}
function mapTask(r){return {
 id:r.id,projectId:r.project_id,phaseId:r.phase_id??null,sortOrder:orderOf(r.sort_order),
 name:r.name||'',owner:r.owner||'',startDate:dateOrNull(r.start_date),dueDate:dateOrNull(r.plan_date),actualDate:dateOrNull(r.actual_date),
 gainDemand:r.gain_demand??'',estSaving:r.est_saving??'',actualSaving:r.actual_saving??'',detail:r.detailed_status||'',
 note:r.note||'',progress:Number(r.progress||0),status:r.status||'Not Started'
};}

function buildRelationalProjects(projectRows,phaseRows,taskRows){
 const phasesByProject=new Map(),tasksByPhase=new Map(),direct=new Map();
 (phaseRows||[]).forEach(r=>{const a=phasesByProject.get(String(r.project_id))||[];a.push(mapPhase(r));phasesByProject.set(String(r.project_id),a);});
 (taskRows||[]).forEach(r=>{const t=mapTask(r);if(t.phaseId==null){const a=direct.get(String(r.project_id))||[];a.push(t);direct.set(String(r.project_id),a);}else{const k=String(r.project_id)+'::'+String(r.phase_id);const a=tasksByPhase.get(k)||[];a.push(t);tasksByPhase.set(k,a);}});
 return (projectRows||[]).map(r=>{
  const owners=Array.isArray(r?.owners)?r.owners:(r?.owner?String(r.owner).split(',').map(x=>x.trim()).filter(Boolean):[]);
  const hoursUsed=(r.hours_used&&typeof r.hours_used==='object')?r.hours_used:{};
  const projectMeta=hoursUsed.__projectMeta&&typeof hoursUsed.__projectMeta==='object'?hoursUsed.__projectMeta:{};
  const p={id:r.id,team:r.team||'',name:r.name||'',owner:r.owner||owners.join(', '),owners,scope:r.scope||'Projects',detail:r.detail||'',status:r.status||'Not Started',progress:Number(r.progress||0),startDate:dateOrNull(r.start_date),dueDate:dateOrNull(r.due_date),actualDate:dateOrNull(r.actual_date),priority:Number(r.priority||3),gainDemand:r.gain_demand??projectMeta.gainDemand??'',currentStage:String(r.current_stage??projectMeta.currentStage??projectMeta.stage??''),archivedGoal:String(r.archived_goal??projectMeta.archivedGoal??projectMeta.detailedStatus??''),keyProject:(r.key_project===undefined||r.key_project===null)?(projectMeta.keyProject===undefined?true:!(/^(false|0|no|n|off)$/i.test(String(projectMeta.keyProject).trim()))):!(/^(false|0|no|n|off)$/i.test(String(r.key_project).trim())),detailedStatus:String(r.archived_goal??projectMeta.archivedGoal??projectMeta.detailedStatus??''),phases:[],tasks:(direct.get(String(r.id))||[]).sort((a,b)=>a.sortOrder-b.sortOrder),saving:r.saving??0,actualSaving:r.actual_saving??'',note:r.note||'',hoursUsed,createdAt:r.created_at||'',updatedAt:r.updated_at||''};
  p.phases=(phasesByProject.get(String(r.id))||[]).sort((a,b)=>a.sortOrder-b.sortOrder);
  p.phases.forEach(ph=>{ph.tasks=(tasksByPhase.get(String(r.id)+'::'+String(ph.id))||[]).sort((a,b)=>a.sortOrder-b.sortOrder);const d=phaseDates(ph);ph.startDate=d.startDate;ph.dueDate=d.dueDate;ph.actualDate=d.actualDate;});
  syncProjectOverallStatus(p);return p;
 });
}

async function loadRelationalChildren(){
 const [ph,ta]=await Promise.all([
  supabaseClient.from(REL_PHASE_TABLE).select('*').order('project_id',{ascending:true}).order('sort_order',{ascending:true}),
  supabaseClient.from(REL_TASK_TABLE).select('*').order('project_id',{ascending:true}).order('sort_order',{ascending:true})
 ]);
 if(ph.error)throw ph.error;if(ta.error)throw ta.error;
 relationalPhaseSnapshot=ph.data||[];relationalTaskSnapshot=ta.data||[];
 return {phases:ph.data||[],tasks:ta.data||[]};
}

async function loadRelationalChildrenForProjects(projectRows){
 const ids=(projectRows||[]).map(r=>Number(r?.id)).filter(Number.isSafeInteger);
 if(!ids.length){relationalPhaseSnapshot=[];relationalTaskSnapshot=[];return {phases:[],tasks:[]};}
 const phases=[],tasks=[];
 for(let i=0;i<ids.length;i+=100){
  const batch=ids.slice(i,i+100);
  const [ph,ta]=await Promise.all([
   supabaseClient.from(REL_PHASE_TABLE).select('*').in('project_id',batch).order('project_id',{ascending:true}).order('sort_order',{ascending:true}),
   supabaseClient.from(REL_TASK_TABLE).select('*').in('project_id',batch).order('project_id',{ascending:true}).order('sort_order',{ascending:true})
  ]);
  if(ph.error)throw ph.error;if(ta.error)throw ta.error;
  phases.push(...(ph.data||[]));tasks.push(...(ta.data||[]));
 }
 relationalPhaseSnapshot=phases;relationalTaskSnapshot=tasks;
 return {phases,tasks};
}

async function syncRelationalChildren(projects){
 const list=Array.isArray(projects)?projects:[];const keptPh=new Set(),keptTa=new Set();
 for(const p of list){
  if(!dbId(p.id))continue;normalizeProjectTree(p);
  for(let pi=0;pi<p.phases.length;pi++){
   const ph=p.phases[pi];ph.sortOrder=pi;
   const payload=phasePayload(p,ph,pi);let res;
   if(dbId(ph.id))res=await supabaseClient.from(REL_PHASE_TABLE).update(payload).eq('id',Number(ph.id)).select('*').single();
   else res=await supabaseClient.from(REL_PHASE_TABLE).insert(payload).select('*').single();
   if(res.error)throw res.error;ph.id=res.data.id;ph.projectId=p.id;keptPh.add(String(res.data.id));
   for(let ti=0;ti<ph.tasks.length;ti++){
    const t=ph.tasks[ti];t.sortOrder=ti;const tp=taskPayload(p,t,ti,ph.id);let tr;
    if(dbId(t.id))tr=await supabaseClient.from(REL_TASK_TABLE).update(tp).eq('id',Number(t.id)).select('*').single();
    else tr=await supabaseClient.from(REL_TASK_TABLE).insert(tp).select('*').single();
    if(tr.error)throw tr.error;t.id=tr.data.id;t.projectId=p.id;t.phaseId=ph.id;keptTa.add(String(tr.data.id));
   }
  }
  for(let ti=0;ti<p.tasks.length;ti++){
   const t=p.tasks[ti];t.sortOrder=ti;const tp=taskPayload(p,t,ti,null);let tr;
   if(dbId(t.id))tr=await supabaseClient.from(REL_TASK_TABLE).update(tp).eq('id',Number(t.id)).select('*').single();
   else tr=await supabaseClient.from(REL_TASK_TABLE).insert(tp).select('*').single();
   if(tr.error)throw tr.error;t.id=tr.data.id;t.projectId=p.id;t.phaseId=null;keptTa.add(String(tr.data.id));
  }
 }
 const projectIds=new Set(list.filter(p=>dbId(p.id)).map(p=>String(p.id)));
 const oldTasks=relationalTaskSnapshot.filter(r=>projectIds.has(String(r.project_id))&&!keptTa.has(String(r.id))).map(r=>r.id);
 const oldPhases=relationalPhaseSnapshot.filter(r=>projectIds.has(String(r.project_id))&&!keptPh.has(String(r.id))).map(r=>r.id);
 if(oldTasks.length){const {error}=await supabaseClient.from(REL_TASK_TABLE).delete().in('id',oldTasks);if(error)throw error;}
 if(oldPhases.length){const {error}=await supabaseClient.from(REL_PHASE_TABLE).delete().in('id',oldPhases);if(error)throw error;}
 const fresh=await loadRelationalChildren();projectsList=buildRelationalProjects(list,fresh.phases,fresh.tasks);return projectsList;
}

/* Always load Project + Phase + Task from Supabase. */
fetchAllDataFromSheet=async function({background=false}={}){
 if(!initSupabaseClient())return false;
 const overlay=document.getElementById('loadingOverlay');if(!background&&currentUser&&overlay)overlay.classList.remove('opacity-0','pointer-events-none');
 try{
  const [u,c,t,to,p]=await Promise.all([
   fetchAllRows(SUPABASE_TABLES.Users,'id'),
   fetchAllRows(SUPABASE_TABLES.Capacity,'id'),
   fetchAllRows(SUPABASE_TABLES.Tasks,'updated_at'),
   fetchAllRows(SUPABASE_TABLES.TimeOff_OT,'id'),
   fetchAllRows(SUPABASE_TABLES.Projects,'id')
  ]);
  for(const r of [u,c,t,to,p])if(r.error)throw r.error;
  const ch=await loadRelationalChildrenForProjects(p.data||[]);
  users=(u.data||[]).map(mapDbUserToApp);capacityData=(c.data||[]).map(mapDbCapacityToApp);dailyTasks=(t.data||[]).map(mapDbTaskToApp);timeoffOtList=(to.data||[]).map(mapDbTimeoffToApp);projectsList=buildRelationalProjects(p.data||[],ch.phases,ch.tasks);
  if (typeof window.applyTeamScopeToState === 'function') window.applyTeamScopeToState();
  synchronizePICReferences();
  try{ await loadTaskYearUniverse(); }catch(_){}
  dailyTasks.forEach(x=>{x.start=cleanDateStr(x.start);x.plan=cleanDateStr(x.plan);x.actual=cleanDateStr(x.actual);if(!x.pics)x.pics=[];});ensureTaskIds(dailyTasks);dailyTasks=dedupeTasks(dailyTasks);
  timeoffOtList.forEach(x=>{x.startDate=cleanDateStr(x.startDate);x.endDate=cleanDateStr(x.endDate);});
  const state={Users:users,Capacity:capacityData,Tasks:dailyTasks,TimeOff_OT:timeoffOtList,Projects:projectsList};Object.keys(state).forEach(k=>sheetSyncSnapshots[k]=JSON.parse(JSON.stringify(state[k])));
  populateFilterOptions();if(!window._bomDefaultsInitialized){setBomCurrentPeriodDefaults();window._bomDefaultsInitialized=true;}updateDashboardFinancialKpis();updateBomFilterButtons();window.bomFilteredTasks=dailyTasks.filter(taskPassesBomTopFilters);renderCapacityTable();renderDailyTrackingTable();renderMyTasksTable();renderTimeoffOtTable();renderGanttChart();renderProjectsTable();renderWeeklyCalendar();renderUserManagementTable();renderSaturdayMatrixTable();initDashboardCharts();onTimeoffTypeChange();restoreAdvancedTableFilters();
  return true;
 }catch(e){console.error('Relational load error:',e);if(!background)showAppNotification(`Unable to load project data. ${e.message||e}`,'Database Error');return false;}
 finally{if(!background&&overlay)overlay.classList.add('opacity-0','pointer-events-none');}
};

/* Project row payload: never put Phase/Task data into hours_used.
   IMPORTANT: keep the existing payload builders for Users/Capacity/TimeOff_OT.
   This override must only specialize Projects; the previous version returned
   undefined for every other sheet and caused valid Time Off/Overtime requests
   to be reported as incomplete. */
const _baseDbPayloadForSheet = dbPayloadForSheet;
dbPayloadForSheet=function(sheetName,row){
 if(sheetName==='Projects')return {name:String(row.name||'').trim(),owner:Array.isArray(row.owners)?row.owners.join(', '):(row.owner||null),owners:Array.isArray(row.owners)?row.owners:[],scope:row.scope||'Projects',detail:row.detail||'',status:row.status||'Not Started',progress:Math.max(0,Math.min(100,Number(row.progress)||0)),start_date:dateOrNull(row.startDate),due_date:dateOrNull(row.dueDate),actual_date:dateOrNull(row.actualDate),priority:Number(row.priority)||3,gain_demand:numOrNull(row.gainDemand),saving:numOrNull(row.saving)??0,actual_saving:numOrNull(row.actualSaving),note:row.note||null,current_stage:String(row.currentStage??'').trim(),archived_goal:String(row.archivedGoal??row.detailedStatus??'').trim(),key_project:row.keyProject===undefined||row.keyProject===null||row.keyProject===''?true:!(/^(false|0|no|n|off)$/i.test(String(row.keyProject).trim())),hours_used:buildProjectStorageHours(row)};
 return _baseDbPayloadForSheet(sheetName,row);
};

/* Preserve project metadata inside hours_used alongside daily hour entries.
   Detailed Status has no dedicated Projects column in the current schema, so it
   must travel in __projectMeta or it is lost on every save/reload. */
buildProjectStorageHours=function(project){
 const raw=project?.hoursUsed&&typeof project.hoursUsed==='object'?project.hoursUsed:{};const clean={};
 Object.entries(raw).forEach(([k,v])=>{if(/^\d{4}-\d{2}-\d{2}$/.test(k)){const n=Number(v);if(Number.isFinite(n)&&n>0)clean[k]=n;}});
 const oldMeta=raw.__projectMeta&&typeof raw.__projectMeta==='object'?raw.__projectMeta:{};
 const phases=(Array.isArray(project?.phases)?project.phases:(Array.isArray(oldMeta.phases)?oldMeta.phases:[])).map((ph,pi)=>({...ph,sortOrder:pi,tasks:(Array.isArray(ph?.tasks)?ph.tasks:[]).map((t,ti)=>({...t,sortOrder:ti}))}));
 const tasks=(Array.isArray(project?.tasks)?project.tasks:(Array.isArray(oldMeta.tasks)?oldMeta.tasks:[])).map((t,ti)=>({...t,sortOrder:ti}));
 clean.__projectMeta={...oldMeta,gainDemand:project?.gainDemand??oldMeta.gainDemand??'',detailedStatus:String(project?.detailedStatus??oldMeta.detailedStatus??''),phases,tasks};
 return clean;
};
getProjectMetaFromStorage=function(hoursUsed){
 const raw=hoursUsed&&typeof hoursUsed==='object'?hoursUsed:{};const meta=raw.__projectMeta&&typeof raw.__projectMeta==='object'?raw.__projectMeta:{};
 return {gainDemand:meta.gainDemand??'',detailedStatus:String(meta.detailedStatus??''),phases:Array.isArray(meta.phases)?meta.phases:[],tasks:Array.isArray(meta.tasks)?meta.tasks:[]};
};

window._originalRunSheetSave = window._originalRunSheetSave || runSheetSave;
runSheetSave=async function(sheetName){
 if(sheetName!=='Projects')return window._originalRunSheetSave(sheetName);
 const local=sheetLatestLocal[sheetName];if(!local)return true;sheetLatestLocal[sheetName]=null;sheetSyncInFlight[sheetName]=true;lastLocalSaveAt[sheetName]=Date.now();
 try{
  const snap=sheetSyncSnapshots.Projects||[];const snapIds=new Map(snap.filter(x=>dbId(x?.id)).map(x=>[String(x.id),x]));const saved=[];
  for(const row of local){
   const payload=dbPayloadForSheet('Projects',row);let res;
   if(dbId(row.id)&&snapIds.has(String(row.id)))res=await supabaseClient.from(SUPABASE_TABLES.Projects).update(payload).eq('id',Number(row.id)).select('*').single();
   else res=await supabaseClient.from(SUPABASE_TABLES.Projects).insert(payload).select('*').single();
   if(res.error)throw res.error;const mapped=mapDbProjectToApp(res.data);mapped.phases=row.phases||[];mapped.tasks=row.tasks||[];saved.push(mapped);row.id=res.data.id;
  }
  const pending=pendingRowDeletions.Projects||new Set();const del=snap.filter(x=>dbId(x?.id)&&pending.has(stableRowKey('Projects',x))).map(x=>Number(x.id));
  if(del.length){const {error}=await teamGuard(supabaseClient.from(SUPABASE_TABLES.Projects).delete().in('id',del));if(error)throw error;}
  projectsList=saved;await syncRelationalChildren(projectsList);sheetSyncSnapshots.Projects=JSON.parse(JSON.stringify(projectsList));lastLocalSaveAt.Projects=Date.now();return true;
 }catch(e){console.error('Relational project save error:',e);showAppNotification(`Unable to save Projects / Phases / Tasks. ${e.message||e}`,'Database Error');throw e;}finally{sheetSyncInFlight.Projects=false;}
};

/* New Phase/Task: dates remain NULL until user enters them. */
addProjectInlinePhase=async function(projectId,name){
 const p=projectsList.find(x=>String(x.id)===String(projectId));const n=String(name||'').trim();if(!p||!n)return false;
 p.phases=Array.isArray(p.phases)?p.phases:[];p.phases.push({id:null,projectId:p.id,name:n,sortOrder:p.phases.length,startDate:'',dueDate:'',actualDate:'',status:'',detail:'',tasks:[]});
 expandedProjectRows.add(String(projectId));renderProjectsTable();renderGanttChart();
 try{await saveSheetData('Projects',projectsList);return true;}catch(e){showToast('Unable to save new phase');return false;}
};
addProjectInlineTask=async function(projectId,phaseIndex,name){
 const p=projectsList.find(x=>String(x.id)===String(projectId));const n=String(name||'').trim();if(!p||!n)return false;
 const list=getProjectInlineTaskList(p,phaseIndex);list.push({id:null,projectId:p.id,phaseId:phaseIndex>=0?(p.phases[phaseIndex]?.id||null):null,sortOrder:list.length,name:n,owner:phaseIndex>=0?'':projectOwnerText(p),startDate:'',dueDate:'',actualDate:'',detail:'',gainDemand:'',estSaving:'',actualSaving:'',note:'',progress:0,status:'Not Started'});
 expandedProjectRows.add(String(projectId));renderProjectsTable();renderGanttChart();
 try{await saveSheetData('Projects',projectsList);return true;}catch(e){showToast('Unable to save new task');return false;}
};

/* Project modal saves only public.projects. Children remain in their own tables. */
saveProject=async function(e){
 e.preventDefault();const id=document.getElementById('projectId').value;const owners=Array.from(document.querySelectorAll('.project-pic-checkbox')).filter(cb=>cb.checked).map(cb=>cb.value);const name=document.getElementById('projectName').value.trim();
 if(!name){validateRequiredFormFields(document.getElementById('projectForm'));return;}
 const existing=id?projectsList.find(p=>String(p.id)===String(id)):null;
 const startDate=dateOrNull(document.getElementById('projectStartDate').value),dueDate=dateOrNull(document.getElementById('projectDueDate').value),actualDate=dateOrNull(document.getElementById('projectActualDate').value);
 const numberField=(field)=>{const raw=document.getElementById(field).value;if(String(raw).trim()==='')return '';const n=Number(raw);return Number.isFinite(n)?n:NaN;};
 const gainDemand=numberField('projectGainDemand'),saving=numberField('projectSaving'),actualSaving=numberField('projectActualSaving');
 if([gainDemand,saving,actualSaving].some(v=>typeof v==='number'&&!Number.isFinite(v))){showToast('Please enter valid numeric values');return;}
 if(startDate&&dueDate&&dueDate<=startDate){showToast('Plan date must be later than Start date');return;}
 if(actualDate&&((startDate&&actualDate<startDate)||(dueDate&&actualDate>dueDate))){showToast('Actual date must be between Start and Plan dates');return;}
 const p={...(existing||{}),id:id?Number(id):undefined,name,scope:existing?.scope||'Projects',detail:document.getElementById('projectDetail').value.trim(),owners,owner:owners.join(', '),status:existing?.status||'Not Started',progress:existing?.progress||0,startDate,dueDate,actualDate,gainDemand,saving,actualSaving,detailedStatus:document.getElementById('projectDetailedStatus').value.trim(),note:document.getElementById('projectNote').value.trim(),hoursUsed:existing?.hoursUsed&&typeof existing.hoursUsed==='object'?existing.hoursUsed:{},phases:existing?.phases||[],tasks:existing?.tasks||[]};
 p.hoursUsed=buildProjectStorageHours(p);
 if(id){const i=projectsList.findIndex(x=>String(x.id)===String(id));if(i>=0)projectsList[i]=p;}else projectsList.unshift(p);
 try{await saveSheetData('Projects',projectsList);closeProjectModal();renderProjectsTable();renderGanttChart();updateDashboardCharts();showAppNotification(id?'Project updated successfully.':'Project created successfully.');}catch(err){showAppNotification(`Unable to save project. ${err.message||err}`,'Save Error');}
};

/* Drag is allowed only from the dedicated grip button. */
const _oldProjectTaskDragStart=projectTaskDragStart;
projectTaskDragStart=function(event,phaseIndex,taskIndex,projectId){if(!event?.currentTarget?.classList?.contains('pm-ref-drag-handle')){event?.preventDefault?.();return;}return _oldProjectTaskDragStart(event,phaseIndex,taskIndex,projectId);};

/* Project hours are still stored in projects.hours_used, but nothing else is. */
updateGanttHoursUsed=async function(projectId,dateIso,value,inputEl){
 const p=projectsList.find(x=>String(x.id)===String(projectId));if(!p)return;const s=dateOrNull(p.startDate),e=dateOrNull(p.dueDate);if(!s||!e||dateIso<s||dateIso>e){renderGanttChart();return;}
 const h=Math.max(0,Math.min(24,Number(value)||0));p.hoursUsed=p.hoursUsed||{};if(h)p.hoursUsed[dateIso]=h;else delete p.hoursUsed[dateIso];
 if(inputEl)inputEl.value=h||'';try{await saveSheetData('Projects',projectsList);}catch(err){showAppNotification('Project hours could not be synced to Supabase.','Sync Error');}
};

})();
