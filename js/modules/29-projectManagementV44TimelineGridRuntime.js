(function(){
  'use strict';
  /* Reposition Timeline grid lines from the actual rendered date-header
     boundaries, rather than calculated widths. This keeps every vertical
     dotted line exactly under its corresponding date column. */
  function alignTimelineGridLines(){
    const container=document.getElementById('ganttChartContainer');
    if(!container || !document.getElementById('projectGanttView') || document.getElementById('projectGanttView').classList.contains('hidden')) return;
    const heads=Array.from(container.querySelectorAll('.project-gantt thead tr:nth-child(2) .gantt-date-head'));
    if(heads.length<2)return;
    const tracks=Array.from(container.querySelectorAll('.project-gantt tbody .gantt-row-track'));
    if(!tracks.length)return;
    const headRects=heads.map(h=>h.getBoundingClientRect());
    tracks.forEach(track=>{
      const tr=track.getBoundingClientRect();
      if(!tr.width)return;
      track.querySelectorAll('.gantt-grid-vline').forEach(el=>el.remove());
      for(let i=0;i<headRects.length-1;i++){
        const x=headRects[i].right-tr.left;
        if(x<=0 || x>=tr.width)continue;
        const line=document.createElement('span');
        line.className='gantt-grid-vline';
        line.style.left=Math.round(x*100)/100+'px';
        track.appendChild(line);
      }
    });
  }
  window.alignProjectTimelineGrid=alignTimelineGridLines;

  function scheduleAlign(){
    requestAnimationFrame(()=>requestAnimationFrame(alignTimelineGridLines));
  }

  const oldRender=window.renderGanttChart;
  if(typeof oldRender==='function' && !oldRender.__v44Wrapped){
    const wrapped=function(){
      const result=oldRender.apply(this,arguments);
      scheduleAlign();
      return result;
    };
    wrapped.__v44Wrapped=true;
    window.renderGanttChart=wrapped;
  }
  window.addEventListener('resize',scheduleAlign,{passive:true});
  window.addEventListener('load',scheduleAlign,{once:true});
  document.addEventListener('DOMContentLoaded',scheduleAlign,{once:true});
})();
