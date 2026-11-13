(window.__appFiles=window.__appFiles||{})['46-projectExportV2']='1.4.1';
/* =====================================================================
   PROJECT EXPORT V2 - Excel / PDF in the NEW Project Management format
   Columns = the current project table:
   Project name | Owner | Start | Plan Completed | Actual | Status |
   Current Stage | %Progress | Archived goal | Saving (if have) | Key Project
   Export follows the current search + column filters (what is on screen).
   ===================================================================== */
(function(){
'use strict';
const W=window;
/* Same columns (and order) as the Project Management table on screen; Action column is not exported. */
const COLS=['Project name','Owner','Start','Plan Completed','Actual','Status','Current Stage','%Progress','Archived goal','Saving','Key Project'];
const HEAD={'Saving':'Saving (if have)'};
const DATE_COLS=new Set(['Start','Plan Completed','Actual']);
const STATUS_COLORS={completed:['DCFCE7','166534'],done:['DCFCE7','166534'],working:['DBEAFE','1E40AF'],'working on it':['DBEAFE','1E40AF'],'in progress':['DBEAFE','1E40AF'],overdue:['FEE2E2','991B1B'],stuck:['FEE2E2','991B1B'],'not started':['F1F5F9','475569']};
const statusColor=s=>STATUS_COLORS[String(s||'').trim().toLowerCase()]||['F8FAFC','334155'];
const fmtDate=v=>{const s=typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'');if(!s)return '';const [y,m,d]=s.split('-');return y&&m&&d?`${m}/${d}/${y}`:s;};
const money=v=>v===''||v==null||!isFinite(Number(v))?'':'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:0});
const today=()=>new Date().toISOString().slice(0,10);

/* Rows = projects visible in the table (search + column filters), read from the LIVE projectsList. */
function rows(){
  let list=[];
  try{list=(typeof getVisibleProjectExportRows==='function'?getVisibleProjectExportRows():W.getVisibleProjectExportRows?.())||[];}catch(e){console.error('Project export rows failed',e);}
  if(!list.length){ /* fallback: no filter helpers available -> all projects of the live list */
    const src=typeof projectsList!=='undefined'&&Array.isArray(projectsList)?projectsList:[];
    list=src.map(p=>({'Project name':p.name||'',Owner:(Array.isArray(p.owners)&&p.owners.length?p.owners.join(', '):p.owner)||'',Start:cleanDateStr(p.startDate)||'','Plan Completed':cleanDateStr(p.dueDate)||'',Actual:cleanDateStr(p.actualDate)||'',Status:p.status||'','Current Stage':p.currentStage||'','%Progress':Number(p.progress)||0,'Archived goal':p.archivedGoal||p.detailedStatus||'',Saving:(p.actualSaving||p.saving||''),'Key Project':p.keyProject===false?'No':'Yes'}));
  }
  return list.filter(r=>String(r['Project name']||'').trim());
}
/* Summary statistics shown above the table (PDF cards / Excel block) */
function stats(data){
  const cnt=k=>data.filter(r=>String(r.Status||'').trim().toLowerCase()===k).length;
  const avg=data.length?Math.round(data.reduce((a,r)=>a+(Number(r['%Progress'])||0),0)/data.length):0;
  return [
    {label:'Total projects',value:String(data.length),num:data.length,fg:'315C7A',bg:'E8F0F6'},
    {label:'Working',value:String(cnt('working')),num:cnt('working'),fg:'1E40AF',bg:'DBEAFE'},
    {label:'Completed',value:String(cnt('completed')),num:cnt('completed'),fg:'166534',bg:'DCFCE7'},
    {label:'Overdue',value:String(cnt('overdue')),num:cnt('overdue'),fg:'991B1B',bg:'FEE2E2'},
    {label:'Not Started',value:String(cnt('not started')),num:cnt('not started'),fg:'475569',bg:'F1F5F9'},
    {label:'Key Projects',value:String(data.filter(r=>r['Key Project']==='Yes').length),num:data.filter(r=>r['Key Project']==='Yes').length,fg:'B45309',bg:'FEF3C7'},
    {label:'Avg. %Progress',value:avg+'%',num:avg/100,fmt:'0%',fg:'2563EB',bg:'DBEAFE'},
    {label:'Total saving',value:money(data.reduce((a,r)=>a+(Number(r.Saving)||0),0))||'$0',num:data.reduce((a,r)=>a+(Number(r.Saving)||0),0),fmt:'$#,##0',fg:'0F766E',bg:'CCFBF1'}
  ];
}
function teamLabel(){const t=String(W.activeTeamView||'').trim();return t&&t!==W.TEAM_ALL?t:'All teams';}

/* ---------------- Excel ---------------- */
function exportExcel(){
  const data=rows(); if(!data.length){showAppNotification('No project data to export.','Export');return;}
  if(!W.XLSX){showAppNotification('Excel export library is not available.','Export');return;}
  const title=[`Project Management - ${teamLabel()}`],sub=[`Exported ${fmtDate(today())} · ${data.length} project(s)`];
  const header=COLS.map(c=>HEAD[c]||c);
  const body=data.map(r=>COLS.map(c=>{
    const v=r[c]??'';
    if(c==='%Progress')return (Number(v)||0)/100;
    if(c==='Saving')return v===''||v==null?'':Number(v)||0;
    if(DATE_COLS.has(c))return v?new Date(v+'T00:00:00'):'';
    return v;
  }));
  const ST=stats(data);
  const aoa=[title,sub,[],ST.map(x=>x.label),ST.map(x=>x.num),[],header,...body];
  const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true}),wb=XLSX.utils.book_new();
  const HR=6; // header row index (0-based): title, sub, gap, stat labels, stat values, gap, header
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:COLS.length-1}},{s:{r:1,c:0},e:{r:1,c:COLS.length-1}}];
  ws['!cols']=[36,22,12,15,12,15,28,11,46,15,11].map(w=>({wch:w}));
  ws['!rows']=[{hpt:24},{hpt:16},{hpt:6},{hpt:16},{hpt:26},{hpt:8},{hpt:30}];
  ws['!autofilter']={ref:`A${HR+1}:${XLSX.utils.encode_col(COLS.length-1)}${aoa.length}`};
  const border={top:{style:'thin',color:{rgb:'D7E1E8'}},bottom:{style:'thin',color:{rgb:'D7E1E8'}},left:{style:'thin',color:{rgb:'D7E1E8'}},right:{style:'thin',color:{rgb:'D7E1E8'}}};
  const cell=(r,c)=>ws[XLSX.utils.encode_cell({r,c})];
  const t=cell(0,0); if(t)t.s={font:{name:'Arial',sz:14,bold:true,color:{rgb:'173E6B'}}};
  const s=cell(1,0); if(s)s.s={font:{name:'Arial',sz:9,italic:true,color:{rgb:'64748B'}}};
  ST.forEach((x,ci)=>{
    const l=cell(3,ci),v=cell(4,ci);
    const bd={top:{style:'thin',color:{rgb:x.fg}},bottom:{style:'thin',color:{rgb:x.fg}},left:{style:'thin',color:{rgb:x.fg}},right:{style:'thin',color:{rgb:x.fg}}};
    if(l)l.s={font:{name:'Arial',sz:8,bold:true,color:{rgb:x.fg}},fill:{patternType:'solid',fgColor:{rgb:x.bg}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:bd};
    if(v){v.s={font:{name:'Arial',sz:14,bold:true,color:{rgb:x.fg}},fill:{patternType:'solid',fgColor:{rgb:x.bg}},alignment:{horizontal:'center',vertical:'center'},border:bd};if(x.fmt)v.z=x.fmt;}
  });
  COLS.forEach((_,ci)=>{const h=cell(HR,ci);if(h)h.s={font:{name:'Arial',sz:10,bold:true,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:'315C7A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border};});
  data.forEach((r,ri)=>{
    const rowIdx=HR+1+ri, zebra=ri%2?'F8FBFD':'FFFFFF';
    COLS.forEach((c,ci)=>{
      let x=cell(rowIdx,ci); if(!x){x=ws[XLSX.utils.encode_cell({r:rowIdx,c:ci})]={t:'s',v:''};}
      const st={font:{name:'Arial',sz:10,color:{rgb:'334E63'},bold:c==='Project name'},fill:{patternType:'solid',fgColor:{rgb:zebra}},alignment:{vertical:'top',horizontal:'left',wrapText:true},border};
      if(c==='Key Project'||c==='%Progress'||DATE_COLS.has(c))st.alignment.horizontal='center';
      if(c==='Saving'){st.alignment.horizontal='right';if(x.v!=='' )x.z='$#,##0';}
      if(c==='%Progress')x.z='0%';
      if(DATE_COLS.has(c)&&x.t==='d')x.z='mm/dd/yyyy';
      if(c==='Status'){const [bg,fg]=statusColor(r.Status);st.fill.fgColor.rgb=bg;st.font={...st.font,bold:true,color:{rgb:fg}};st.alignment.horizontal='center';}
      if(c==='Key Project'&&r[c]==='Yes'){st.font={...st.font,bold:true,color:{rgb:'B45309'}};}
      x.s=st;
    });
  });
  /* total saving */
  const totalRow=HR+1+data.length, savingCol=COLS.indexOf('Saving');
  const total=data.reduce((a,r)=>a+(Number(r.Saving)||0),0);
  ws[XLSX.utils.encode_cell({r:totalRow,c:savingCol-1})]={t:'s',v:'Total saving',s:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'173E6B'}},alignment:{horizontal:'right'}}};
  ws[XLSX.utils.encode_cell({r:totalRow,c:savingCol})]={t:'n',v:total,z:'$#,##0',s:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'173E6B'}},alignment:{horizontal:'right'},border:{top:{style:'medium',color:{rgb:'315C7A'}}}}};
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:totalRow,c:COLS.length-1}});
  ws['!freeze']={xSplit:1,ySplit:HR+1};
  ws['!views']=[{state:'frozen',xSplit:1,ySplit:HR+1}];
  XLSX.utils.book_append_sheet(wb,ws,'Project Management');
  XLSX.writeFile(wb,`Project_Management_${teamLabel().replace(/[^\w-]+/g,'_')}_${today()}.xlsx`,{cellStyles:true});
}

