(function(){
const old=window.renderUserManagementTable;
if(typeof old==='function'){
  const w=function(){ const r=old.apply(this,arguments); try{ recomputeAdvancedTableFilter('table-users'); decorateAdvancedFilterControls(); }catch(_){} return r; };
  window.renderUserManagementTable=w; try{ renderUserManagementTable=w; }catch(_){}
}
})();
