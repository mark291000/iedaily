(function(){
  'use strict';
  function refreshPhaseActualDates(){
    try{
      (projectsList||[]).forEach(p=>{
        (p.phases||[]).forEach(ph=>{
          const d=deriveProjectPhaseSchedule(ph,p);
          ph.startDate=d.startDate;
          ph.dueDate=d.dueDate;
          ph.actualDate=d.actualDate;
        });
      });
    }catch(e){ console.warn('V43 phase actual refresh failed',e); }
  }
  window.refreshProjectPhaseActualDates=refreshPhaseActualDates;
  /* Keep derived phase dates current before every Project Management render. */
  const wrap=(name)=>{
    const fn=window[name];
    if(typeof fn!=='function')return;
    if(fn.__v43Wrapped)return;
    const wrapped=function(){ refreshPhaseActualDates(); return fn.apply(this,arguments); };
    wrapped.__v43Wrapped=true;
    window[name]=wrapped;
  };
  wrap('renderProjectsTable');
  wrap('renderGanttChart');
  /* If an inline task edit changes Actual, refresh immediately before the next UI frame. */
  document.addEventListener('change',function(e){
    const el=e.target instanceof Element?e.target:null;
    if(!el || !el.matches('#projectTableView input, #projectTableView select'))return;
    requestAnimationFrame(refreshPhaseActualDates);
  },true);
})();
