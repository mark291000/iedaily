(function(){
  'use strict';
  function stop(e){ if(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();} }
  function invokeTableProject(btn){
    const oc=String(btn.getAttribute('onclick')||'');
    const m=oc.match(/toggleProjectRowExpand\(\s*['"]([^'"]+)['"]\s*\)/);
    if(!m)return false;
    if(typeof window.toggleProjectRowExpand!=='function')return false;
    window.toggleProjectRowExpand(m[1]);
    requestAnimationFrame(window.updateProjectExpandCollapseButton||function(){});
    return true;
  }
  function invokeTablePhase(btn){
    const oc=String(btn.getAttribute('onclick')||'');
    const m=oc.match(/toggleProjectPhase\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*\)/);
    if(!m)return false;
    if(typeof window.toggleProjectPhase!=='function')return false;
    window.toggleProjectPhase(m[1],Number(m[2]));
    requestAnimationFrame(window.updateProjectExpandCollapseButton||function(){});
    return true;
  }
  function invokeGantt(btn){
    const oc=String(btn.getAttribute('onclick')||'');
    let m=oc.match(/toggleGanttProject\(\s*['"]([^'"]+)['"]\s*\)/);
    if(m && typeof window.toggleGanttProject==='function'){
      window.toggleGanttProject(m[1]);
      requestAnimationFrame(window.updateProjectExpandCollapseButton||function(){});
      return true;
    }
    m=oc.match(/toggleGanttPhase\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*\)/);
    if(m && typeof window.toggleGanttPhase==='function'){
      window.toggleGanttPhase(m[1],Number(m[2]));
      requestAnimationFrame(window.updateProjectExpandCollapseButton||function(){});
      return true;
    }
    return false;
  }
  document.addEventListener('click',function(e){
    const target=e.target instanceof Element?e.target:null;
    if(!target)return;
    const allBtn=target.closest('#projectExpandCollapseBtn');
    if(allBtn){
      stop(e);
      if(typeof window.toggleAllProjectRows==='function') window.toggleAllProjectRows();
      return;
    }
    const ganttBtn=target.closest('#ganttChartContainer .pm-gantt-toggle');
    if(ganttBtn){
      stop(e);
      invokeGantt(ganttBtn);
      return;
    }
    const phaseBtn=target.closest('#projectTableView .pm-phase-toggle');
    if(phaseBtn){
      stop(e);
      invokeTablePhase(phaseBtn);
      return;
    }
    const projectBtn=target.closest('#projectTableView .pm-project-name-button');
    if(projectBtn){
      stop(e);
      invokeTableProject(projectBtn);
      return;
    }
  },true);

  /* Some table layouts also make the project number cell clickable. */
  document.addEventListener('click',function(e){
    const target=e.target instanceof Element?e.target:null;
    const cell=target?.closest('#projectTableView .pm-project-no-cell');
    if(!cell)return;
    const oc=String(cell.getAttribute('onclick')||'');
    const m=oc.match(/toggleProjectRowExpand\(\s*['"]([^'"]+)['"]\s*\)/);
    if(!m || typeof window.toggleProjectRowExpand!=='function')return;
    stop(e); window.toggleProjectRowExpand(m[1]);
  },true);

  function refresh(){try{if(typeof window.updateProjectExpandCollapseButton==='function')window.updateProjectExpandCollapseButton();}catch(_){} }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(refresh,0));
  window.addEventListener('resize',refresh);
})();
