(function(){
  'use strict';
  // Preserve negative Est. Annual Saving/years and Achieved Annual Saving/years
  // when values are edited, imported, normalized, or re-rendered.
  function normalizeSavingValue(v){
    if(v===null||v===undefined||String(v).trim()==='') return '';
    const n=Number(String(v).replace(/[$€£¥\s,]/g,''));
    return Number.isFinite(n)?n:'';
  }
  const originalUpdate=window.updateProjectInlineTask;
  if(typeof originalUpdate==='function' && !originalUpdate.__v50SavingFix){
    const wrapped=function(projectId,phaseIndex,taskIndex,key,value){
      if(key==='estSaving'||key==='actualSaving') value=normalizeSavingValue(value);
      return originalUpdate.apply(this,arguments);
    };
    wrapped.__v50SavingFix=true;
    window.updateProjectInlineTask=wrapped;
  }
  // Ensure PDF rows always contain a visible project number even if an older
  // getProjectPdfRows implementation is encountered by the page.
  const originalPdfRows=window.getProjectPdfRows;
  if(typeof originalPdfRows==='function' && !originalPdfRows.__v50NoFix){
    const wrappedRows=function(){
      const rows=originalPdfRows.apply(this,arguments)||[];
      let no=0;
      rows.forEach(r=>{
        if(r && r.__kind==='project'){ no++; r.No=no; }
        else if(r) r.No='';
      });
      return rows;
    };
    wrappedRows.__v50NoFix=true;
    window.getProjectPdfRows=wrappedRows;
  }
})();
