(function(){
  'use strict';

  function v53Money(v){
    if(v===null || v===undefined || String(v).trim()==='') return null;
    const raw=String(v).trim().replace(/[$€£¥\s,]/g,'');
    const n=Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function v53Children(project){
    const phases=Array.isArray(project?.phases)?project.phases:[];
    const phaseTasks=phases.flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]);
    const direct=Array.isArray(project?.tasks)?project.tasks:[];
    return phaseTasks.concat(direct);
  }

  /*
   * Dashboard / Report Cost Saving must use exactly the same rule as the
   * Project Management table:
   *   1. If a child task has Actual Saving, use the child Actual Saving total.
   *   2. Otherwise, if a child task has Estimated Saving, use the child
   *      Estimated Saving total.
   *   3. If there are no child saving values, use the values entered directly
   *      on the Project popup.
   *
   * This fixes project-only projects being omitted from the dashboard KPI.
   */
  window.calcProjectEffectiveSaving=function(project){
    const children=v53Children(project);

    const childActual=[];
    const childEstimated=[];
    children.forEach(t=>{
      const actual=v53Money(t?.actualSaving);
      const estimated=v53Money(t?.estSaving);
      if(actual!==null) childActual.push(actual);
      if(estimated!==null) childEstimated.push(estimated);
    });

    if(childActual.length) return childActual.reduce((a,b)=>a+b,0);
    if(childEstimated.length) return childEstimated.reduce((a,b)=>a+b,0);

    const projectActual=v53Money(project?.actualSaving);
    if(projectActual!==null) return projectActual;

    const projectEstimated=v53Money(project?.saving);
    return projectEstimated!==null ? projectEstimated : 0;
  };

  window.calcBomCostSaving=function(){
    return (Array.isArray(window.projectsList)?window.projectsList:[])
      .reduce((sum,p)=>sum+Number(window.calcProjectEffectiveSaving(p)||0),0);
  };

  window.calcBomOvertimeHours=function(){
    const list=Array.isArray(window.timeoffOtList)?window.timeoffOtList:(Array.isArray(timeoffOtList)?timeoffOtList:[]);
    const state=typeof bomTopFilterState!=='undefined'?bomTopFilterState:null;
    const selectedMembers=state&&state.Member instanceof Set?[...state.Member].map(v=>String(v).trim().toLowerCase()).filter(Boolean):[];
    const years=state&&state.Year instanceof Set?state.Year.size:0;
    const months=state&&state.Month instanceof Set?state.Month.size:0;
    const weeks=state&&state.Week instanceof Set?state.Week.size:0;
    // No date selection means all overtime records, even if their dates are outside task dates.
    const hasDateFilter=years+months+weeks>0;
    const range=hasDateFilter&&typeof getDashboardPeriodRange==='function'?getDashboardPeriodRange():null;
    const toDate=v=>{
      if(typeof cleanDateStr==='function') return cleanDateStr(v);
      const d=String(v??'').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:'';
    };
    return list.reduce((sum,x)=>{
      const type=String(x?.type??x?.request_type??'').trim().toLowerCase().replace(/[\s_-]+/g,'');
      if(type!=='overtime') return sum;
      const pic=String(x?.pic??x?.PIC??'').trim().toLowerCase();
      if(selectedMembers.length&&!selectedMembers.includes(pic)) return sum;
      const raw=String(x?.hours??x?.total_hours??0).trim().replace(',','.');
      const hours=Number.parseFloat(raw);
      if(!Number.isFinite(hours)||hours<=0) return sum;
      if(!range||!range.start||!range.end) return sum+hours;
      const start=toDate(x?.startDate??x?.start_date??x?.start);
      const end=toDate(x?.endDate??x?.end_date??x?.end)||start;
      if(!start||!end||end<range.start||start>range.end) return sum;
      const clippedStart=start<range.start?range.start:start;
      const clippedEnd=end>range.end?range.end:end;
      const totalDays=Math.max(1,Math.round((new Date(end+'T00:00:00')-new Date(start+'T00:00:00'))/86400000)+1);
      const overlapDays=Math.max(0,Math.round((new Date(clippedEnd+'T00:00:00')-new Date(clippedStart+'T00:00:00'))/86400000)+1);
      return sum+hours*(overlapDays/totalDays);
    },0);
  };

  window.updateDashboardFinancialKpis=function(){
    const c=document.getElementById('dashCostSaving');
    const o=document.getElementById('dashOvertime');
    if(c)c.textContent='$'+Number(window.calcBomCostSaving()||0).toLocaleString(undefined,{maximumFractionDigits:2});
    if(o)o.textContent=Number(window.calcBomOvertimeHours()||0).toLocaleString(undefined,{maximumFractionDigits:2})+' h';
  };

  // Recalculate after project data is loaded/rendered so Dashboard and Report
  // always reflect the same current project/task values.
  const refresh=function(){
    try{window.updateDashboardFinancialKpis?.();}catch(_){ }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',refresh,{once:true});
  else refresh();

  const oldFetch=window.fetchAllDataFromSheet;
  if(typeof oldFetch==='function' && !oldFetch.__v53CostSavingWrapped){
    const wrapped=async function(){
      const result=await oldFetch.apply(this,arguments);
      refresh();
      return result;
    };
    wrapped.__v53CostSavingWrapped=true;
    window.fetchAllDataFromSheet=wrapped;
  }

  const oldUpdate=window.updateDashboardCharts;
  if(typeof oldUpdate==='function' && !oldUpdate.__v53CostSavingWrapped){
    const wrapped=function(){
      const result=oldUpdate.apply(this,arguments);
      refresh();
      return result;
    };
    wrapped.__v53CostSavingWrapped=true;
    window.updateDashboardCharts=wrapped;
  }
})();
