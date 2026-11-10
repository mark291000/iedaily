(function(){
  function fixRealTableScroll(){
    const view=document.getElementById('projectTableView');
    const host=document.getElementById('projectsTableBody');
    const wrap=view?.querySelector('.pm-shared-table-wrap');
    const table=view?.querySelector('.pm-shared-project-table');
    if(!view||!host||!wrap||!table)return;

    /* The table itself must create the horizontal overflow. */
    table.style.transform='none';
    table.style.width='max-content';
    table.style.minWidth='1500px';
    wrap.style.overflowX='auto';
    wrap.style.overflowY='auto';

    /* Force a real scroll range if the browser otherwise shrinks the table. */
    const required=Math.max(1500, table.scrollWidth, table.offsetWidth);
    if(table.offsetWidth < required) table.style.width=required+'px';

    /* Keep the viewport positioned after every render without using a detached scrollbar. */
    if(wrap.dataset.v35Bound!=='1'){
      wrap.dataset.v35Bound='1';
      wrap.addEventListener('wheel',function(e){
        if(Math.abs(e.deltaX)>0 && wrap.scrollWidth>wrap.clientWidth){
          wrap.scrollLeft += e.deltaX;
          e.preventDefault();
        }
      },{passive:false});
    }
  }
  window.syncProjectBottomScroll=fixRealTableScroll;
  window.syncProjectTableScroll=fixRealTableScroll;
  const host=document.getElementById('projectsTableBody');
  if(host)requestAnimationFrame(fixRealTableScroll);
  document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(fixRealTableScroll));
  window.addEventListener('resize',fixRealTableScroll);
})();
