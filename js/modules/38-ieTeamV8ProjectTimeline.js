(function(){
'use strict';
const DAY=86400000;
const clean=v=>typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'').slice(0,10);
const esc8=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parse=v=>{const s=clean(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00');return Number.isNaN(d.getTime())?null:d;};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const monday=d=>addDays(new Date(d.getFullYear(),d.getMonth(),d.getDate()),-((d.getDay()+6)%7));
const monthStart=d=>new Date(d.getFullYear(),d.getMonth(),1);
const monthEnd=d=>new Date(d.getFullYear(),d.getMonth()+1,0);
function statusClass(s){const n=String(s||'Not Started').trim().toLowerCase();if(/complete|done|closed/.test(n))return'completed';if(/overdue|delay|stuck|block|risk/.test(n))return n.includes('stuck')?'stuck':'overdue';if(/watch|near/.test(n))return'watch';if(/working|progress|process/.test(n))return'working';if(/on track/.test(n))return'on-track';return'not-started';}
function ownerOf(x){return Array.isArray(x?.owners)?x.owners.join(', '):String(x?.owner||'').trim();}
function rangeOf(x,children=[]){const starts=[parse(x?.startDate),...children.map(r=>parse(r.s))].filter(Boolean),ends=[parse(x?.dueDate||x?.planDate),parse(x?.actualDate),...children.map(r=>parse(r.e))].filter(Boolean);return{s:starts.length?new Date(Math.min(...starts.map(d=>d.getTime()))):null,e:ends.length?new Date(Math.max(...ends.map(d=>d.getTime()))):null};}
function buildRows(){
 const src=typeof projectsList!=='undefined'&&Array.isArray(projectsList)?projectsList:[];const rows=[];
 src.forEach(p=>{
  if(!p||!String(p.name||'').trim())return;
  try{if(typeof projectMatchesSearch==='function'&&!projectMatchesSearch(p))return;}catch(_){}
  try{if(typeof normalizeProjectPhases==='function')p.phases=normalizeProjectPhases(p.phases,p);}catch(_){}
  try{if(typeof normalizeProjectTasks==='function')p.tasks=normalizeProjectTasks(p.tasks,p);}catch(_){}
  const child=[];
  (p.phases||[]).forEach((ph,pi)=>{let sum={};try{sum=typeof projectPhaseSummary==='function'?projectPhaseSummary(ph,p):{};}catch(_){}const pr=rangeOf({...ph,startDate:sum.startDate||ph.startDate,dueDate:sum.dueDate||ph.dueDate},[]);child.push(pr);});
  (p.tasks||[]).forEach(t=>child.push(rangeOf(t)));
  const pr=rangeOf(p,child);let ps=p.status||'Not Started';try{if(typeof calculateProjectOverallStatus==='function')ps=calculateProjectOverallStatus(p)||ps;}catch(_){}
  rows.push({type:'project',label:p.name,owner:ownerOf(p),status:ps,s:pr.s,e:pr.e,actual:parse(p.actualDate),detail:p.detail||''});
  (p.phases||[]).forEach((ph,pi)=>{let sum={};try{sum=typeof projectPhaseSummary==='function'?projectPhaseSummary(ph,p):{};}catch(_){}const tasks=Array.isArray(ph.tasks)?ph.tasks:[],rr=rangeOf({...ph,startDate:sum.startDate||ph.startDate,dueDate:sum.dueDate||ph.dueDate},tasks.map(t=>rangeOf(t)));rows.push({type:'phase',label:ph.name||`Phase ${pi+1}`,owner:sum.owner||ownerOf(ph),status:sum.status||'Not Started',s:rr.s,e:rr.e,actual:parse(sum.actualDate||ph.actualDate),detail:sum.detail||''});tasks.forEach(t=>{let st=t.status||'Not Started';try{if(typeof calculateProjectTaskStatus==='function')st=calculateProjectTaskStatus(t)||st;}catch(_){}const tr=rangeOf(t);rows.push({type:'task',label:t.name||'Task',owner:ownerOf(t),status:st,s:tr.s,e:tr.e,actual:parse(t.actualDate),detail:t.detail||''});});});
  (p.tasks||[]).forEach(t=>{let st=t.status||'Not Started';try{if(typeof calculateProjectTaskStatus==='function')st=calculateProjectTaskStatus(t)||st;}catch(_){}const tr=rangeOf(t);rows.push({type:'task',label:t.name||'Task',owner:ownerOf(t),status:st,s:tr.s,e:tr.e,actual:parse(t.actualDate),detail:t.detail||''});});
 });return rows;
}
function makeUnits(start,end,mode){const out=[];if(mode==='day'){for(let d=new Date(start);d<=end;d=addDays(d,1))out.push(new Date(d));}else if(mode==='week'){for(let d=monday(start);d<=end;d=addDays(d,7))out.push(new Date(d));}else{for(let d=monthStart(start);d<=end;d=new Date(d.getFullYear(),d.getMonth()+1,1))out.push(new Date(d));}return out;}
function renderV8Timeline(){
 const container=document.getElementById('ganttChartContainer');if(!container)return;
 const rows=buildRows();if(!rows.length){container.innerHTML='<div class="v8-gantt-empty"><div><i class="fa-regular fa-calendar-xmark"></i> No project timeline data.</div></div>';return;}
 const today=new Date();today.setHours(0,0,0,0);const dated=rows.flatMap(r=>[r.s,r.e,r.actual]).filter(Boolean);let start=new Date(Math.min(today.getTime(),...dated.map(d=>d.getTime()))),end=new Date(Math.max(today.getTime(),...dated.map(d=>d.getTime())));const rawDays=Math.max(1,Math.ceil((end-start)/DAY)+1);let mode='day',unit=34;if(rawDays>150&&rawDays<=900){mode='week';unit=52;start=monday(start);end=addDays(monday(end),6);}else if(rawDays>900){mode='month';unit=76;start=monthStart(start);end=monthEnd(end);}else{start=addDays(start,-2);end=addDays(end,2);}const units=makeUnits(start,end,mode),timeline=Math.max(220,units.length*unit),span=Math.max(DAY,end-start+DAY);const x=d=>Math.max(0,Math.min(timeline,(d-start)/span*timeline));const todayX=x(today);
 const axis=units.map(d=>{const weekend=mode==='day'&&(d.getDay()===0||d.getDay()===6);let a,b;if(mode==='day'){a=String(d.getDate());b=d.toLocaleDateString('en-US',{month:'short'});}else if(mode==='week'){a='W'+String(typeof getIsoWeekNumber==='function'?getIsoWeekNumber(iso(d)):'').padStart(2,'0');b=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}else{a=d.toLocaleDateString('en-US',{month:'short'});b=String(d.getFullYear());}return `<div class="v8-axis-unit ${weekend?'weekend':''}"><b>${esc8(a)}</b><small>${esc8(b)}</small></div>`;}).join('');
 const grid=`grid-template-columns:var(--c1) var(--c2) var(--c3) ${timeline}px;--unit:${unit}px`;
 let html=`<div class="v8-gantt"><div class="v8-gantt-row v8-gantt-head" style="${grid}"><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c1">Work item</div><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c2">Owner</div><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c3">Status</div><div class="v8-axis">${axis}<span class="v8-today" style="left:${todayX}px"></span></div></div>`;
 rows.forEach(r=>{const cls=statusClass(r.status),left=r.s?x(r.s):null,right=r.e?x(addDays(r.e,1)):null,bar=left!=null&&right!=null&&right>left?`<div class="v8-plan-bar ${cls}" style="left:${left}px;width:${Math.max(4,right-left)}px" title="${esc8(r.label)} | ${r.s?iso(r.s):'-'} → ${r.e?iso(r.e):'-'}${r.detail?' | '+esc8(r.detail):''}">${esc8(r.detail||r.label)}</div>`:'',actual=r.actual?`<span class="v8-actual-marker" style="left:${x(r.actual)}px" title="Actual: ${iso(r.actual)}"></span>`:'';html+=`<div class="v8-gantt-row v8-gantt-${r.type}" style="${grid}"><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c1 v8-gantt-name"><i class="fa-solid ${r.type==='project'?'fa-diagram-project':r.type==='phase'?'fa-layer-group':'fa-check'}"></i><span title="${esc8(r.label)}">${esc8(r.label)}</span></div><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c2 v8-gantt-owner" title="${esc8(r.owner||'-')}">${esc8(r.owner||'-')}</div><div class="v8-gantt-cell v8-gantt-sticky v8-gantt-c3 v8-gantt-status"><span class="v8-status ${cls}">${esc8(r.status||'Not Started')}</span></div><div class="v8-track">${bar}${actual}<span class="v8-today" style="left:${todayX}px"></span></div></div>`;});html+='</div>';container.innerHTML=html;
 requestAnimationFrame(()=>{const fixed=530;container.scrollLeft=Math.max(0,fixed+todayX-container.clientWidth*.58);});
}
window.renderGanttChart=renderV8Timeline;try{renderGanttChart=renderV8Timeline;}catch(_){}
const priorSetProjectView=window.setProjectView;if(typeof priorSetProjectView==='function'&&!priorSetProjectView.__v8){const wrapped=function(view){const result=priorSetProjectView.apply(this,arguments);if(view==='gantt')requestAnimationFrame(renderV8Timeline);return result;};wrapped.__v8=true;window.setProjectView=wrapped;try{setProjectView=wrapped;}catch(_){}}
})();
