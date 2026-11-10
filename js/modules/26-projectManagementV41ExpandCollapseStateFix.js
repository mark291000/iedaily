(function(){
  'use strict';
  /* The main Project Management code keeps these as top-level lexical variables,
     while V38/V39 hotfixes read them through window.*. Expose live getters so
     reassignment of projectsList is always reflected. */
  try{
    Object.defineProperty(window,'projectsList',{configurable:true,get:function(){return projectsList;}});
  }catch(e){ try{ window.projectsList=projectsList; }catch(_){} }
  try{
    Object.defineProperty(window,'collapsedGanttProjects',{configurable:true,get:function(){return collapsedGanttProjects;}});
  }catch(e){ try{ window.collapsedGanttProjects=collapsedGanttProjects; }catch(_){} }
  try{
    Object.defineProperty(window,'collapsedGanttPhases',{configurable:true,get:function(){return collapsedGanttPhases;}});
  }catch(e){ try{ window.collapsedGanttPhases=collapsedGanttPhases; }catch(_){} }
  try{
    Object.defineProperty(window,'expandedProjectRows',{configurable:true,get:function(){return expandedProjectRows;}});
  }catch(e){ try{ window.expandedProjectRows=expandedProjectRows; }catch(_){} }
  try{
    Object.defineProperty(window,'collapsedProjectPhases',{configurable:true,get:function(){return collapsedProjectPhases;}});
  }catch(e){ try{ window.collapsedProjectPhases=collapsedProjectPhases; }catch(_){} }
})();
