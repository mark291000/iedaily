(function(){
  'use strict';
  function tableFix(){
    const view=document.getElementById('projectTableView');
    const wrap=view?.querySelector('.pm-shared-table-wrap');
    const table=view?.querySelector('.pm-shared-project-table');
    if(!wrap||!table)return;
    table.style.width='1800px';
    table.style.minWidth='1800px';
    table.style.maxWidth='none';
    wrap.style.overflowX='auto';
    wrap.style.overflowY='auto';
  }
  function timelineFix(){
    const c=document.getElementById('ganttChartContainer');
    const t=c?.querySelector('.project-gantt');
    const w=c?.querySelector('.project-gantt-wrap');
    if(!c||!t||!w)return;
    const days=t.querySelectorAll('.gantt-day-col').length;
    const width=260+130+130+Math.max(1,days)*44;
    t.style.width=width+'px';
    t.style.minWidth=width+'px';
    t.style.maxWidth='none';
    w.style.width=width+'px';
    w.style.minWidth=width+'px';
    w.style.maxWidth='none';
    c.style.overflowX='auto';
    c.style.overflowY='auto';
  }
  function fix(){tableFix();timelineFix();}
  const oldTable=window.renderProjectsTable;
  if(typeof oldTable==='function'&&!oldTable.__v49Wrapped){
    const f=function(){const r=oldTable.apply(this,arguments);requestAnimationFrame(()=>requestAnimationFrame(tableFix));return r;};
    f.__v49Wrapped=true;window.renderProjectsTable=f;
  }
  const oldGantt=window.renderGanttChart;
  if(typeof oldGantt==='function'&&!oldGantt.__v49Wrapped){
    const f=function(){const r=oldGantt.apply(this,arguments);requestAnimationFrame(()=>requestAnimationFrame(timelineFix));return r;};
    f.__v49Wrapped=true;window.renderGanttChart=f;
  }
  document.addEventListener('DOMContentLoaded',()=>{fix();setTimeout(fix,300);setTimeout(fix,1000);},{once:true});
  window.addEventListener('resize',fix,{passive:true});
  window.fixProjectNativeHorizontalScroll=fix;
})();
