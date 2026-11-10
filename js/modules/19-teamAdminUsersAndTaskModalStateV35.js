/* =====================================================================
   V35 - Team Admin user management + Task/Project popup state keeper
   ===================================================================== */
(function(){
  const nt = v => String(v ?? '').trim().toLowerCase();
  const $ = id => document.getElementById(id);
  const sessionRole = () => String(currentUser?.role || '');
  const isAppAdmin = () => (typeof window.isAdminSession === 'function' ? window.isAdminSession() : sessionRole()==='Admin');
  const isTA = () => !isAppAdmin() && sessionRole()==='Team Admin' && !currentUser?.isReadOnly;
  const TA_ROLES = ['Team Admin','Member','Viewer'];

  /* ---------------- PERMISSIONS ---------------- */
  const canManage = () => !!currentUser && !currentUser.isReadOnly && (isAppAdmin() || isTA());
  const inScope   = u => isAppAdmin() || (isTA() && nt(u?.team) === nt(currentUser?.team));
  const canModify = u => inScope(u) && (isAppAdmin() || TA_ROLES.includes(String(u?.role || '')));
  window.canCurrentSessionManageUsers = canManage;

  const deny = () => showAppNotification('Only App Admin or Team Admin can manage users.','Permission denied');

  function showUsersNav(){
    const ok = canManage();
    $('nav-users')?.classList.toggle('hidden', !ok);
    $('nav-users-divider')?.classList.toggle('hidden', !ok);
    document.querySelectorAll('[onclick*="openAddUserModal"]').forEach(b => b.classList.toggle('hidden', !ok));
  }
  const prevInit = initUserSession;
  initUserSession = function(){ const r = prevInit.apply(this, arguments); showUsersNav(); return r; };
  window.initUserSession = initUserSession;

  /* ---------------- USERS TABLE ---------------- */
  renderUserManagementTable = function(){
    const tb = $('userManagementTableBody'); if(!tb) return;
    tb.innerHTML = '';
    users.forEach((u, idx) => {
      if(!inScope(u)) return;
      const ed = canModify(u);
      const tr = document.createElement('tr');
      tr.className = 'border-b hover:bg-slate-50';
      tr.innerHTML = `
        <td class="py-3 px-4 font-bold">${escapeHtml(u.name||'')}</td>
        <td class="py-3 px-3 text-center font-mono">${escapeHtml(String(u.password||''))}</td>
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">${escapeHtml(u.role==='Admin'?'App Admin':(u.role||'Member'))}</span></td>
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.status==='Active'?'bg-emerald-100 text-emerald-800':'bg-red-100 text-red-800'}">${escapeHtml(u.status||'Inactive')}</span></td>
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded ${u.role==='Admin'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-700'} text-[10px] font-bold">${escapeHtml(u.team || (u.role==='Admin'?'All teams':'—'))}</span></td>
        <td class="py-3 px-4 text-center">${ed
          ? `<button type="button" onclick="openEditUserModal(${idx})" class="text-slate-400 hover:text-indigo-600 mr-3" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button><button type="button" onclick="deleteUser(${idx})" class="text-slate-400 hover:text-red-600" title="Delete"><i class="fa-solid fa-trash"></i></button>`
          : '<span class="text-[10px] text-slate-400">View only</span>'}</td>`;
      tb.appendChild(tr);
    });
  };
  window.renderUserManagementTable = renderUserManagementTable;

  /* ---------------- USER MODAL ---------------- */
  function configureUserModal(selectedTeam){
    const rs = $('userRole'), ts = $('userTeam');
    if(rs){
      Array.from(rs.options).forEach(o => {
        const v = o.value || o.text;
        const off = isTA() && !TA_ROLES.includes(v);
        o.disabled = off; o.hidden = off;
      });
      if(isTA() && !TA_ROLES.includes(rs.value)) rs.value = 'Member';
    }
    if(ts){
      if(isTA()){
        const t = String(currentUser?.team || '').trim();
        if(!Array.from(ts.options).some(o => nt(o.value) === nt(t))) ts.add(new Option(t, t));
        ts.value = Array.from(ts.options).find(o => nt(o.value) === nt(t))?.value || t;
        ts.disabled = true;
      }else{
        if(typeof window.prepareUserTeamField === 'function') window.prepareUserTeamField(selectedTeam || '');
        ts.disabled = (rs?.value === 'Admin');
        if(rs?.value === 'Admin') ts.value = '';
      }
    }
  }
  $('userRole')?.addEventListener('change', () => { if(!isTA()) configureUserModal($('userTeam')?.value || ''); });

  function showUserModal(){
    $('userModal').classList.remove('opacity-0','pointer-events-none');
    document.body.classList.add('modal-active');
  }

  openAddUserModal = function(){
    if(!canManage()) return deny();
    $('userEditIndex').value = '';
    $('userModalTitle').innerText = 'Add User';
    $('userName').value = '';
    $('userPassword').value = '';
    $('userRole').value = 'Member';
    $('userStatus').value = 'Active';
    configureUserModal(isTA() ? currentUser.team : '');
    showUserModal();
  };
  openEditUserModal = function(idx){
    if(!canManage()) return deny();
    const u = users[idx]; if(!u) return;
    if(!canModify(u)) return showAppNotification('Team Admin can only edit Team Admin, Member and Viewer accounts in their own team.','Permission denied');
    $('userEditIndex').value = idx;
    $('userModalTitle').innerText = 'Edit User';
    $('userName').value = u.name || '';
    $('userPassword').value = u.password || '';
    $('userRole').value = u.role || 'Member';
    $('userStatus').value = u.status || 'Active';
    configureUserModal(u.team || '');
    showUserModal();
  };
  const prevClose = closeUserModal;
  closeUserModal = function(){ const ts = $('userTeam'); if(ts) ts.disabled = false; return prevClose.apply(this, arguments); };
  window.openAddUserModal = openAddUserModal; window.openEditUserModal = openEditUserModal; window.closeUserModal = closeUserModal;

  /* ---------------- SAVE / DELETE (single row, no id on insert) ---------------- */
  async function saveUserRow(d, existing){
    if(!initSupabaseClient()) throw new Error('Supabase client is not initialized.');
    const payload = {
      name: String(d.name).trim(),
      password: String(d.password),
      role: d.role,
      status: d.status,
      team: d.role === 'Admin' ? null : (String(d.team || '').trim() || null)
    };
    const id = Number(existing?.id);
    const res = (Number.isSafeInteger(id) && id > 0)
      ? await supabaseClient.from('users').update(payload).eq('id', id).select('*').single()
      : await supabaseClient.from('users').insert(payload).select('*').single();
    if(res.error) throw res.error;
    return mapDbUserToApp(res.data);
  }

  saveUser = async function(e){
    e.preventDefault();
    if(!canManage()) return deny();
    const iv = $('userEditIndex').value;
    const ei = iv === '' ? -1 : Number(iv);
    const existing = ei >= 0 ? users[ei] : null;
    const name = $('userName').value.trim();
    const password = $('userPassword').value;
    const role = $('userRole').value;
    const status = $('userStatus').value;
    if(!name || !password) return showAppNotification('Member name and password are required.','Validation');

    let team = role === 'Admin' ? '' : String($('userTeam')?.value || '').trim();
    if(isTA()){
      if(existing && !canModify(existing)) return showAppNotification('You cannot modify this account.','Permission denied');
      if(!TA_ROLES.includes(role)) return showAppNotification('Team Admin can only assign Team Admin, Member or Viewer.','Permission denied');
      team = String(currentUser.team || '').trim();
    }
    if(role !== 'Admin' && !team) return showAppNotification('Please select a Team for this member.','Validation');
    if(users.some((u,i) => i !== ei && nt(u.name) === nt(name))) return showAppNotification('Member name already exists.','Validation');

    try{
      const saved = await saveUserRow({name, password, role, status, team}, existing);
      if(ei < 0) users.push(saved); else users[ei] = saved;
      const isSelf = currentUser && String(currentUser.id) === String(saved.id);
      if(isSelf) currentUser = {...currentUser, ...saved};
      sheetSyncSnapshots.Users = JSON.parse(JSON.stringify(users));
      lastLocalSaveAt.Users = Date.now();
      if(isSelf) initUserSession();
      renderUserManagementTable();
      populateFilterOptions();
      closeUserModal();
      showAppNotification(ei < 0 ? 'User created successfully.' : 'User updated successfully.');
    }catch(err){
      console.error('Supabase Save Error [Users]:', err);
      showAppNotification(`Unable to save Users to Supabase. ${err.message || ''}`,'Database Error');
    }
  };

  deleteUser = async function(idx){
    if(!canManage()) return deny();
    const u = users[idx]; if(!u) return;
    if(!canModify(u)) return showAppNotification('You cannot delete this account.','Permission denied');
    if(currentUser && String(currentUser.id) === String(u.id)) return showAppNotification('You cannot delete your own account.','Permission denied');
    if(!(await showAppConfirm('Delete this user?'))) return;
    try{
      const id = Number(u.id);
      if(Number.isSafeInteger(id) && id > 0){
        const {error} = await supabaseClient.from('users').delete().eq('id', id);
        if(error) throw error;
      }
      users.splice(idx, 1);
      sheetSyncSnapshots.Users = JSON.parse(JSON.stringify(users));
      lastLocalSaveAt.Users = Date.now();
      renderUserManagementTable();
      populateFilterOptions();
      showAppNotification('User deleted successfully.');
    }catch(err){
      console.error('Supabase Delete Error [Users]:', err);
      showAppNotification(`Unable to delete User from Supabase. ${err.message || ''}`,'Database Error');
    }
  };
  window.saveUser = saveUser; window.deleteUser = deleteUser;

  /* =====================================================================
     TASK / PROJECT POPUP STATE KEEPER
     Background refresh (realtime, polling, populateFilterOptions) rebuilds
     dropdowns and PIC checkboxes. While a popup is open, capture the user's
     input before the rebuild and restore it afterwards.
     ===================================================================== */
  const isOpen = id => { const m = $(id); return !!m && !m.classList.contains('pointer-events-none'); };

  function captureModal(modalId){
    const m = $(modalId); if(!m || !isOpen(modalId)) return null;
    const st = {modalId, values:{}, checks:{}, hidden:{}, pics:{}};
    m.querySelectorAll('input,select,textarea').forEach(el => {
      if(!el.id) return;
      if(el.type === 'checkbox' || el.type === 'radio') st.checks[el.id] = el.checked;
      else if(el.type !== 'file') st.values[el.id] = el.value;
    });
    ['taskNameOther'].forEach(id => { const el = $(id); if(el && m.contains(el)) st.hidden[id] = el.classList.contains('hidden'); });
    st.pics.task = Array.from(m.querySelectorAll('.task-pic-checkbox:checked')).map(c => c.value);
    st.pics.project = Array.from(m.querySelectorAll('.project-pic-checkbox:checked')).map(c => c.value);
    if(modalId === 'taskModal'){ try{ st.scopeFlag = taskScopeUserChanged; }catch(_){} }
    return st;
  }

  function ensureTaskNameOptions(st){
    const cat = $('taskCategory'), nameSel = $('taskNameSelect');
    if(!cat || !nameSel) return;
    const wantedName = st.values.taskNameSelect;
    if(cat.value && wantedName && !Array.from(nameSel.options).some(o => o.value === wantedName)){
      try{ onTaskCategoryChange(); }catch(_){}
    }
  }

  function restoreModal(st){
    if(!st) return;
    const m = $(st.modalId); if(!m) return;
    const setVal = (id, v) => {
      const el = $(id); if(!el || !m.contains(el)) return;
      if(el.tagName === 'SELECT'){
        if(!Array.from(el.options).some(o => String(o.value) === String(v))){
          if(v === '' || v == null) return;
          el.add(new Option(v, v));          // keep the chosen value even if the list was rebuilt without it
        }
      }
      el.value = v;
    };
    if('taskCategory' in st.values) setVal('taskCategory', st.values.taskCategory);
    if(st.modalId === 'taskModal') ensureTaskNameOptions(st);
    Object.entries(st.values).forEach(([id, v]) => setVal(id, v));
    Object.entries(st.checks).forEach(([id, c]) => { const el = $(id); if(el && m.contains(el)) el.checked = c; });
    Object.entries(st.hidden).forEach(([id, h]) => $(id)?.classList.toggle('hidden', h));
    m.querySelectorAll('.task-pic-checkbox').forEach(c => { c.checked = st.pics.task.includes(c.value); });
    m.querySelectorAll('.project-pic-checkbox').forEach(c => { c.checked = st.pics.project.includes(c.value); });
    if('scopeFlag' in st){ try{ taskScopeUserChanged = st.scopeFlag; }catch(_){} }
  }

  let keeperDepth = 0;
  function keepPopupState(fn){
    return function(){
      if(keeperDepth > 0) return fn.apply(this, arguments);
      const states = ['taskModal','projectModal'].map(captureModal).filter(Boolean);
      if(!states.length) return fn.apply(this, arguments);
      keeperDepth++;
      let result;
      try{ result = fn.apply(this, arguments); }
      finally{ keeperDepth--; }
      const restore = () => states.forEach(restoreModal);
      restore();
      if(result && typeof result.then === 'function') return result.then(r => { restore(); return r; });
      return result;
    };
  }

  // Wrap every function that rebuilds popup dropdowns / PIC lists from background refresh.
  ['populateFilterOptions','renderPICCheckboxLists'].forEach(name => {
    try{
      const orig = eval(name);
      if(typeof orig !== 'function') return;
      const wrapped = keepPopupState(orig);
      eval(`${name} = wrapped`);
      window[name] = wrapped;
    }catch(e){ console.warn('State keeper: cannot wrap', name, e); }
  });

  // Opening a popup must still start clean: run open functions without the keeper.
  ['openAddTaskModal','openEditTaskModal','openAddProjectModal','openEditProjectModal'].forEach(name => {
    try{
      const orig = eval(`typeof ${name} === 'function' ? ${name} : null`);
      if(!orig) return;
      const wrapped = function(){ keeperDepth++; try{ return orig.apply(this, arguments); } finally{ keeperDepth--; } };
      eval(`${name} = wrapped`);
      window[name] = wrapped;
    }catch(_){}
  });

  if(currentUser) showUsersNav();
})();
