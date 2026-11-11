/* STATE BRIDGE
   App state lives in top-level `let` variables (js/core/02-app-core.js), which are NOT
   properties of window. Several modules read window.projectsList / window.users ...
   and got a stale or empty copy (e.g. Project export had no data).
   These accessors make window.X always read/write the live variable. */
(function(){
  const bind=(name,get,set)=>{try{Object.defineProperty(window,name,{configurable:true,enumerable:false,get,set});}catch(e){console.warn('state bridge',name,e);}};
  bind('projectsList',()=>projectsList,v=>{projectsList=v;});
  bind('dailyTasks',()=>dailyTasks,v=>{dailyTasks=v;});
  bind('users',()=>users,v=>{users=v;});
  bind('timeoffOtList',()=>timeoffOtList,v=>{timeoffOtList=v;});
  bind('capacityData',()=>capacityData,v=>{capacityData=v;});
  bind('currentUser',()=>currentUser,v=>{currentUser=v;});
})();
