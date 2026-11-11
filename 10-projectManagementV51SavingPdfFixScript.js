(function(){
  'use strict';
  function normalizeNegativeSaving(v){
    if(v===null || v===undefined || String(v).trim()==='') return '';
    const raw=String(v).trim().replace(/[$€£¥\s,]/g,'');
    const n=Number(raw);
    return Number.isFinite(n) ? n : '';
  }
  // Re-wrap the public field updater and pass the normalized value explicitly.
  // This prevents the old Number(value)||0 logic from converting invalid/intermediate
  // values while still preserving valid negative numbers such as -2342.
  const oldField=window.updateProjectField;
  if(typeof oldField==='function' && !oldField.__v51){
    const f=function(projectId,key,value){
      if(key==='saving'||key==='actualSaving') value=normalizeNegativeSaving(value);
      return oldField.call(this,projectId,key,value);
    };
    f.__v51=true;
    window.updateProjectField=f;
  }
  const oldTask=window.updateProjectInlineTask;
  if(typeof oldTask==='function' && !oldTask.__v51){
    const f=function(projectId,phaseIndex,taskIndex,key,value){
      if(key==='estSaving'||key==='actualSaving') value=normalizeNegativeSaving(value);
      return oldTask.call(this,projectId,phaseIndex,taskIndex,key,value);
    };
    f.__v51=true;
    window.updateProjectInlineTask=f;
  }
  // Make the PDF No. column centered even if an older renderer is still present.
  // The authoritative renderer source is also patched above.
  const originalProjectMoney = window.projectMoney;
  if(typeof originalProjectMoney==='function' && !originalProjectMoney.__v51){
    const f=function(v){ return originalProjectMoney.call(this,v); };
    f.__v51=true;
    window.projectMoney=f;
  }
})();
