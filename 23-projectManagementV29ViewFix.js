(function(){
  /* V29 hotfix: always delegate to the original setter so the lexical
     projectCurrentView used by toggleAllProjectRows() is updated too.
     The previous override only wrote window.projectCurrentView, which
     left Timeline's Expand/Collapse All operating on the Table state. */
  const originalSetProjectView=window.setProjectView;
  if(typeof originalSetProjectView!=='function') return;
  window.setProjectView=function(view,skipRender=false){
    const v=view==='gantt'?'gantt':'table';
    originalSetProjectView(v,skipRender);
    window.projectCurrentView=v;
  };
})();