/* ---------------- PDF ---------------- */
function exportPdf(){
  const data=rows(); if(!data.length){showAppNotification('No project data to export.','Export');return;}
  if(!W.jspdf?.jsPDF){showAppNotification('PDF export library is not available. Please wait a moment and try again.','Export');return;}
  const doc=new W.jspdf.jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
  const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),M=20,tableW=pageW-M*2;
  const base=[120,66,48,56,48,56,96,64,150,56,40], sum=base.reduce((a,b)=>a+b,0), widths=base.map(w=>w*tableW/sum);
  const hex=h=>[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
  const FS=6.6, LH=8.2, PAD=4;
  let y=M, page=1;
  const footer=()=>{doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...hex('94A3B8'));doc.text(`Page ${page}`,pageW-M,pageH-10,{align:'right'});doc.text(`Exported ${fmtDate(today())}`,M,pageH-10);};
  const header=()=>{
    const h=22;doc.setFillColor(...hex('315C7A'));doc.rect(M,y,tableW,h,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(6.8);doc.setTextColor(255,255,255);
    let x=M;COLS.forEach((c,i)=>{const lines=doc.splitTextToSize(HEAD[c]||c,widths[i]-PAD*2);doc.text(lines,x+widths[i]/2,y+h/2-(lines.length-1)*3.5,{align:'center',baseline:'middle'});x+=widths[i];});
    y+=h;
  };
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(...hex('173E6B'));doc.text(`Project Management - ${teamLabel()}`,M,y+10);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...hex('64748B'));doc.text(`${data.length} project(s)`,M,y+24);
  y+=34;
  /* statistic cards */
  {const ST=stats(data),gap=6,cw=(tableW-gap*(ST.length-1))/ST.length,ch=34;
   ST.forEach((x,i)=>{const cx=M+i*(cw+gap);
     doc.setFillColor(...hex(x.bg));doc.roundedRect(cx,y,cw,ch,4,4,'F');
     doc.setFillColor(...hex(x.fg));doc.rect(cx,y+5,2.5,ch-10,'F');
     doc.setFont('helvetica','normal');doc.setFontSize(6.6);doc.setTextColor(...hex(x.fg));doc.text(x.label,cx+9,y+12);
     doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text(x.value,cx+9,y+27);
   });
   y+=ch+10;}
  header();
  data.forEach((r,ri)=>{
    doc.setFontSize(FS);
    const cells=COLS.map((c,i)=>{
      let v=r[c]??'';
      if(DATE_COLS.has(c))v=fmtDate(v); else if(c==='%Progress')v=`${Number(v)||0}%`; else if(c==='Saving')v=money(v);
      doc.setFont('helvetica',c==='Project name'?'bold':'normal');
      return doc.splitTextToSize(String(v),widths[i]-PAD*2).slice(0,8);
    });
    const h=Math.max(16,Math.max(...cells.map(l=>l.length))*LH+PAD*2);
    if(y+h>pageH-24){footer();doc.addPage();page++;y=M;header();}
    doc.setFillColor(...hex(ri%2?'F8FBFD':'FFFFFF'));doc.rect(M,y,tableW,h,'F');
    let x=M;
    COLS.forEach((c,i)=>{
      const lines=cells[i];
      if(c==='Status'&&r.Status){const [bg,fg]=statusColor(r.Status);doc.setFillColor(...hex(bg));doc.roundedRect(x+3,y+PAD-1,widths[i]-6,LH+3,3,3,'F');doc.setTextColor(...hex(fg));doc.setFont('helvetica','bold');}
      else if(c==='Key Project'&&r[c]==='Yes'){doc.setTextColor(...hex('B45309'));doc.setFont('helvetica','bold');}
      else{doc.setTextColor(...hex('334E63'));doc.setFont('helvetica',c==='Project name'?'bold':'normal');}
      if(c==='%Progress'){
        /* bar on the first text line; the % number sits right after the end of the coloured bar */
        const p=Math.max(0,Math.min(100,Number(r[c])||0));
        doc.setFont('helvetica','bold');doc.setFontSize(FS);
        const tw=doc.getTextWidth('100%'),bh=3.5,bx=x+4,tw2=widths[i]-8-tw-3,by=y+PAD+LH-4-bh/2,fw=tw2*p/100;
        doc.setFillColor(...hex('E2E8F0'));doc.roundedRect(bx,by,tw2,bh,bh/2,bh/2,'F');
        if(fw>0){doc.setFillColor(...hex(p>=100?'16A34A':'2563EB'));doc.roundedRect(bx,by,Math.max(fw,bh),bh,bh/2,bh/2,'F');}
        doc.setTextColor(...hex('334E63'));
        doc.text(`${p}%`,bx+(fw>0?Math.max(fw,bh):0)+3,y+PAD+LH-2);
        x+=widths[i];return;
      }
      const center=c==='Status'||c==='Key Project'||c==='%Progress'||DATE_COLS.has(c), right=c==='Saving';
      doc.setFontSize(FS);
      doc.text(lines,right?x+widths[i]-PAD:center?x+widths[i]/2:x+PAD,y+PAD+LH-2,{align:right?'right':center?'center':'left',lineHeightFactor:LH/FS});
      x+=widths[i];
    });
    doc.setDrawColor(...hex('D7E1E8'));doc.setLineWidth(0.4);doc.line(M,y+h,M+tableW,y+h);
    y+=h;
  });
  footer();
  doc.save(`Project_Management_${teamLabel().replace(/[^\w-]+/g,'_')}_${today()}.pdf`);
}

