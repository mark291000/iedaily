(function(){
  'use strict';
  let resizeTimer=0;
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{
      if(typeof window.renderGanttChart==='function' && window.projectCurrentView==='gantt') window.renderGanttChart();
    },80);
  },{passive:true});
})();
