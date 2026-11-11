(function(){
  const oldSync=window.syncProjectBottomScroll;
  window.syncProjectBottomScroll=function(){
    if(typeof oldSync==='function') oldSync();
    const view=document.getElementById('projectTableView'),wrap=view?.querySelector('.pm-shared-table-wrap'),bar=document.getElementById('projectTableBottomScroll'),inner=bar?.firstElementChild,table=view?.querySelector('.pm-shared-project-table');
    if(!wrap||!bar||!inner)return;
    const width=Math.max(table?.scrollWidth||0,wrap.scrollWidth,wrap.clientWidth);
    inner.style.width=width+'px';
    if(!bar.dataset.v30bound){
      bar.dataset.v30bound='1';
      bar.addEventListener('scroll',()=>{wrap.scrollLeft=bar.scrollLeft;},{passive:true});
      wrap.addEventListener('scroll',()=>{if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>1)bar.scrollLeft=wrap.scrollLeft;},{passive:true});
    }
  };
})();
