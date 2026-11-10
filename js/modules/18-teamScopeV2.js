(function(){
'use strict';
const PALETTE=['#e5a42a','#e44b87','#7b62d9','#2da981','#2388c9','#2c9ed4','#e58a35','#6177cf','#35a68e','#55aee5'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const S={team:'',items:[],assign:new Set(),busy:false};
const key=(code,name)=>code+'\u0000'+name;
function team(){const t=typeof getViewTeam==='function'?getViewTeam():'';return t===window.TEAM_ALL?'':String(t||'').trim();}
function canEdit(){
  const t=team(); if(!t||!currentUser||currentUser.isReadOnly) return false;
  if(window.isAdminSession?.()) return true;
  return currentUser.role==='Team Admin' && norm(currentUser.team)===norm(t);
}
function members(){
  const t=team();
  return (Array.isArray(users)?users:[])
    .filter(u=>norm(u.team)===norm(t) && String(u.status||'Active')!=='Inactive' && u.role!=='Viewer')
    .map(u=>String(u.name||'').trim()).filter(Boolean)
    .filter((n,i,a)=>a.findIndex(x=>norm(x)===norm(n))===i)
    .sort((a,b)=>a.localeCompare(b));
}
// Excel column -> member: exact name, or any word of the name ("Anny" = "Le, Anny").
function matchMember(col,ms){
  const c=norm(col); if(!c) return null;
  const exact=ms.find(m=>norm(m)===c); if(exact) return exact;
  const hits=ms.filter(m=>norm(m).split(/[\s,._-]+/).includes(c));
  return hits.length===1?hits[0]:null;
}
function ordered(){
  const groups=S.items.filter(i=>!i.parent_code).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const out=[];
  groups.forEach((g,gi)=>{
    out.push({...g,_gi:gi});
    S.items.filter(i=>String(i.parent_code)===String(g.code)).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).forEach(s=>out.push({...s,_gi:gi}));
  });
  return out;
}
function ensureRoot(){
  const tab=document.getElementById('tab-bom-cs-scope'); if(!tab) return null;
  tab.classList.add('ts2-on');
  let root=document.getElementById('ts2Root');
  if(!root){root=document.createElement('div');root.id='ts2Root';tab.appendChild(root);}
  return root;
}
async function load(){
  const t=team(); S.team=t; S.items=[]; S.assign=new Set();
  if(!t) return;
  const [it,as]=await Promise.all([
    supabaseClient.from('scope_items').select('*').eq('team',t),
    supabaseClient.from('scope_assignments').select('item_code,member_name').eq('team',t)
  ]);
  if(it.error) throw it.error; if(as.error) throw as.error;
  S.items=it.data||[];
  (as.data||[]).forEach(a=>S.assign.add(key(String(a.item_code),norm(a.member_name))));
}
function render(){
  const root=ensureRoot(); if(!root) return;
  const t=team(), edit=canEdit(), ms=members(), rows=ordered();
  const nGroups=rows.filter(r=>!r.parent_code).length, nSubs=rows.length-nGroups;
  const counts=ms.map(m=>rows.filter(r=>S.assign.has(key(String(r.code),norm(m)))).length);
  const bar=`<div class="ts2-bar">
    <span class="ts2-title"><i class="fa-solid fa-sitemap"></i> Team Scope ${t?`<span class="ts2-team">${esc(t)}</span>`:''}</span>
    <span class="ts2-stats">${nGroups} group · ${nSubs} sub-item · ${ms.length} member</span>
    ${edit?`<button type="button" class="ts2-btn primary" data-act="add-group"><i class="fa-solid fa-plus"></i> Group</button>
    <button type="button" class="ts2-btn" data-act="template"><i class="fa-solid fa-file-arrow-down"></i> Template</button>
    <button type="button" class="ts2-btn green" data-act="import"><i class="fa-solid fa-file-import"></i> Import Excel</button>`:''}
    <button type="button" class="ts2-btn" data-act="export"><i class="fa-solid fa-file-export"></i> Export</button>
    <input type="file" id="ts2File" accept=".xlsx,.xls,.csv" hidden>
  </div>
  ${edit?'<div class="ts2-hint">Click a cell to assign / unassign a member. Hover a row to add a sub-item, rename or delete.</div>':''}`;
  let body;
  if(!t) body='<div class="ts2-empty">Select a team to view its scope.</div>';
  else if(!rows.length) body=`<div class="ts2-empty">No scope has been set up for team <b>${esc(t)}</b> yet.${edit?'<br>Click <b>+ Group</b> or <b>Import Excel</b> to start.':''}</div>`;
  else {
    const head=`<tr><th class="ts2-scope">SCOPE</th>${ms.map((m,i)=>`<th><div class="ts2-mhead"><span class="ts2-av" style="background:${PALETTE[i%PALETTE.length]}">${esc(m.charAt(0).toUpperCase())}</span><span class="ts2-mname" title="${esc(m)}">${esc(m)}</span><span class="ts2-mcount">${counts[i]} item</span></div></th>`).join('')}</tr>`;
    const tr=rows.map(r=>{
      const sub=!!r.parent_code, color=PALETTE[r._gi%PALETTE.length];
      const label=sub
        ?`<span class="ts2-subno">${esc(r.code)}</span><span class="ts2-text">${esc(r.title)}</span>`
        :`<span class="ts2-badge" style="background:${color}">${esc(r.code)}</span><span class="ts2-text">${esc(r.title)}</span>`;
      const acts=edit?`<span class="ts2-acts">${sub?'':`<button type="button" title="Add sub-item" aria-label="Add sub-item" data-act="add-sub" data-code="${esc(r.code)}"><i class="fa-solid fa-plus"></i></button>`}<button type="button" title="Rename" aria-label="Rename" data-act="rename" data-code="${esc(r.code)}"><i class="fa-solid fa-pen"></i></button><button type="button" class="del" title="Delete" aria-label="Delete" data-act="delete" data-code="${esc(r.code)}"><i class="fa-solid fa-trash"></i></button></span>`:'';
      const cells=ms.map(m=>{const on=S.assign.has(key(String(r.code),norm(m)));
        return `<td><button type="button" class="ts2-cell" ${edit?'':'disabled'} data-act="toggle" data-code="${esc(r.code)}" data-member="${esc(m)}" aria-pressed="${on}" aria-label="${esc(m)} - ${esc(r.title)}"><span class="ts2-check ${on?'on':'off'}">${on?'✓':''}</span></button></td>`;}).join('');
      return `<tr class="${sub?'ts2-sub':'ts2-group'}"><td class="ts2-label"><div class="ts2-lab">${label}${acts}</div></td>${cells}</tr>`;
    }).join('');
    body=`<div class="ts2-wrap"><table><thead>${head}</thead><tbody>${tr}</tbody></table></div>`;
  }
  root.innerHTML=bar+body;
}
async function reload(){
  const root=ensureRoot(); if(!root||!currentUser) return;
  try{ await load(); render(); }
  catch(e){ console.error('Team scope load error:',e); render(); root.insertAdjacentHTML('beforeend',`<div class="ts2-empty">Unable to load scope: ${esc(e.message||e)}</div>`); }
}
window.renderScopeFromDb=reload;
window.scopeReload=reload;
function nextOrder(){ return S.items.reduce((m,i)=>Math.max(m,Number(i.sort_order)||0),0)+10; }
function nextGroupCode(){ return String(S.items.filter(i=>!i.parent_code).reduce((m,i)=>Math.max(m,parseInt(i.code,10)||0),0)+1); }
function nextSubCode(parent){
  const n=S.items.filter(i=>String(i.parent_code)===String(parent)).reduce((m,i)=>Math.max(m,parseInt(String(i.code).split('.').pop(),10)||0),0)+1;
  return parent+'.'+n;
}
async function insertItem(title,parent){
  const t=team(), code=parent?nextSubCode(parent):nextGroupCode(), sort_order=nextOrder();
  const {data,error}=await supabaseClient.from('scope_items').insert({team:t,code,title,parent_code:parent||null,sort_order}).select('*').single();
  if(error) throw error; S.items.push(data); return data;
}
async function addGroup(){
  const title=prompt('Group name (Main Scope)'); if(!title||!title.trim()) return;
  try{ await insertItem(title.trim(),null); render(); }catch(e){ showAppNotification(e.message,'Scope save error'); }
}
async function addSub(parent){
  const title=prompt('Sub-item name (Sub Scope)'); if(!title||!title.trim()) return;
  try{ await insertItem(title.trim(),parent); render(); }catch(e){ showAppNotification(e.message,'Scope save error'); }
}
async function rename(code){
  const it=S.items.find(i=>String(i.code)===String(code)); if(!it) return;
  const title=prompt('New name',it.title||''); if(!title||!title.trim()||title.trim()===it.title) return;
  const {error}=await supabaseClient.from('scope_items').update({title:title.trim()}).eq('team',team()).eq('code',code);
  if(error) return showAppNotification(error.message,'Scope save error');
  it.title=title.trim(); render();
}
async function del(code){
  const it=S.items.find(i=>String(i.code)===String(code)); if(!it) return;
  const codes=[String(code),...S.items.filter(i=>String(i.parent_code)===String(code)).map(i=>String(i.code))];
  const msg=it.parent_code?`Delete sub-item "${it.title}"?`:`Delete group "${it.title}" and its ${codes.length-1} sub-item(s)?`;
  if(!(await showAppConfirm(msg,'Delete Scope'))) return;
  const t=team();
  let r=await supabaseClient.from('scope_assignments').delete().eq('team',t).in('item_code',codes); if(r.error) return showAppNotification(r.error.message,'Scope delete error');
  r=await supabaseClient.from('scope_items').delete().eq('team',t).in('code',codes); if(r.error) return showAppNotification(r.error.message,'Scope delete error');
  S.items=S.items.filter(i=>!codes.includes(String(i.code)));
  [...S.assign].forEach(k=>{ if(codes.includes(k.split('\u0000')[0])) S.assign.delete(k); });
  render();
}
async function toggle(btn){
  if(S.busy) return; S.busy=true;
  const code=btn.dataset.code, member=btn.dataset.member, k=key(code,norm(member)), t=team(), on=S.assign.has(k);
  if(on) S.assign.delete(k); else S.assign.add(k); render();
  try{
    const r=on
      ? await supabaseClient.from('scope_assignments').delete().eq('team',t).eq('item_code',code).eq('member_name',member)
      : await supabaseClient.from('scope_assignments').insert({team:t,item_code:code,member_name:member});
    if(r.error) throw r.error;
  }catch(e){ if(on) S.assign.add(k); else S.assign.delete(k); render(); showAppNotification(e.message,'Scope save error'); }
  finally{ S.busy=false; }
}
function sheetRows(){
  const ms=members(), out=[];
  ordered().forEach(r=>{
    const parent=r.parent_code?S.items.find(i=>String(i.code)===String(r.parent_code)):null;
    const row={'Main Scope':parent?parent.title:r.title,'Sub Scope':parent?r.title:''};
    ms.forEach(m=>row[m]=S.assign.has(key(String(r.code),norm(m)))?'x':'');
    out.push(row);
  });
  return out;
}
function download(rows,name){
  const header=['Main Scope','Sub Scope',...members()];
  const ws=XLSX.utils.json_to_sheet(rows.length?rows:[Object.fromEntries(header.map(h=>[h,'']))],{header});
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Scope'); XLSX.writeFile(wb,name);
}
function template(){
  const ms=members(), row=(main,sub,tick)=>({'Main Scope':main,'Sub Scope':sub,...Object.fromEntries(ms.map((m,i)=>[m,tick&&i===0?'x':'']))});
  download([row('Example group','',true),row('Example group','Example sub-item 1',true),row('Example group','Example sub-item 2',false)],`Team_Scope_Template_${team().replace(/[^\w-]+/g,'_')}.xlsx`);
}
const isMark=v=>{const s=norm(v);return !!s && !['0','no','n','false','-'].includes(s);};
async function importFile(file){
  const t=team(); if(!t) return;
  let rows;
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});
  }catch(e){ return showAppNotification('Cannot read file: '+e.message,'Import error'); }
  if(!rows.length) return showAppNotification('The file has no data rows.','Import');
  const cols=Object.keys(rows[0]);
  const mainCol=cols.find(c=>norm(c)==='main scope'), subCol=cols.find(c=>norm(c)==='sub scope');
  if(!mainCol) return showAppNotification('Column "Main Scope" was not found. Required columns: Main Scope, Sub Scope, then one column per member.','Import error');
  const ms=members(), memberCols=[], unknown=[];
  cols.filter(c=>c!==mainCol&&c!==subCol&&!/^__EMPTY/.test(c)).forEach(c=>{ const m=matchMember(c,ms); if(m) memberCols.push({col:c,name:m}); else unknown.push(c); });
  const plan=[]; let lastMain='';
  rows.forEach(r=>{
    const main=String(r[mainCol]||'').trim()||lastMain, sub=subCol?String(r[subCol]||'').trim():'';
    if(!main) return; lastMain=main;
    plan.push({main,sub,members:memberCols.filter(mc=>isMark(r[mc.col])).map(mc=>mc.name)});
  });
  if(!plan.length) return showAppNotification('No valid scope rows were found.','Import');
  const groupsN=new Set(plan.map(p=>norm(p.main))).size, subsN=plan.filter(p=>p.sub).length;
  let msg=`Import into team "${t}": ${groupsN} group(s), ${subsN} sub-item(s), ${memberCols.length} member column(s).\nExisting groups/sub-items with the same name are reused; their ticks are replaced by the file. Other scope rows are not changed.`;
  if(unknown.length) msg+=`\n\nIgnored columns (not a member of this team): ${unknown.join(', ')}`;
  if(!(await showAppConfirm(msg,'Import Team Scope'))) return;
  try{
    await load();
    const touched=new Set(), wanted=[];
    for(const p of plan){
      let g=S.items.find(i=>!i.parent_code && norm(i.title)===norm(p.main));
      if(!g) g=await insertItem(p.main,null);
      let target=g;
      if(p.sub){
        let s=S.items.find(i=>String(i.parent_code)===String(g.code) && norm(i.title)===norm(p.sub));
        if(!s) s=await insertItem(p.sub,g.code);
        target=s;
      }
      const code=String(target.code);
      touched.add(code); p.members.forEach(m=>wanted.push({team:t,item_code:code,member_name:m}));
    }
    const codes=[...touched];
    if(codes.length){ const d=await supabaseClient.from('scope_assignments').delete().eq('team',t).in('item_code',codes); if(d.error) throw d.error; }
    const uniq=[...new Map(wanted.map(w=>[w.item_code+'|'+norm(w.member_name),w])).values()];
    for(let i=0;i<uniq.length;i+=500){ const r=await supabaseClient.from('scope_assignments').insert(uniq.slice(i,i+500)); if(r.error) throw r.error; }
    await reload();
    showAppNotification(`Imported ${plan.length} row(s) and ${uniq.length} tick(s) for team "${t}".`+(unknown.length?` Ignored columns: ${unknown.join(', ')}.`:''),'Import complete');
  }catch(e){ console.error(e); await reload(); showAppNotification(e.message||String(e),'Import error'); }
}
document.addEventListener('click',e=>{
  const root=document.getElementById('ts2Root'); if(!root) return;
  const b=e.target.closest('[data-act]'); if(!b||!root.contains(b)) return;
  const a=b.dataset.act;
  if(a==='export') return download(sheetRows(),`Team_Scope_${team().replace(/[^\w-]+/g,'_')}.xlsx`);
  if(!canEdit()) return;
  if(a==='add-group') addGroup();
  else if(a==='add-sub') addSub(b.dataset.code);
  else if(a==='rename') rename(b.dataset.code);
  else if(a==='delete') del(b.dataset.code);
  else if(a==='toggle') toggle(b);
  else if(a==='template') template();
  else if(a==='import') root.querySelector('#ts2File')?.click();
});
document.addEventListener('change',e=>{
  if(e.target?.id!=='ts2File') return;
  const f=e.target.files?.[0]; e.target.value=''; if(f) importFile(f);
});
})();
