(function(){
  'use strict';
  function norm(t){return String(t||'').replace(/[▼▾⌄↕↑↓]/g,'').replace(/\s+/g,' ').trim().toLowerCase();}
  function reorderTable(table){
    const head=table.querySelector('thead tr');
    if(!head)return;
    const headers=Array.from(head.children);
    const owner=headers.findIndex(c=>norm(c.innerText||c.textContent)==='owner');
    const detail=headers.findIndex(c=>norm(c.innerText||c.textContent).includes('detailed status'));
    const overall=headers.findIndex(c=>norm(c.innerText||c.textContent).includes('overall status'));
    if(owner<0||detail<0||overall<0)return;
    // Desired order: all original columns, except move Detailed Status and
    // Overall Status together immediately after Owner. Apply the same order
    // to every row, so the cell values stay aligned with their headers.
    const order=headers.map((_,i)=>i).filter(i=>i!==detail&&i!==overall);
    const ownerPos=order.indexOf(owner);
    order.splice(ownerPos+1,0,detail,overall);
    if(order.every((v,i)=>v===i))return;
    const rows=Array.from(table.querySelectorAll('tr'));
    rows.forEach(row=>{
      const cells=Array.from(row.children);
      if(cells.length!==headers.length)return;
      const frag=document.createDocumentFragment();
      order.forEach(i=>frag.appendChild(cells[i]));
      row.appendChild(frag);
    });
  }
  function run(){
    const root=document.getElementById('tab-projects');
    if(root)root.querySelectorAll('table').forEach(reorderTable);
  }
  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run();});};
  function observe(){
    schedule();
    const root=document.getElementById('tab-projects');
    if(root)requestAnimationFrame(schedule);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});
  else observe();
})();
