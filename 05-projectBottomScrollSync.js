(function(){
  function sync(){try{if(typeof syncProjectBottomScroll==='function')syncProjectBottomScroll();}catch(e){}}
  document.addEventListener('DOMContentLoaded',()=>{sync();setTimeout(sync,200);setTimeout(sync,800);});
  const host=document.getElementById('projectsTableBody');
  if(host){ requestAnimationFrame(sync); }
  window.addEventListener('resize',sync);
})();
