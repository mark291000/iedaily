(function(){
  'use strict';
  const W=window;
  const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
  const boolValue=(value,fallback=true)=>{
    if(value===undefined||value===null||value==='')return fallback;
    if(typeof value==='boolean')return value;
    return !/^(false|0|no|n|off)$/i.test(String(value).trim());
  };
  const legacyMeta=row=>{
    const hours=row?.hours_used&&typeof row.hours_used==='object'
      ? row.hours_used
      : (row?.hoursUsed&&typeof row.hoursUsed==='object'?row.hoursUsed:{});
    return hours.__projectMeta&&typeof hours.__projectMeta==='object'?hours.__projectMeta:{};
  };
  function applyProjectColumns(project,row){
    if(!project||!row)return project;
    const meta=legacyMeta(row);
    const current=hasOwn(row,'current_stage')&&row.current_stage!==null
      ? row.current_stage
      : (row.currentStage??meta.currentStage??meta.stage??project.currentStage??'');
    const archived=hasOwn(row,'archived_goal')&&row.archived_goal!==null
      ? row.archived_goal
      : (row.archivedGoal??row.detailedStatus??meta.archivedGoal??meta.detailedStatus??project.archivedGoal??project.detailedStatus??'');
    const key=hasOwn(row,'key_project')&&row.key_project!==null
      ? boolValue(row.key_project,true)
      : boolValue(row.keyProject??meta.keyProject??project.keyProject,true);
    project.currentStage=String(current??'');
    project.archivedGoal=String(archived??'');
    project.keyProject=key;
    // Preserve the legacy app alias while making archived_goal the database source of truth.
    project.detailedStatus=project.archivedGoal;
    return project;
  }

  /* Read current_stage, archived_goal and key_project directly from public.projects. */
  try{
    const previousMap=W.mapDbProjectToApp||mapDbProjectToApp;
    const nextMap=function(row){return applyProjectColumns(previousMap(row),row);};
    W.mapDbProjectToApp=nextMap;
    mapDbProjectToApp=nextMap;
  }catch(error){console.error('V16 project mapper setup failed',error);}

  /* The main Projects page uses the relational builder, so enrich that path too. */
  try{
    const previousBuild=W.buildRelationalProjects||buildRelationalProjects;
    const nextBuild=function(projectRows,phaseRows,taskRows){
      const result=previousBuild(projectRows,phaseRows,taskRows);
      const rowsById=new Map((projectRows||[]).map(row=>[String(row?.id),row]));
      return (result||[]).map(project=>applyProjectColumns(project,rowsById.get(String(project?.id))));
    };
    W.buildRelationalProjects=nextBuild;
    buildRelationalProjects=nextBuild;
  }catch(error){console.error('V16 relational project mapper setup failed',error);}

  /* Keep hours_used for project hours/legacy tree data, but stop duplicating the three new fields there. */
  try{
    const previousHours=W.buildProjectStorageHours||buildProjectStorageHours;
    const nextHours=function(project){
      const raw=previousHours(project)||{};
      if(raw.__projectMeta&&typeof raw.__projectMeta==='object'){
        const meta={...raw.__projectMeta};
        ['currentStage','stage','archivedGoal','archiveGoal','achievedGoal','detailedStatus','keyProject'].forEach(key=>delete meta[key]);
        if(Object.keys(meta).length)raw.__projectMeta=meta;
        else delete raw.__projectMeta;
      }
      return raw;
    };
    W.buildProjectStorageHours=nextHours;
    buildProjectStorageHours=nextHours;
  }catch(error){console.error('V16 project hours cleanup setup failed',error);}

  /* Every normal project save now writes the dedicated public.projects columns. */
  try{
    const previousPayload=W.dbPayloadForSheet||dbPayloadForSheet;
    const nextPayload=function(sheet,row){
      const payload=previousPayload(sheet,row);
      if(sheet!=='Projects'||!payload)return payload;
      return {
        ...payload,
        current_stage:String(row?.currentStage??'').trim(),
        archived_goal:String(row?.archivedGoal??row?.detailedStatus??'').trim(),
        key_project:boolValue(row?.keyProject,true),
        hours_used:buildProjectStorageHours(row)
      };
    };
    W.dbPayloadForSheet=nextPayload;
    dbPayloadForSheet=nextPayload;
  }catch(error){console.error('V16 project payload setup failed',error);}

  /* Show no more than 15 project rows before the table gets its own scrollbar. */
  const selectors=['#tab-overall .ov-project-scroll','#tab-projects .v13-project-scroll'];
  let frame=0;
  function visibleRows(scroller){
    return [...scroller.querySelectorAll('tbody > tr')].filter(row=>{
      if(row.classList.contains('v13-filter-hidden'))return false;
      const style=getComputedStyle(row);
      return style.display!=='none'&&style.visibility!=='hidden';
    });
  }
  function sizeScroller(scroller){
    const table=scroller.querySelector('table');
    if(!table)return;
    const rows=visibleRows(scroller);
    if(rows.length<=15){
      scroller.style.removeProperty('--v16-project-viewport');
      scroller.dataset.v16Scrollable='false';
      return;
    }
    const head=table.tHead?.getBoundingClientRect().height||36;
    const rowHeight=rows.slice(0,15).reduce((sum,row)=>sum+Math.max(1,row.getBoundingClientRect().height),0);
    if(rowHeight>15){
      scroller.style.setProperty('--v16-project-viewport',Math.ceil(head+rowHeight+2)+'px');
      scroller.dataset.v16Scrollable='true';
    }
  }
  function syncProjectScrollers(){
    frame=0;
    selectors.forEach(selector=>document.querySelectorAll(selector).forEach(sizeScroller));
  }
  function scheduleProjectScrollers(){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>requestAnimationFrame(syncProjectScrollers));
  }
  function connectProjectScrollers(){
    const roots=[document.getElementById('ovProjectBody'),document.getElementById('projectsTableBody')].filter(Boolean);
    roots.forEach(root=>{
      if(root.dataset.v16ScrollObserved==='1')return;
      root.dataset.v16ScrollObserved='1';
      W.__scheduleProjectScrollers=scheduleProjectScrollers;
    });
    window.addEventListener('resize',scheduleProjectScrollers,{passive:true});
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-tab],.nav-item,#ovRefresh,#ovNow,#v13HeaderFilterPopup,.v13-filter-head'))setTimeout(scheduleProjectScrollers,0);
    },true);
    scheduleProjectScrollers();
    setTimeout(scheduleProjectScrollers,120);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',connectProjectScrollers,{once:true});
  else connectProjectScrollers();
})();
