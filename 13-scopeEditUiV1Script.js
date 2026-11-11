(function(){
'use strict';
let selectedScopeItemCode='';
function scopeTeam(){ const t=typeof getViewTeam==='function'?getViewTeam():''; return t===window.TEAM_ALL?'':String(t||'').trim(); }
function canEditScope(){ const t=scopeTeam(); return !!t && (isAdminSession() || (isTeamAdminSession() && normTeam(t)===normTeam(currentUser.team))); }
async function scopeAsk(title, def=''){
  const v=prompt(title,def); return v===null?null:String(v).trim();
}
async function scopeReload(){ if(typeof renderScopeFromDb==='function') await renderScopeFromDb(); }
async function scopeNextOrder(table,team){
 const r=await supabaseClient.from(table).select('sort_order').eq('team',team).order('sort_order',{ascending:false}).limit(1);
 if(r.error) throw r.error; return Number(r.data?.[0]?.sort_order||0)+10;
}
window.scopeAddGroup=async function(){
 if(!canEditScope()) return showAppNotification('Select a specific team and sign in as Member/Admin to edit Scope.','Scope');
 const team=scopeTeam(), code=await scopeAsk('Group code (example: 11)'); if(!code)return;
 const title=await scopeAsk('Group title'); if(!title)return;
 const sort_order=await scopeNextOrder('scope_items',team);
 const {error}=await supabaseClient.from('scope_items').insert({team,code,title,parent_code:null,sort_order});
 if(error)return showAppNotification(error.message,'Scope save error'); selectedScopeItemCode=code; await scopeReload();
};
window.scopeAddSubItem=async function(){
 if(!canEditScope()) return showAppNotification('Select a specific team and sign in as Member/Admin to edit Scope.','Scope');
 const team=scopeTeam(); let parent=selectedScopeItemCode;
 if(parent && parent.includes('.')) parent=parent.split('.')[0];
 parent=await scopeAsk('Parent group code',parent||''); if(!parent)return;
 const code=await scopeAsk('Sub-item code (example: 11.1)',parent+'.1'); if(!code)return;
 const title=await scopeAsk('Sub-item title'); if(!title)return;
 const sort_order=await scopeNextOrder('scope_items',team);
 const {error}=await supabaseClient.from('scope_items').insert({team,code,title,parent_code:parent,sort_order});
 if(error)return showAppNotification(error.message,'Scope save error'); selectedScopeItemCode=code; await scopeReload();
};
window.scopeRenameItem=async function(){
 if(!canEditScope())return; const team=scopeTeam();
 const code=await scopeAsk('Scope code to rename',selectedScopeItemCode||''); if(!code)return;
 const q=await supabaseClient.from('scope_items').select('title').eq('team',team).eq('code',code).single(); if(q.error)return showAppNotification(q.error.message,'Scope');
 const title=await scopeAsk('New title',q.data?.title||''); if(!title)return;
 const {error}=await supabaseClient.from('scope_items').update({title}).eq('team',team).eq('code',code); if(error)return showAppNotification(error.message,'Scope save error'); selectedScopeItemCode=code; await scopeReload();
};
window.scopeDeleteItem=async function(){
 if(!canEditScope())return; const team=scopeTeam(); const code=await scopeAsk('Scope code to delete',selectedScopeItemCode||'');if(!code)return;
 if(!(await showAppConfirm('Delete scope '+code+' and its assignments?','Delete Scope')))return;
 let r=await supabaseClient.from('scope_assignments').delete().eq('team',team).eq('item_code',code); if(r.error)return showAppNotification(r.error.message,'Scope delete error');
 r=await supabaseClient.from('scope_items').delete().eq('team',team).eq('code',code); if(r.error)return showAppNotification(r.error.message,'Scope delete error'); selectedScopeItemCode=''; await scopeReload();
};
window.scopeAddMember=async function(){
 if(!canEditScope())return; const team=scopeTeam(); const name=await scopeAsk('Member name');if(!name)return;
 const sort_order=await scopeNextOrder('scope_members',team); const {error}=await supabaseClient.from('scope_members').insert({team,member_name:name,sort_order}); if(error)return showAppNotification(error.message,'Scope save error'); await scopeReload();
};
window.scopeDeleteMember=async function(){
 if(!canEditScope())return; const team=scopeTeam(); const name=await scopeAsk('Member name to remove');if(!name)return;
 if(!(await showAppConfirm('Remove '+name+' from Scope matrix?','Remove Member')))return;
 let r=await supabaseClient.from('scope_assignments').delete().eq('team',team).eq('member_name',name);if(r.error)return showAppNotification(r.error.message,'Scope delete error');
 r=await supabaseClient.from('scope_members').delete().eq('team',team).eq('member_name',name);if(r.error)return showAppNotification(r.error.message,'Scope delete error'); await scopeReload();
};
window.scopeToggleAssignment=async function(){
 if(!canEditScope())return; const team=scopeTeam();
 const code=await scopeAsk('Scope item code',selectedScopeItemCode||'');if(!code)return;
 const name=await scopeAsk('Member name');if(!name)return;
 const q=await supabaseClient.from('scope_assignments').select('*').eq('team',team).eq('item_code',code).eq('member_name',name);
 if(q.error)return showAppNotification(q.error.message,'Scope');
 let error;
 if((q.data||[]).length) ({error}=await supabaseClient.from('scope_assignments').delete().eq('team',team).eq('item_code',code).eq('member_name',name));
 else ({error}=await supabaseClient.from('scope_assignments').insert({team,item_code:code,member_name:name}));
 if(error)return showAppNotification(error.message,'Scope save error'); selectedScopeItemCode=code; await scopeReload();
};
function installToolbar(){
 const tab=document.getElementById('tab-bom-cs-scope');if(!tab||document.getElementById('scopeEditToolbar'))return;
 const frame=tab.querySelector('iframe'); const host=frame?.parentElement;if(host)host.classList.add('scope-frame-host');
 const bar=document.createElement('div');bar.id='scopeEditToolbar';bar.innerHTML='<span class="scope-edit-title"><i class="fa-solid fa-pen-ruler"></i> Scope Editor</span><button class="primary" onclick="scopeAddGroup()">+ Group</button><button onclick="scopeAddSubItem()">+ Sub-item</button><button onclick="scopeRenameItem()">Rename</button><button onclick="scopeToggleAssignment()">Assign / Unassign</button><button onclick="scopeAddMember()">+ Member</button><button onclick="scopeDeleteMember()">Remove Member</button><button class="danger" onclick="scopeDeleteItem()">Delete Scope</button>';
 tab.insertBefore(bar,tab.firstChild);
 }
 const oldSwitch=window.switchTab;
 if(typeof oldSwitch==='function') window.switchTab=function(id){const r=oldSwitch.apply(this,arguments);if(id==='bom-cs-scope'){installToolbar();document.querySelectorAll('#scopeEditToolbar button').forEach(b=>b.disabled=!canEditScope());}return r;};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installToolbar,{once:true});else installToolbar();
})();
