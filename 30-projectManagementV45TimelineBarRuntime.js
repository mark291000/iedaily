(function(){
  'use strict';
  function alignTimelineBarsToRealDateHeader(){
    const container=document.getElementById('ganttChartContainer');
    const view=document.getElementById('projectGanttView');
    if(!container || !view || view.classList.contains('hidden')) return;
    const table=container.querySelector('.project-gantt');
    if(!table) return;
    const heads=Array.from(table.querySelectorAll('thead tr:nth-child(2) .gantt-date-head'));
    if(!heads.length) return;
    const dateMap=new Map();
    const headerPoints=[];
    heads.forEach((h,i)=>{
      const d=h.getAttribute('data-date');
      if(!d)return;
      const r=h.getBoundingClientRect();
      const item={date:d,left:r.left,right:r.right};
      dateMap.set(d,item);
      headerPoints.push(item);
    });
    if(!dateMap.size)return;
    const dayMs=86400000;
    const toMs=d=>{const t=Date.parse(String(d||'')+'T00:00:00');return Number.isFinite(t)?t:null;};
    const coordinateForDate=(d,edge)=>{
      const exact=dateMap.get(d);
      if(exact)return edge==='right'?exact.right:exact.left;
      const ms=toMs(d);
      if(ms==null || !headerPoints.length)return null;
      const first=headerPoints[0], last=headerPoints[headerPoints.length-1];
      const firstMs=toMs(first.date), lastMs=toMs(last.date);
      if(ms<firstMs){
        const width=Math.max(1,first.right-first.left);
        return first.left-((firstMs-ms)/dayMs)*width;
      }
      if(ms>lastMs){
        const width=Math.max(1,last.right-last.left);
        return last.left+((ms-lastMs)/dayMs)*width;
      }
      for(let i=0;i<headerPoints.length-1;i++){
        const a=headerPoints[i], b=headerPoints[i+1];
        const am=toMs(a.date), bm=toMs(b.date);
        if(ms>=am && ms<=bm){
          const ratio=(bm===am)?0:(ms-am)/(bm-am);
          return a.left+ratio*(b.left-a.left);
        }
      }
      return null;
    };
    const tracks=Array.from(table.querySelectorAll('tbody .gantt-row-track'));
    tracks.forEach(track=>{
      const tr=track.getBoundingClientRect();
      if(!tr.width)return;
      track.querySelectorAll('.gantt-bar-light').forEach(bar=>{
        const sd=bar.dataset.startDate, ed=bar.dataset.endDate;
        const leftAbs=coordinateForDate(sd,'left');
        const rightAbs=coordinateForDate(ed,'right');
        if(leftAbs==null || rightAbs==null)return;
        const left=leftAbs-tr.left;
        const right=rightAbs-tr.left;
        if(right<=left)return;
        bar.style.left=Math.max(0,left)+'px';
        bar.style.width=Math.max(2,Math.min(tr.width,right)-Math.max(0,left))+'px';
      });
      tracks.forEach(()=>{});
      track.querySelectorAll('.gantt-bar-dark').forEach(bar=>{
        const sd=bar.dataset.startDate, ed=bar.dataset.actualDate || bar.dataset.endDate;
        const leftAbs=coordinateForDate(sd,'left');
        const rightAbs=coordinateForDate(ed,'right');
        if(leftAbs==null || rightAbs==null)return;
        const left=leftAbs-tr.left;
        const right=rightAbs-tr.left;
        if(right<=left)return;
        bar.style.left=Math.max(0,left)+'px';
        bar.style.width=Math.max(2,Math.min(tr.width,right)-Math.max(0,left))+'px';
      });
    });
  }
  window.alignProjectTimelineBars=alignTimelineBarsToRealDateHeader;
  function schedule(){
    requestAnimationFrame(()=>requestAnimationFrame(alignTimelineBarsToRealDateHeader));
  }
  const old=window.renderGanttChart;
  if(typeof old==='function' && !old.__v45Wrapped){
    const wrapped=function(){
      const result=old.apply(this,arguments);
      schedule();
      return result;
    };
    wrapped.__v45Wrapped=true;
    window.renderGanttChart=wrapped;
  }
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('load',schedule,{once:true});
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
})();
