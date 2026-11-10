(function(){
  'use strict';
  const $=id=>document.getElementById(id);

  /* ===== 1) Overall: value labels on every chart ===== */
  const fmt=(v,d)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  const ovLabels={
    id:'pv6OvLabels',
    afterDatasetsDraw(chart){
      const id=chart.canvas&&chart.canvas.id||'';
      if(!/^ovC\d/.test(id)) return;
      const ctx=chart.ctx, type=chart.config.type;
      ctx.save();
      ctx.font='700 10px Inter, sans-serif';
      ctx.textAlign='center';
      if(type==='doughnut'||type==='pie'){
        const ds=chart.data.datasets[0]||{data:[]};
        const total=ds.data.reduce((a,b)=>a+(Number(b)||0),0);
        const meta=chart.getDatasetMeta(0);
        meta.data.forEach((el,i)=>{
          const v=Number(ds.data[i])||0; if(!v||meta.data[i].hidden) return;
          const p=el.tooltipPosition();
          ctx.fillStyle='#fff'; ctx.textBaseline='middle';
          ctx.fillText(fmt(v,0),p.x,p.y);
        });
        if(total){
          const a=chart.chartArea, cx=(a.left+a.right)/2, cy=(a.top+a.bottom)/2;
          ctx.fillStyle='#0f172a'; ctx.font='800 16px Inter, sans-serif'; ctx.fillText(fmt(total,0),cx,cy-5);
          ctx.fillStyle='#64748b'; ctx.font='700 9px Inter, sans-serif'; ctx.fillText('projects',cx,cy+10);
        }
      }else{
        const pct=id==='ovC2';
        chart.data.datasets.forEach((ds,di)=>{
          const meta=chart.getDatasetMeta(di); if(meta.hidden) return;
          meta.data.forEach((el,i)=>{
            const v=Number(ds.data[i])||0; if(!v) return;
            const d=pct?0:(Number.isInteger(v)?0:1);
            ctx.fillStyle='#334155'; ctx.textBaseline='bottom';
            ctx.fillText(fmt(v,d)+(pct?'%':''),el.x,el.y-3);
          });
        });
      }
      ctx.restore();
    }
  };
  if(window.Chart){
    try{ Chart.register(ovLabels); }catch(e){ console.warn('pv6 labels',e); }
    // extra head-room so labels above bars are not cut
    const padPlugin={id:'pv6OvPad',beforeInit(chart){ if(/^ovC\d/.test(chart.canvas?.id||'')){ chart.options.layout=chart.options.layout||{}; chart.options.layout.padding={top:16,right:4,left:2,bottom:0}; } }};
    try{ Chart.register(padPlugin); }catch(_){}
  }

  /* ===== 2) Project timeline: Today column, future = grey, status colours, auto-scroll ===== */
  const statusKey=s=>{
    s=String(s||'').toLowerCase();
    if(/complete|done|closed/.test(s)) return 'completed';
    if(/overdue|late|delay/.test(s)) return 'overdue';
    if(/near|deadline|due soon/.test(s)) return 'near';
    if(/stuck|hold|block/.test(s)) return 'stuck';
    if(/working|progress|on track/.test(s)) return 'working';
    return 'not';
  };
  const LIGHT={completed:'#bbf7d0',working:'#bfdbfe',overdue:'#fecaca',near:'#fef08a',stuck:'#fed7aa',not:'#e2e8f0'};
  const FUTURE='#d1d5db';
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let scrollPending=true;

  function enhanceGantt(){
    const box=$('ganttChartContainer'); if(!box) return;
    const table=box.querySelector('table.project-gantt'); if(!table||!table.offsetWidth) return;
    const todayLine=table.querySelector('.project-gantt-today-line');
    const dayW=parseFloat(getComputedStyle(table).getPropertyValue('--gantt-day-width'))||44;
    const today=ymd(new Date());
    table.querySelectorAll('th.gantt-date-head').forEach(th=>th.classList.toggle('pv6-today-head',th.dataset.date===today));

    // Today column across every row
    table.querySelector('.pv6-today-col')?.remove();
    let todayX=null;
    if(todayLine){
      todayX=parseFloat(todayLine.style.left)||todayLine.offsetLeft;
      const col=document.createElement('div');
      col.className='pv6-today-col';
      col.style.left=todayX+'px'; col.style.width=dayW+'px';
      col.style.height=table.offsetHeight+'px';
      col.title='Today';
      table.appendChild(col);
    }

    // Each row: status pill + bar colours, part after today in grey
    table.querySelectorAll('tbody tr').forEach(tr=>{
      const cell=tr.querySelector('.gantt-status-cell');
      const text=cell?cell.textContent.trim():'';
      const k=statusKey(text);
      if(cell&&!cell.querySelector('.pv6-st')) cell.innerHTML=`<span class="pv6-st st-${k}">${cell.textContent.trim()||'-'}</span>`;
      const track=tr.querySelector('.gantt-row-track'); if(!track) return;
      const trackLeft=track.getBoundingClientRect().left-table.getBoundingClientRect().left;
      const todayInTrack=todayX==null?null:todayX-trackLeft+dayW;   // end of today
      track.querySelectorAll('.gantt-bar-dark').forEach(b=>{
        b.classList.remove('pv6-c-completed','pv6-c-working','pv6-c-overdue','pv6-c-near','pv6-c-stuck','pv6-c-not');
        b.classList.add('pv6-c-'+k);
      });
      track.querySelectorAll('.gantt-bar-light').forEach(b=>{
        const left=parseFloat(b.style.left)||0, w=parseFloat(b.style.width)||b.offsetWidth||1;
        const light=LIGHT[k];
        if(k==='completed'||todayInTrack==null){ b.style.setProperty('background',light,'important'); return; }
        const cut=Math.max(0,Math.min(100,(todayInTrack-left)/w*100));
        b.style.setProperty('background',`linear-gradient(to right, ${light} 0%, ${light} ${cut}%, ${FUTURE} ${cut}%, ${FUTURE} 100%)`,'important');
      });
    });

    if(scrollPending&&todayX!=null){
      let sc=box;
      while(sc&&sc!==document.body&&!(sc.scrollWidth>sc.clientWidth+2&&/(auto|scroll)/.test(getComputedStyle(sc).overflowX))) sc=sc.parentElement;
      if(sc&&sc!==document.body){
        const frozen=(table.querySelector('col.gantt-project-col')?.getBoundingClientRect().width||260)
          +(table.querySelector('col.gantt-owner-col')?.getBoundingClientRect().width||130)
          +(table.querySelector('col.gantt-status-col')?.getBoundingClientRect().width||130);
        const target=Math.max(0,todayX-frozen-(sc.clientWidth-frozen)/2);
        sc.scrollLeft=target;
        sc.dispatchEvent(new Event('scroll'));
        scrollPending=false;
      }
    }
  }
  let q=0; const schedule=()=>{cancelAnimationFrame(q);q=requestAnimationFrame(()=>requestAnimationFrame(enhanceGantt));};

  function hookGantt(){
    const g=window.renderGanttChart;
    if(typeof g==='function'&&!g.__pv6){
      const w=function(){const r=g.apply(this,arguments);schedule();return r;};
      w.__pv6=true; window.renderGanttChart=w;
      try{(0,eval)('renderGanttChart = window.renderGanttChart;');}catch(_){}
    }
    const sw=window.switchTab;
    if(typeof sw==='function'&&!sw.__pv6){
      const w=function(id){if(id==='projects')scrollPending=true;const r=sw.apply(this,arguments);if(id==='projects')schedule();return r;};
      w.__pv6=true; window.switchTab=w;
      try{(0,eval)('switchTab = window.switchTab;');}catch(_){}
    }
  }
  // When the user opens the Timeline view, scroll to today again.
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a'); if(!b) return;
    if(/gantt|timeline/i.test((b.id||'')+' '+(b.getAttribute('onclick')||'')+' '+b.textContent)){ scrollPending=true; schedule(); }
  },true);
  // Keep the band height right after expand/collapse.
  const mo=new MutationObserver(m=>{ if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&n.tagName==='TABLE'))) schedule(); });
  function init(){ hookGantt(); const box=$('ganttChartContainer'); if(box) mo.observe(box,{childList:true}); schedule(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
