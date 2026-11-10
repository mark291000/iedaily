(function(){
  function bindTableScroll(){
    const view=document.getElementById('projectTableView');
    const wrap=view?.querySelector('.pm-shared-table-wrap');
    const bar=document.getElementById('projectTableBottomScroll');
    const inner=bar?.firstElementChild;
    const table=view?.querySelector('.pm-shared-project-table');
    if(!wrap||!bar||!inner||!table)return;

    const syncSize=()=>{
      const width=Math.max(table.scrollWidth, wrap.clientWidth);
      inner.style.width=width+'px';
      if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>1) bar.scrollLeft=wrap.scrollLeft;
    };

    if(bar.dataset.v33Bound!=='1'){
      bar.dataset.v33Bound='1';
      bar.addEventListener('scroll',()=>{ wrap.scrollLeft=bar.scrollLeft; },{passive:true});
      wrap.addEventListener('scroll',()=>{ if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>1) bar.scrollLeft=wrap.scrollLeft; },{passive:true});
    }
    syncSize();
    requestAnimationFrame(syncSize);
    setTimeout(syncSize,100);
  }

  window.syncProjectBottomScroll=bindTableScroll;

  const host=document.getElementById('projectsTableBody');
  if(host){
    requestAnimationFrame(bindTableScroll);
  }
  document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(bindTableScroll));
  window.addEventListener('resize',bindTableScroll);
})();
