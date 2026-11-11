/* =====================================================================
   PROJECT EXPORT V2 - Excel / PDF in the NEW Project Management format
   Columns = the current project table:
   No. | Team | Project name | Owner | Start | Plan Completed | Actual | Status |
   Current Stage | %Progress | Archived goal | Saving (if have) | Key Project
   Export follows the current search + column filters (what is on screen).
   ===================================================================== */
(function(){
'use strict';
const W=window;
const COLS=['No.','Team','Project name','Owner','Start','Plan Completed','Actual','Status','Current Stage','%Progress','Archived goal','Saving','Key Project'];
const HEAD={'Saving':'Saving (if have)'};
const DATE_COLS=new Set(['Start','Plan Completed','Actual']);
const STATUS_COLORS={completed:['DCFCE7','166534'],done:['DCFCE7','166534'],working:['DBEAFE','1E40AF'],'working on it':['DBEAFE','1E40AF'],'in progress':['DBEAFE','1E40AF'],overdue:['FEE2E2','991B1B'],stuck:['FEE2E2','991B1B'],'not started':['F1F5F9','475569']};
const statusColor=s=>STATUS_COLORS[String(s||'').trim().toLowerCase()]||['F8FAFC','334155'];
const fmtDate=v=>{const s=typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'');if(!s)return '';const [y,m,d]=s.split('-');return y&&m&&d?`${m}/${d}/${y}`:s;};
const money=v=>v===''||v==null||!isFinite(Number(v))?'':'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:0});
const today=()=>new Date().toISOString().slice(0,10);

function rows(){
  let list=[];
  try{list=W.getVisibleProjectExportRows?.()||getVisibleProjectExportRows()||[];}catch(e){console.error('Project export rows failed',e);}
  return list.filter(r=>String(r['Project name']||'').trim());
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
  const aoa=[title,sub,[],header,...body];
  const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true}),wb=XLSX.utils.book_new();
  const HR=3; // header row index (0-based)
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:COLS.length-1}},{s:{r:1,c:0},e:{r:1,c:COLS.length-1}}];
  ws['!cols']=[6,16,34,20,12,14,12,14,26,11,40,14,11].map(w=>({wch:w}));
  ws['!rows']=[{hpt:24},{hpt:16},{hpt:6},{hpt:30}];
  ws['!autofilter']={ref:`A${HR+1}:${XLSX.utils.encode_col(COLS.length-1)}${aoa.length}`};
  const border={top:{style:'thin',color:{rgb:'D7E1E8'}},bottom:{style:'thin',color:{rgb:'D7E1E8'}},left:{style:'thin',color:{rgb:'D7E1E8'}},right:{style:'thin',color:{rgb:'D7E1E8'}}};
  const cell=(r,c)=>ws[XLSX.utils.encode_cell({r,c})];
  const t=cell(0,0); if(t)t.s={font:{name:'Arial',sz:14,bold:true,color:{rgb:'173E6B'}}};
  const s=cell(1,0); if(s)s.s={font:{name:'Arial',sz:9,italic:true,color:{rgb:'64748B'}}};
  COLS.forEach((_,ci)=>{const h=cell(HR,ci);if(h)h.s={font:{name:'Arial',sz:10,bold:true,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:'315C7A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border};});
  data.forEach((r,ri)=>{
    const rowIdx=HR+1+ri, zebra=ri%2?'F8FBFD':'FFFFFF';
    COLS.forEach((c,ci)=>{
      let x=cell(rowIdx,ci); if(!x){x=ws[XLSX.utils.encode_cell({r:rowIdx,c:ci})]={t:'s',v:''};}
      const st={font:{name:'Arial',sz:10,color:{rgb:'334E63'},bold:c==='Project name'},fill:{patternType:'solid',fgColor:{rgb:zebra}},alignment:{vertical:'top',horizontal:'left',wrapText:true},border};
      if(c==='No.'||c==='Key Project'||c==='%Progress'||DATE_COLS.has(c))st.alignment.horizontal='center';
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
  ws['!freeze']={xSplit:3,ySplit:HR+1};
  ws['!views']=[{state:'frozen',xSplit:3,ySplit:HR+1}];
  XLSX.utils.book_append_sheet(wb,ws,'Project Management');
  XLSX.writeFile(wb,`Project_Management_${teamLabel().replace(/[^\w-]+/g,'_')}_${today()}.xlsx`,{cellStyles:true});
}

/* ---------------- PDF ---------------- */
function exportPdf(){
  const data=rows(); if(!data.length){showAppNotification('No project data to export.','Export');return;}
  if(!W.jspdf?.jsPDF){showAppNotification('PDF export library is not available. Please wait a moment and try again.','Export');return;}
  const doc=new W.jspdf.jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
  const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),M=20,tableW=pageW-M*2;
  const base=[22,52,110,62,46,52,46,52,84,40,150,52,36], sum=base.reduce((a,b)=>a+b,0), widths=base.map(w=>w*tableW/sum);
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
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...hex('64748B'));doc.text(`${data.length} project(s) · Total saving ${money(data.reduce((a,r)=>a+(Number(r.Saving)||0),0))||'$0'}`,M,y+24);
  y+=34;header();
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
      if(c==='%Progress'){const p=Math.max(0,Math.min(100,Number(r[c])||0));const bw=widths[i]-8;doc.setFillColor(...hex('E2E8F0'));doc.rect(x+4,y+h-PAD-3,bw,2.5,'F');doc.setFillColor(...hex(p>=100?'16A34A':'2563EB'));doc.rect(x+4,y+h-PAD-3,bw*p/100,2.5,'F');}
      const center=c==='No.'||c==='Status'||c==='Key Project'||c==='%Progress'||DATE_COLS.has(c), right=c==='Saving';
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