function openOptions(){
  document.getElementById('projectExportOptions')?.remove();
  const n=rows().length;
  const m=document.createElement('div');m.id='projectExportOptions';m.className='pm-export-modal';
  m.innerHTML=`<div class="pm-export-box"><div class="pm-export-title">Export Project Management</div><div class="pm-export-subtitle">${n} project(s) · same columns, search and filters as the table on screen.</div><div class="pm-export-actions"><button type="button" data-x="xlsx"><i class="fa-solid fa-file-excel"></i><span>Export Excel</span></button><button type="button" data-x="pdf"><i class="fa-solid fa-file-pdf"></i><span>Export PDF</span></button></div><button type="button" class="pm-export-close" data-x="close">Cancel</button></div>`;
  document.body.appendChild(m);
  m.addEventListener('click',e=>{
    const b=e.target.closest('[data-x]');
    if(e.target===m||b?.dataset.x==='close'){m.remove();return;}
    if(!b)return;
    m.remove();
    try{b.dataset.x==='xlsx'?exportExcel():exportPdf();}catch(err){console.error('Project export failed',err);showAppNotification(`Export failed. ${err?.message||err}`,'Export');}
  });
}

W.exportProjectExcel=exportExcel; W.exportProjectPdf=exportPdf; W.openProjectExportOptions=openOptions;
W.exportProjectManagementData=openOptions;
try{exportProjectExcel=exportExcel;exportProjectPdf=exportPdf;openProjectExportOptions=openOptions;exportProjectManagementData=openOptions;}catch(_){}
})();
