(function(){
  'use strict';
  const TABLE_MIN_WIDTH=1500;
  const GANTT_DAY_WIDTH=44;
  let tableObserver=null;
  let tableResizeObserver=null;
  let tableSyncQueued=false;
  let ganttSyncQueued=false;

  function tableParts(){
    const view=document.getElementById('projectTableView');
    if(!view)return {};
    return {
      view,
      host:document.getElementById('projectsTableBody'),
      wrap:view.querySelector('.pm-shared-table-wrap'),
      table:view.querySelector('.pm-shared-project-table'),
      bar:document.getElementById('projectTableBottomScroll'),
      inner:document.getElementById('projectTableBottomScroll')?.firstElementChild
    };
  }

  function syncTableScroll(){
    tableSyncQueued=false;
    const {view,host,wrap,table,bar,inner}=tableParts();
    if(!view||!host||!wrap||!table||!bar||!inner)return;

    /* The real table is the source of the horizontal scroll position. */
    table.style.width='max-content';
    table.style.minWidth=TABLE_MIN_WIDTH+'px';
    table.style.maxWidth='none';
    table.style.transform='none';

    const contentWidth=Math.max(TABLE_MIN_WIDTH,table.scrollWidth,table.offsetWidth,wrap.scrollWidth);
    inner.style.width=contentWidth+'px';
    inner.style.minWidth=contentWidth+'px';

    if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>1) bar.scrollLeft=wrap.scrollLeft;

    if(bar.dataset.v47Bound!=='1'){
      bar.dataset.v47Bound='1';
      bar.addEventListener('scroll',function(){
        if(Math.abs(wrap.scrollLeft-bar.scrollLeft)>0.5) wrap.scrollLeft=bar.scrollLeft;
      },{passive:true});
      wrap.addEventListener('scroll',function(){
        if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>0.5) bar.scrollLeft=wrap.scrollLeft;
      },{passive:true});
      bar.addEventListener('wheel',function(e){
        if(Math.abs(e.deltaY)>Math.abs(e.deltaX) && contentWidth>bar.clientWidth){
          bar.scrollLeft+=e.deltaY;
          e.preventDefault();
        }
      },{passive:false});
    }
  }

  function queueTableSync(){
    if(tableSyncQueued)return;
    tableSyncQueued=true;
    requestAnimationFrame(syncTableScroll);
  }

  function forceTimelineHorizontal(){
    ganttSyncQueued=false;
    const container=document.getElementById('ganttChartContainer');
    const view=document.getElementById('projectGanttView');
    if(!container||!view||view.classList.contains('hidden'))return;
    const table=container.querySelector('.project-gantt');
    const wrap=container.querySelector('.project-gantt-wrap');
    if(!table||!wrap)return;

    const dateCols=Array.from(table.querySelectorAll('thead tr:nth-child(2) .gantt-date-head'));
    if(!dateCols.length)return;

    const identityWidth=260+130+130;
    const timelineWidth=dateCols.length*GANTT_DAY_WIDTH;
    const totalWidth=identityWidth+timelineWidth;

    /* Override the renderer's viewport-sized layout with a real wide canvas. */
    table.style.width=totalWidth+'px';
    table.style.minWidth=totalWidth+'px';
    table.style.maxWidth='none';
    table.style.tableLayout='fixed';
    table.style.setProperty('--gantt-day-width',GANTT_DAY_WIDTH+'px');
    wrap.style.width=totalWidth+'px';
    wrap.style.minWidth=totalWidth+'px';
    wrap.style.maxWidth='none';

    table.querySelectorAll('.gantt-project-col').forEach(c=>{c.style.width='260px';c.style.minWidth='260px';c.style.maxWidth='260px';});
    table.querySelectorAll('.gantt-owner-col').forEach(c=>{c.style.width='130px';c.style.minWidth='130px';c.style.maxWidth='130px';});
    table.querySelectorAll('.gantt-status-col').forEach(c=>{c.style.width='130px';c.style.minWidth='130px';c.style.maxWidth='130px';});
    table.querySelectorAll('.gantt-day-col').forEach(c=>{c.style.width=GANTT_DAY_WIDTH+'px';c.style.minWidth=GANTT_DAY_WIDTH+'px';c.style.maxWidth=GANTT_DAY_WIDTH+'px';});

    table.querySelectorAll('.gantt-row-track').forEach(track=>{
      track.style.width=timelineWidth+'px';
      track.style.minWidth=timelineWidth+'px';
      track.style.maxWidth=timelineWidth+'px';
      track.style.setProperty('--timeline-width',timelineWidth+'px');
      track.style.setProperty('--pm-grid-day-width',GANTT_DAY_WIDTH+'px');
    });

    /* Re-run the existing geometry helpers after the real widths are applied. */
    requestAnimationFrame(()=>{
      if(typeof window.alignProjectTimelineGrid==='function')window.alignProjectTimelineGrid();
      if(typeof window.alignProjectTimelineBars==='function')window.alignProjectTimelineBars();
    });
  }

  function queueGanttSync(){
    if(ganttSyncQueued)return;
    ganttSyncQueued=true;
    requestAnimationFrame(forceTimelineHorizontal);
  }

  function bindObservers(){
    const host=document.getElementById('projectsTableBody');
    if(host && !tableObserver){
      requestAnimationFrame(queueTableSync);
    }
    const wrap=tableParts().wrap;
    if(wrap && !tableResizeObserver && typeof ResizeObserver==='function'){
      tableResizeObserver=new ResizeObserver(queueTableSync);
      tableResizeObserver.observe(wrap);
    }
  }

  /* Expose the same API name used by older fixes, but point it to the real sync. */
  window.syncProjectBottomScroll=syncTableScroll;
  window.syncProjectTableScroll=syncTableScroll;
  window.syncProjectHorizontalScroll=syncTableScroll;
  window.forceProjectTimelineHorizontal=forceTimelineHorizontal;

  document.addEventListener('DOMContentLoaded',function(){
    bindObservers();
    queueTableSync();
    queueGanttSync();
    setTimeout(()=>{bindObservers();queueTableSync();queueGanttSync();},100);
    setTimeout(()=>{queueTableSync();queueGanttSync();},500);
  },{once:true});

  window.addEventListener('load',function(){
    bindObservers();
    queueTableSync();
    queueGanttSync();
  },{once:true});

  window.addEventListener('resize',function(){
    queueTableSync();
    queueGanttSync();
  },{passive:true});

  /* Catch view switching/rendering without replacing the app's existing functions. */
  const originalRenderGantt=window.renderGanttChart;
  if(typeof originalRenderGantt==='function'&&!originalRenderGantt.__v47Wrapped){
    const wrapped=function(){
      const result=originalRenderGantt.apply(this,arguments);
      setTimeout(queueGanttSync,0);
      setTimeout(queueGanttSync,80);
      setTimeout(queueGanttSync,250);
      return result;
    };
    wrapped.__v47Wrapped=true;
    window.renderGanttChart=wrapped;
  }

  const originalRenderTable=window.renderProjectsTable;
  if(typeof originalRenderTable==='function'&&!originalRenderTable.__v47Wrapped){
    const wrapped=function(){
      const result=originalRenderTable.apply(this,arguments);
      setTimeout(()=>{bindObservers();queueTableSync();},0);
      setTimeout(queueTableSync,80);
      return result;
    };
    wrapped.__v47Wrapped=true;
    window.renderProjectsTable=wrapped;
  }
})();
