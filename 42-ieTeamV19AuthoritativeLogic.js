(function(){
  'use strict';
  const W=window;
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
  const asBool=(value,fallback=true)=>{
    if(value===undefined||value===null||value==='')return fallback;
    if(typeof value==='boolean')return value;
    return !/^(false|0|no|n|off)$/i.test(String(value).trim());
  };
  const metaOf=row=>{
    const hours=row?.hours_used&&typeof row.hours_used==='object'?row.hours_used:(row?.hoursUsed&&typeof row.hoursUsed==='object'?row.hoursUsed:{});
    return hours.__projectMeta&&typeof hours.__projectMeta==='object'?hours.__projectMeta:{};
  };
  const applyDedicatedProjectColumns=(project,row)=>{
    if(!project||!row)return project;
    const meta=metaOf(row);
    const current=own(row,'current_stage')&&row.current_stage!==null?row.current_stage:(row.currentStage??meta.currentStage??meta.stage??project.currentStage??'');
    const archived=own(row,'archived_goal')&&row.archived_goal!==null?row.archived_goal:(row.archivedGoal??meta.archivedGoal??meta.detailedStatus??project.archivedGoal??project.detailedStatus??'');
    const key=own(row,'key_project')&&row.key_project!==null?asBool(row.key_project,true):asBool(row.keyProject??meta.keyProject??project.keyProject,true);
    project.currentStage=String(current??'');
    project.archivedGoal=String(archived??'');
    project.detailedStatus=project.archivedGoal;
    project.keyProject=key;
    return project;
  };

  /* Final read guards: both flat and relational project loaders use the dedicated columns. */
  try{
    const inheritedMap=W.mapDbProjectToApp||mapDbProjectToApp;
    const guardedMap=row=>applyDedicatedProjectColumns(inheritedMap(row),row);
    W.mapDbProjectToApp=guardedMap;
    mapDbProjectToApp=guardedMap;
  }catch(error){console.error('V19 project mapper setup failed',error);}
  try{
    const inheritedBuild=W.buildRelationalProjects||buildRelationalProjects;
    const guardedBuild=(projectRows,phaseRows,taskRows)=>{
      const result=inheritedBuild(projectRows,phaseRows,taskRows)||[];
      const rowsById=new Map((projectRows||[]).map(row=>[String(row?.id),row]));
      return result.map(project=>applyDedicatedProjectColumns(project,rowsById.get(String(project?.id))));
    };
    W.buildRelationalProjects=guardedBuild;
    buildRelationalProjects=guardedBuild;
  }catch(error){console.error('V19 relational project mapper setup failed',error);}

  /* Final write guard: every Projects insert/update includes all three public.projects columns. */
  try{
    const inheritedPayload=W.dbPayloadForSheet||dbPayloadForSheet;
    const guardedPayload=(sheet,row)=>{
      const payload=inheritedPayload(sheet,row);
      if(sheet!=='Projects'||!payload)return payload;
      return {
        ...payload,
        current_stage:String(row?.currentStage??'').trim(),
        archived_goal:String(row?.archivedGoal??row?.detailedStatus??'').trim(),
        key_project:asBool(row?.keyProject,true),
        hours_used:typeof buildProjectStorageHours==='function'?buildProjectStorageHours(row):payload.hours_used
      };
    };
    W.dbPayloadForSheet=guardedPayload;
    dbPayloadForSheet=guardedPayload;
  }catch(error){console.error('V19 project payload setup failed',error);}

  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const personKey=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
  const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const matrixPeriod=()=>{
    const yearSelect=document.getElementById('saturdayMatrixYear');
    const monthSelect=document.getElementById('saturdayMatrixMonth');
    const now=new Date();
    let year=Number(yearSelect?.value)||now.getFullYear();
    let month=Number(monthSelect?.value)||now.getMonth()+1;
    if(month<1||month>12)month=now.getMonth()+1;
    return {year,month,value:`${year}-${String(month).padStart(2,'0')}`};
  };
  function matrixSaturdays(year,month){
    const dates=[];
    for(let date=new Date(year,month-1,1);date.getMonth()===month-1;date.setDate(date.getDate()+1)){
      if(date.getDay()===6)dates.push(formatDateLocal(date));
    }
    return dates;
  }
  function initMatrixPeriodControls(preferGlobal=false){
    const yearSelect=document.getElementById('saturdayMatrixYear');
    const monthSelect=document.getElementById('saturdayMatrixMonth');
    if(!yearSelect||!monthSelect)return;
    const now=new Date(),years=new Set([now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1]);
    const requestSource=Array.isArray(W.timeoffOtList)?W.timeoffOtList:(typeof timeoffOtList!=='undefined'?timeoffOtList:[]);
    requestSource.forEach(item=>{const y=Number(String(item?.startDate||'').slice(0,4));if(y)years.add(y);});
    const globalState=typeof bomTopFilterState!=='undefined'?bomTopFilterState:null;
    const globalYear=preferGlobal&&globalState?.Year instanceof Set&&globalState.Year.size===1?Number([...globalState.Year][0]):0;
    const globalMonth=preferGlobal&&globalState?.Month instanceof Set&&globalState.Month.size===1?Number([...globalState.Month][0]):0;
    const currentYear=globalYear||Number(yearSelect.value)||now.getFullYear();
    const currentMonth=globalMonth||Number(monthSelect.value)||now.getMonth()+1;
    if(globalYear)years.add(globalYear);
    yearSelect.innerHTML=[...years].filter(Boolean).sort((a,b)=>b-a).map(y=>`<option value="${y}">${y}</option>`).join('');
    monthSelect.innerHTML=MONTH_NAMES.map((name,index)=>`<option value="${index+1}">${name}</option>`).join('');
    yearSelect.value=String([...years].includes(currentYear)?currentYear:now.getFullYear());
    monthSelect.value=String(currentMonth>=1&&currentMonth<=12?currentMonth:now.getMonth()+1);
  }

  /* Registration choices remain independent from Week; Year + Month are explicit. */
  const nextMonthSaturdays=()=>{const next=new Date();next.setDate(1);next.setMonth(next.getMonth()+1);return matrixSaturdays(next.getFullYear(),next.getMonth()+1);};
  W.getNextMonthSaturdays=nextMonthSaturdays;
  try{getNextMonthSaturdays=nextMonthSaturdays;}catch(_){ }

  const renderMatrix=()=>{
    const head=document.getElementById('saturdayMatrixHeader');
    const body=document.getElementById('saturdayMatrixBody');
    if(!head||!body)return;
    initMatrixPeriodControls(false);
    const {year,month}=matrixPeriod(),sats=matrixSaturdays(year,month);
    head.innerHTML='<th class="py-2.5 px-4">Member Name</th>'+sats.map(date=>`<th class="py-2.5 px-2 text-center">Sat (${esc(typeof formatDateMMDDYYYY==='function'?formatDateMMDDYYYY(date):date)})</th>`).join('');

    const state=typeof bomTopFilterState!=='undefined'?bomTopFilterState:null;
    const selectedMembers=state?.Member instanceof Set?state.Member:new Set();
    const categoryOk=!(state?.Category instanceof Set)||!state.Category.size||[...state.Category].some(value=>personKey(value)==='saturday off');
    const sourceUsers=Array.isArray(W.users)?W.users:(typeof users!=='undefined'?users:[]);
    const sourceRequests=Array.isArray(W.timeoffOtList)?W.timeoffOtList:(typeof timeoffOtList!=='undefined'?timeoffOtList:[]);
    const visibleUsers=sourceUsers
      .filter(user=>personKey(user?.status||'Active')==='active')
      .filter(user=>typeof isHiddenMember!=='function'||!isHiddenMember(user?.name))
      .filter(user=>!selectedMembers.size||[...selectedMembers].some(value=>personKey(value)===personKey(user?.name)));

    if(!categoryOk||!visibleUsers.length){
      body.innerHTML=`<tr><td colspan="${Math.max(1,sats.length+1)}" class="py-8 text-center text-slate-400">No members match the selected filters.</td></tr>`;
      return;
    }
    body.innerHTML=visibleUsers.map(user=>{
      const safeName=String(user?.name??''),jsName=safeName.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const cells=sats.map(date=>{
        const checked=sourceRequests.some(item=>personKey(item?.type)==='saturday off'&&personKey(item?.pic)===personKey(safeName)&&cleanDateStr(item?.startDate)<=date&&date<=cleanDateStr(item?.endDate||item?.startDate));
        return `<td class="py-2.5 px-2 text-center"><input type="checkbox" ${checked?'checked':''} onchange="toggleSaturdayMatrix('${jsName}','${date}',this.checked)" class="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"></td>`;
      }).join('');
      return `<tr class="hover:bg-slate-50 border-b"><td class="py-2.5 px-4 font-bold text-slate-800">${esc(safeName)}</td>${cells}</tr>`;
    }).join('');
  };
  W.renderSaturdayMatrixTable=renderMatrix;
  try{renderSaturdayMatrixTable=renderMatrix;}catch(_){ }

  /* Shared Year/Month filters synchronize the Matrix; Week never changes its date columns. */
  try{
    const inheritedApplyFilters=W.applyBomUnifiedFilters||applyBomUnifiedFilters;
    const applyFiltersWithMatrix=function(){
      const result=inheritedApplyFilters.apply(this,arguments);
      requestAnimationFrame(()=>{initMatrixPeriodControls(true);renderMatrix();});
      return result;
    };
    W.applyBomUnifiedFilters=applyFiltersWithMatrix;
    applyBomUnifiedFilters=applyFiltersWithMatrix;
  }catch(error){console.error('V19 Matrix filter synchronization failed',error);}

  /* Batch repeated project renders into one animation frame and run one scroll sync. */
  try{
    const inheritedProjectRender=W.renderProjectsTable||renderProjectsTable;
    let frame=0,again=false,running=false;
    const batchedProjectRender=function(){
      if(running){again=true;return;}
      if(frame){again=true;return;}
      frame=requestAnimationFrame(()=>{
        frame=0;running=true;
        try{inheritedProjectRender.apply(this,arguments);}finally{
          running=false;
          requestAnimationFrame(()=>{W.syncProjectTableScroll?.();W.__scheduleProjectScrollers?.();});
          if(again){again=false;batchedProjectRender();}
        }
      });
    };
    W.renderProjectsTable=batchedProjectRender;
    renderProjectsTable=batchedProjectRender;
  }catch(error){console.error('V19 project render batching setup failed',error);}

  function initV19(){initMatrixPeriodControls(true);renderMatrix();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initV19,{once:true});
  else requestAnimationFrame(initV19);
})();
