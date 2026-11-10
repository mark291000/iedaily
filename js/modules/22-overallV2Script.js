(function(){
  if(window.Chart){ try{ Chart.defaults.animation=false; Chart.defaults.animations={}; Chart.defaults.transitions.active.animation.duration=0; Chart.defaults.font.family="Inter,sans-serif"; Chart.defaults.maintainAspectRatio=false; }catch(_){} }
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const N=v=>String(v||'').trim().toLowerCase();
  const D=v=>{if(!v)return null;const d=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(d)?null:d;};
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hidden=n=>typeof window.isHiddenMember==='function'&&window.isHiddenMember(n);
  const charts={};
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const PAL=['#1d4ed8','#0891b2','#059669','#7c3aed','#d97706','#db2777','#475569','#0f766e','#9333ea','#ea580c'];
  const S={y:new Date().getFullYear(),m:'',w:'',team:''};
  function mondayOf(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
  function weeksOf(y,m){ // weeks (Mon-Sun) touching the year or the month
    const s=m===''?new Date(y,0,1):new Date(y,+m,1), e=m===''?new Date(y,11,31):new Date(y,+m+1,0);
    const out=[];for(let a=mondayOf(s);a<=e;a.setDate(a.getDate()+7)){const b=new Date(a);b.setDate(a.getDate()+6);out.push({s:new Date(a),e:b});}
    return out;
  }
  function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/864e5+1)/7);}
  function period(){
    if(S.w!==''){const w=weeksOf(S.y,S.m)[+S.w];if(w){const e=new Date(w.e);e.setHours(23,59,59);return{s:w.s,e,mode:'week',wd:5};}}
    if(S.m!==''){const s=new Date(S.y,+S.m,1),e=new Date(S.y,+S.m+1,0,23,59,59);return{s,e,mode:'month',wd:workdays(s,e)};}
    const s=new Date(S.y,0,1),e=new Date(S.y,11,31,23,59,59);return{s,e,mode:'year',wd:workdays(s,e)};
  }
  function workdays(s,e){let n=0;for(const d=new Date(s);d<=e;d.setDate(d.getDate()+1)){const k=d.getDay();if(k&&k!==6)n++;}return n;}
  function fillFilters(){
    const yNow=new Date().getFullYear();const yrs=new Set([yNow-1,yNow,yNow+1,...(window.__taskYearUniverse||[]).map(Number).filter(Boolean)]);
    $('ovYear').innerHTML=[...yrs].sort().map(y=>`<option ${y===S.y?'selected':''}>${y}</option>`).join('');
    $('ovMonth').innerHTML='<option value="">All</option>'+MONTHS.map((m,i)=>`<option value="${i}" ${String(i)===String(S.m)?'selected':''}>${m}</option>`).join('');
    $('ovWeek').innerHTML='<option value="">All</option>'+weeksOf(S.y,S.m).map((w,i)=>`<option value="${i}" ${String(i)===String(S.w)?'selected':''}>W${String(isoWeek(w.s)).padStart(2,'0')} · ${w.s.getDate()}/${w.s.getMonth()+1}-${w.e.getDate()}/${w.e.getMonth()+1}</option>`).join('');
  }
  const overlaps=(a,b,p)=>{const s=D(a),e=D(b)||s;return !!s&&s<=p.e&&e>=p.s;};
  function reqHours(o,p){const s=D(o.startDate),e=D(o.endDate)||s;if(!s)return 0;const total=Math.max(1,workdays(s,e));const inside=workdays(new Date(Math.max(s,p.s)),new Date(Math.min(e,p.e)));const h=Number(o.hours)||total*8;return h*inside/total;}
  const isOT=o=>/overtime|\bot\b/i.test(o.type||''), isOff=o=>!isOT(o)&&/off|leave|vacation|absen/i.test(o.type||'');
  const done=t=>!!t.actual||/complete|done|closed/i.test(t.status||'');
  function projHealth(p,today){if(/complete|done|closed/i.test(p.status||'')||Number(p.progress)>=100)return'Completed';const due=D(p.dueDate);if(/hold|block|overdue|delay/i.test(p.status||'')||(due&&due<today))return'At risk';if(due&&(due-today)<14*864e5&&Number(p.progress)<70)return'Watch';return'On track';}
  function draw(id,cfg){if(charts[id]){charts[id].destroy();}const c=$(id);if(c&&window.Chart)charts[id]=new Chart(c,cfg);}
  const axis=(suffix='')=>({x:{grid:{display:false},ticks:{font:{size:10},autoSkip:false,maxRotation:35}},y:{beginAtZero:true,grid:{color:'#eef2f7'},ticks:{font:{size:10},callback:v=>v+suffix}}});

  function render(){
    const tab=$('tab-overall'); if(window.__overallV7Active||!tab||tab.classList.contains('hidden')) return;
    fillFilters();
    const p=period(), today=new Date(); today.setHours(0,0,0,0);
    const U=(typeof users!=='undefined'?users:[]).filter(u=>N(u.status)==='active'&&u.role!=='Viewer'&&u.show!==false);
    const T=(typeof dailyTasks!=='undefined'?dailyTasks:[]), R=(typeof timeoffOtList!=='undefined'?timeoffOtList:[]), P=(typeof projectsList!=='undefined'?projectsList:[]);
    const teamOf=x=>String(x.team||'').trim()||'Unassigned';
    const allTeams=[...new Set([...U,...T,...P].map(teamOf))].filter(t=>t!=='Unassigned'||T.some(x=>!x.team)).sort();
    const ts=$('ovTeam'); ts.innerHTML='<option value="">All teams</option>'+allTeams.map(t=>`<option ${t===S.team?'selected':''}>${esc(t)}</option>`).join('');
    const inTeam=x=>!S.team||teamOf(x)===S.team;
    const u=U.filter(inTeam);
    const t=T.filter(inTeam).filter(x=>{const pics=(x.pics||[]).filter(Boolean);return !pics.length||pics.some(n=>!hidden(n));});
    const tP=t.filter(x=>overlaps(x.start||x.plan,x.actual||x.plan||x.start,p));
    const r=R.filter(inTeam).filter(x=>!hidden(x.pic)&&overlaps(x.startDate,x.endDate,p));
    const pr=P.filter(inTeam);
    const hrs=x=>Number(x.usageTime)||0;
    const cap=n=>n*p.wd*8;
    const teams=S.team?[S.team]:allTeams;
    const rows=teams.map(tm=>{
      const uu=u.filter(x=>teamOf(x)===tm),tt=tP.filter(x=>teamOf(x)===tm),rr=r.filter(x=>teamOf(x)===tm),pp=pr.filter(x=>teamOf(x)===tm);
      const h=tt.reduce((a,x)=>a+hrs(x),0),c=cap(uu.length),util=c?h/c*100:0;
      const ot=rr.filter(isOT).reduce((a,x)=>a+reqHours(x,p),0),off=rr.filter(isOff).reduce((a,x)=>a+reqHours(x,p),0);
      const open=tt.filter(x=>!done(x)).length, od=T.filter(x=>teamOf(x)===tm&&!done(x)&&D(x.plan)&&D(x.plan)<today).length;
      const risk=pp.filter(x=>projHealth(x,today)==='At risk').length;
      let hl='g',lbl='On track',act='Maintain cadence';
      if(od>5||risk||util>110||(uu.length&&ot/uu.length>p.wd*1.5)){hl='r';lbl='Action';act=risk?`Escalate ${risk} project(s)`:od>5?`Recover ${od} overdue task(s)`:util>110?'Rebalance workload':'Review OT drivers';}
      else if(od||util>95||(util<50&&uu.length)){hl='a';lbl='Monitor';act=od?`Close ${od} overdue`:util>95?'Hold new demand':'Check data / allocation';}
      return{tm,hc:uu.length,h,c,util,ot,off,open,od,risk,hl,lbl,act};
    });
    const sum=k=>rows.reduce((a,x)=>a+x[k],0);
    const HC=sum('hc'),H=sum('h'),C=sum('c'),UT=C?H/C*100:0,OT=sum('ot'),OFF=sum('off'),OD=sum('od'),OPEN=sum('open');
    const health=pr.map(x=>projHealth(x,today));const act=health.filter(x=>x!=='Completed').length,risk=health.filter(x=>x==='At risk').length;
    const pLabel=p.mode==='week'?`Week ${isoWeek(p.s)} (${ymd(p.s)} → ${ymd(p.e)})`:p.mode==='month'?`${MONTHS[+S.m]} ${S.y}`:`Year ${S.y}`;
    $('ovScope').textContent=`${S.team||'All teams'} · ${pLabel} · ${p.wd} working days`+((typeof getViewTeam==='function'&&window.TEAM_ALL&&getViewTeam()!==window.TEAM_ALL)?' · sidebar is filtered to one team':'');
    const F2=(v,d=0)=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
    const K=[['Headcount',F2(HC),`${allTeams.length} teams`,'#1d4ed8'],['Utilization',UT.toFixed(0)+'%',`${F2(H)} / ${F2(C)} h`,UT>110?'#dc2626':UT>95?'#d97706':'#059669'],
      ['Overtime',F2(OT,1)+'h',`${HC?(OT/HC).toFixed(1):0} h / person`,'#d97706'],['Time off',F2(OFF,1)+'h',`${(OFF/8).toFixed(1)} man-days`,'#7c3aed'],
      ['Open tasks',F2(OPEN),`${tP.length} tasks in period`,'#0891b2'],['Overdue',F2(OD),'open past plan date',OD?'#dc2626':'#059669'],
      ['Active projects',act,`${pr.length} total`,'#0f766e'],['Projects at risk',risk,`${health.filter(x=>x==='Watch').length} on watch`,risk?'#dc2626':'#059669']];
    $('ovKpis').innerHTML=K.map(k=>`<div class="ov-k" style="--c:${k[3]}"><span>${k[0]}</span><b style="color:${k[3]}">${k[1]}</b><i>${k[2]}</i></div>`).join('');
    const L=rows.map(x=>x.tm);
    draw('ovC1',{type:'bar',data:{labels:L,datasets:[{data:rows.map(x=>x.hc),backgroundColor:L.map((_,i)=>PAL[i%PAL.length]),borderRadius:5,maxBarThickness:34}]},options:{plugins:{legend:{display:false}},scales:axis()}});
    draw('ovC2',{type:'bar',data:{labels:L,datasets:[{data:rows.map(x=>+x.util.toFixed(1)),backgroundColor:rows.map(x=>x.util>110?'#dc2626':x.util>95?'#d97706':x.util<50?'#94a3b8':'#059669'),borderRadius:5,maxBarThickness:34}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.parsed.y}% (${rows[c.dataIndex].h.toFixed(0)} / ${rows[c.dataIndex].c.toFixed(0)} h)`}}},scales:axis('%')}});
    let B=[];
    if(p.mode==='year')B=MONTHS.map((m,i)=>({l:m,s:new Date(S.y,i,1),e:new Date(S.y,i+1,0,23,59,59)}));
    else if(p.mode==='month')B=weeksOf(S.y,S.m).map(w=>({l:'W'+isoWeek(w.s),s:w.s,e:new Date(w.e.getFullYear(),w.e.getMonth(),w.e.getDate(),23,59,59)}));
    else for(let i=0;i<7;i++){const d=new Date(p.s);d.setDate(d.getDate()+i);B.push({l:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],s:d,e:new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59)});}
    const RA=R.filter(inTeam).filter(x=>!hidden(x.pic));
    const ser=f=>B.map(b=>+RA.filter(f).filter(x=>overlaps(x.startDate,x.endDate,b)).reduce((a,x)=>a+reqHours(x,b),0).toFixed(1));
    $('ovC3s').textContent=p.mode==='year'?'by month':p.mode==='month'?'by week':'by day';
    draw('ovC3',{type:'bar',data:{labels:B.map(b=>b.l),datasets:[{label:'Overtime',data:ser(isOT),backgroundColor:'#f59e0b',borderRadius:4},{label:'Time off',data:ser(isOff),backgroundColor:'#8b5cf6',borderRadius:4}]},options:{plugins:{legend:{position:'bottom',labels:{boxWidth:8,font:{size:10}}}},scales:axis()}});
    const HL=['On track','Watch','At risk','Completed'];
    draw('ovC4',{type:'doughnut',data:{labels:HL,datasets:[{data:HL.map(h=>health.filter(x=>x===h).length),backgroundColor:['#059669','#f59e0b','#dc2626','#2563eb'],borderWidth:0}]},options:{cutout:'62%',plugins:{legend:{position:'right',labels:{boxWidth:8,font:{size:10}}}}}});
    const ord={r:0,a:1,g:2};
    const F=(v,d=0)=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
    $('ovTeamBody').innerHTML=rows.length?rows.slice().sort((a,b)=>ord[a.hl]-ord[b.hl]||b.od-a.od).map(x=>{const col=x.util>110?'#dc2626':x.util>95?'#d97706':x.util<50?'#94a3b8':'#059669';return `<tr><td><b>${esc(x.tm)}</b></td><td class="num">${F(x.hc)}</td><td class="num"><div style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:120px"><div class="ov-bar" style="flex:0 1 80px"><div style="width:${Math.min(100,x.util)}%;background:${col}"></div></div><b style="color:${col};min-width:34px;text-align:right">${F(x.util)}%</b></div></td><td class="num">${F(x.h)}</td><td class="num">${F(x.ot,1)}</td><td class="num">${F(x.off,1)}</td><td class="num">${F(x.open)}</td><td class="num" style="${x.od?'color:#dc2626;font-weight:800':''}">${F(x.od)}</td><td class="num" style="${x.risk?'color:#dc2626;font-weight:800':''}">${F(x.risk)}</td><td><span class="ov-b ${x.hl}">${x.lbl}</span></td><td>${esc(x.act)}</td></tr>`;}).join(''):'<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>';
    const risks=[];
    const top=rows.filter(x=>x.hl==='r');
    if(OD)risks.push(['r','Overdue tasks',`${OD} open task(s) past plan date${top.length?' — mainly '+top.slice(0,3).map(x=>x.tm).join(', '):''}.`,'Assign recovery dates this week.']);
    if(risk)risks.push(['r','Projects at risk',`${risk} project(s) overdue / blocked.`,'Sponsor review and recovery plan.']);
    const over=rows.filter(x=>x.util>110);if(over.length)risks.push(['a','Capacity overload',over.map(x=>`${x.tm} ${x.util.toFixed(0)}%`).join(', '),'Rebalance or defer new demand.']);
    const low=rows.filter(x=>x.hc&&x.util<50);if(low.length)risks.push(['a','Low recorded utilization',low.map(x=>`${x.tm} ${x.util.toFixed(0)}%`).join(', '),'Check task logging or reallocate.']);
    if(HC&&OT/HC>p.wd*1.5)risks.push(['a','High overtime',`${(OT/HC).toFixed(1)} OT h per person.`,'Review OT root causes.']);
    if(!risks.length)risks.push(['g','No critical exception','All teams within thresholds for this period.','Keep weekly review.']);
    $('ovRisks').innerHTML=risks.map(x=>`<div class="ov-risk ${x[0]}"><div><b>${esc(x[1])}</b><div>${esc(x[2])}</div><div style="font-weight:700;margin-top:2px">→ ${esc(x[3])}</div></div></div>`).join('');
  }
  let rq=0;const schedule=()=>{cancelAnimationFrame(rq);rq=requestAnimationFrame(render);};
  window.renderOverallDashboard=schedule;
  function bind(){
    if(!$('ovYear')) return;
    $('ovYear').addEventListener('change',e=>{S.y=+e.target.value;S.w='';schedule();});
    $('ovMonth').addEventListener('change',e=>{S.m=e.target.value;S.w='';schedule();});
    $('ovWeek').addEventListener('change',e=>{S.w=e.target.value;schedule();});
    $('ovTeam').addEventListener('change',e=>{S.team=e.target.value;schedule();});
    $('ovNow').addEventListener('click',()=>{const d=new Date();S.y=d.getFullYear();S.m=String(d.getMonth());const ws=weeksOf(S.y,S.m);const m=mondayOf(d).getTime();S.w=String(Math.max(0,ws.findIndex(w=>w.s.getTime()===m)));schedule();});
    let rt=0;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{Object.values(charts).forEach(c=>c.resize());},150);},{passive:true});
  }
  // hook: render after tab switch and after every data refresh
  function hook(){
    const sw=window.switchTab;
    if(typeof sw==='function'&&!sw.__ov){const w=function(id){const r=sw.apply(this,arguments);if(id==='overall')schedule();return r;};w.__ov=true;window.switchTab=w;try{switchTab=w;}catch(_){}}
    const f=window.fetchAllDataFromSheet;
    if(typeof f==='function'&&!f.__ov){const w=async function(){const r=await f.apply(this,arguments);window.invalidateHiddenMembers?.();schedule();return r;};w.__ov=true;window.fetchAllDataFromSheet=w;try{fetchAllDataFromSheet=w;}catch(_){}}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bind();hook();},{once:true});else{bind();hook();}
})();
