(window.__appFiles=window.__appFiles||{})['45-hardcodedUsersV1']='1.5.0';
(function(){
'use strict';
/* =====================================================================
   HARDCODED LOGIN + DATABASE-DRIVEN USER / TEAM / ROLE
   - Hardcoded rows are used ONLY to validate username + password.
   - After successful login, users, status, team memberships and roles are
     loaded from Supabase tables users, user_team_roles and teams.
   - No Supabase table is mocked or replaced by hardcoded data.
   ===================================================================== */
const HARDCODED_USER_ROWS = Array.isArray(window.HARDCODED_USER_ROWS) ? window.HARDCODED_USER_ROWS : [];
window.HARDCODED_USER_ROWS = HARDCODED_USER_ROWS;
const N = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- single login type: user + password ---------- */
const prevSetLoginMode = setLoginMode;
setLoginMode = function(){ try{ prevSetLoginMode('member'); }catch(_){} };
window.setLoginMode = setLoginMode;
function prepareLoginForm(){
  setLoginMode('member');
  const u = document.getElementById('loginUsername'); if(u) u.placeholder = 'Enter user name';
  const t = document.getElementById('loginTeam'); if(t){ t.required = false; t.disabled = true; }
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareLoginForm, { once:true });
else prepareLoginForm();

async function loadDatabaseIdentity(username){
  const client = initSupabaseClient();
  if(!client) throw supabaseInitError || new Error('Supabase client is not available.');

  // Resolve the person from the real database. Never use hardcoded Team/Role.
  const userResult = await client.from('users').select('*').ilike('name', String(username).trim()).limit(10);
  if(userResult.error) throw new Error('Unable to load user profile from database: ' + userResult.error.message);
  const matches = (userResult.data || []).filter(r => N(r.name) === N(username));
  if(matches.length !== 1) throw new Error(matches.length ? 'More than one database user has this name. Please ask the administrator to correct duplicate user records.' : 'Login is valid, but this user does not exist in the database.');

  const dbRow = matches[0];
  const base = mapDbUserToApp(dbRow);
  if(N(base.status) !== 'active') throw new Error('This account is inactive in the database.');

  // Load the real team list and memberships before initializing the session.
  const teamResult = await client.from('teams').select('*').order('code', {ascending:true});
  if(teamResult.error){
    console.warn('Teams table could not be loaded; team options will be derived from database memberships/data:', teamResult.error.message);
    window.teamsTableRows = [];
  }else window.teamsTableRows = teamResult.data || [];

  const roleResult = await client.from('user_team_roles').select('id,user_id,team,role,is_primary').eq('user_id', dbRow.id).order('id', {ascending:true});
  if(roleResult.error) throw new Error('Unable to load team permissions from database: ' + roleResult.error.message);

  const dbRole = N(dbRow.role);
  const isAppAdmin = dbRole === 'admin' || dbRole === 'app admin';
  const memberships = (roleResult.data || []).map(r => ({
    team: String(r.team || '').trim(),
    role: N(r.role) === 'admin' || N(r.role) === 'app admin' ? 'Team Admin' :
          (N(r.role) === 'team admin' ? 'Team Admin' : (N(r.role) === 'viewer' ? 'Viewer' : 'Member')),
    primary: !!r.is_primary
  })).filter(m => m.team);

  // Backward compatibility: if the membership table has no row for this user,
  // use the primary team/role stored in the DATABASE users row only.
  const dbTeam = String(dbRow.team || '').trim();
  const normalizedDbRole = isAppAdmin ? 'Admin' :
    (dbRole === 'team admin' ? 'Team Admin' : (dbRole === 'viewer' ? 'Viewer' : 'Member'));
  if(!memberships.length && dbTeam){
    memberships.push({team:dbTeam, role:normalizedDbRole === 'Admin' ? 'Team Admin' : normalizedDbRole, primary:true});
  }
  if(!isAppAdmin && !memberships.length){
    throw new Error('Login is valid, but no Team or role is assigned to this user in the database.');
  }

  const primary = memberships.find(m => m.primary) || memberships[0] || null;
  const primaryTeam = isAppAdmin ? (dbTeam || String(window.teamsTableRows[0]?.code || '').trim()) : primary.team;
  const primaryRole = isAppAdmin ? 'Admin' : primary.role;
  if(!primaryTeam) throw new Error('No team is available for this user in the database.');

  return {
    ...base,
    id: dbRow.id,
    name: String(dbRow.name || username).trim(),
    username: String(dbRow.name || username).trim(),
    team: primaryTeam,
    role: primaryRole,
    memberships: isAppAdmin ? memberships : memberships,
    __base: {team:primaryTeam, role:primaryRole}
  };
}

handleLogin = async function(e){
  e.preventDefault();
  const errDiv = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errDiv.classList.add('hidden'); errDiv.style.display = 'none';
  if(btn){ btn.disabled = true; btn.textContent = 'Connecting...'; }
  try{
    if(!initSupabaseClient()) throw supabaseInitError || new Error('Supabase client is not available.');
    const uName = document.getElementById('loginUsername').value.trim();
    const pWord = document.getElementById('loginPassword').value.trim();
    if(!uName || !pWord) throw new Error('Please enter both username and password.');

    // Authentication only: the hardcoded row contributes no Team or Role.
    const credentialOk = HARDCODED_USER_ROWS.some(r => N(r.member) === N(uName) && String(r.password ?? '') === pWord);
    if(!credentialOk) throw new Error('Invalid username or password.');

    currentUser = await loadDatabaseIdentity(uName);
    window.activeTeamView = currentUser.team;
    const loaded = await fetchAllDataFromSheet();
    if(!loaded) throw new Error('Unable to load application data from Supabase.');
    if(!currentUser || !currentUser.team || !currentUser.role) throw new Error('Database authorization could not be initialized.');

    document.getElementById('loginScreen').classList.add('hidden');
    initUserSession();
    subscribeSupabaseRealtime();
    startMultiUserAutoSync();
    applyGlobalFilters();
    switchTab('overall');
  }catch(err){
    console.error('Login error:', err);
    errDiv.textContent = err?.message || 'Unable to sign in.';
    errDiv.classList.remove('hidden'); errDiv.style.display = 'block';
    currentUser = null;
    window.activeTeamView = '';
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Log In'; }
  }
};
window.handleLogin = handleLogin;

/* ---------- reversible read-only mode (Team Admin viewing another team) ---------- */
const RO_BTN = /create|add task|new task|edit task|delete task|save task|save project|new project|add project|register|approve|reject|submit request|time.?off request|manage user|add phase|add milestone|delete project|edit project/;
const RO_CLICK = /create|add task|new task|edit task|delete task|save|register|approve|reject|submit request|add phase|add milestone|delete project|edit project/;
let roGuardInstalled = false;
applyViewerReadOnlyMode = function(){
  document.body.classList.add('viewer-read-only');
  const badge = document.getElementById('currentUserRoleBadge'); if(badge) badge.textContent = 'Viewer';
  document.querySelectorAll('button,a,[role="button"]').forEach(el => {
    if(el.closest('#loginScreen,#teamSwitcherCard')) return;
    const label = ((el.innerText||el.getAttribute('aria-label')||el.title||'')+' '+(el.getAttribute('onclick')||'')).toLowerCase();
    if(RO_BTN.test(label) && el.style.display !== 'none'){ el.dataset.roHidden = '1'; el.style.display = 'none'; }
  });
  document.querySelectorAll('input,select,textarea').forEach(el => {
    if(el.closest('#loginScreen,#teamSwitcherCard')) return;
    const k = ((el.id||'')+' '+(el.name||'')).toLowerCase();
    if(/search|filter|date|month|year|week|category|status|pic|owner|priority|view|page/.test(k)) return;
    if(el.type === 'button' || el.type === 'submit' || el.disabled) return;
    el.dataset.roDisabled = '1'; el.disabled = true;
  });
  if(!roGuardInstalled){
    roGuardInstalled = true;
    document.body.addEventListener('click', ev => {
      if(!currentUser?.isReadOnly) return;
      const el = ev.target.closest('button,a,[role="button"]'); if(!el || el.closest('#teamSwitcherCard')) return;
      const label = ((el.innerText||el.getAttribute('aria-label')||el.title||'')+' '+(el.getAttribute('onclick')||'')).toLowerCase();
      if(RO_CLICK.test(label)){
        ev.preventDefault(); ev.stopImmediatePropagation();
        try{ showAppNotification('You are viewing another team (view only). Switch back to your team to make changes.', 'View only'); }catch(_){}
      }
    }, true);
  }
};
window.applyViewerReadOnlyMode = applyViewerReadOnlyMode;
function clearViewerReadOnlyMode(){
  document.body.classList.remove('viewer-read-only');
  document.querySelectorAll('[data-ro-hidden]').forEach(el => { el.style.display = ''; delete el.dataset.roHidden; });
  document.querySelectorAll('[data-ro-disabled]').forEach(el => { el.disabled = false; delete el.dataset.roDisabled; });
  const nav = document.getElementById('nav-workload'); if(nav) nav.style.display = '';
}

/* ---------- Team Admin: dropdown of all teams, other teams = view only ---------- */
const realUser = () => currentUser ? (currentUser.__viewAs || currentUser) : null;
const isAppAdminUser = u => !!u && (u.role === 'Admin' || u.__base?.role === 'Admin');
function myMemberships(u){
  if(!u) return [];
  if(Array.isArray(u.memberships) && u.memberships.length) return u.memberships;
  try{ return window.getUserMemberships?.({ id:u.id, team:u.__base?.team || u.team, role:u.__base?.role || u.role }) || []; }catch(_){ return []; }
}
const isTeamAdminUser = u => !!u && !isAppAdminUser(u) && myMemberships(u).some(m => m.role === 'Team Admin');
const allTeams = () => (window.computeKnownTeams?.() || window.teamsTableRows?.map(t => t.code) || []).filter(Boolean);

function ensureSwitchBox(){
  let box = document.getElementById('mtrSwitchBox');
  if(!box){
    const card = document.getElementById('teamSwitcherCard'); if(!card) return null;
    box = document.createElement('div'); box.id = 'mtrSwitchBox';
    box.innerHTML = '<label for="mtrScopeSel" class="sr-only">Active team</label><select id="mtrScopeSel"></select><p class="mt-1.5 text-[10px] text-slate-400" id="mtrScopeHint"></p>';
    const label = document.getElementById('teamStaticLabel');
    label ? label.insertAdjacentElement('afterend', box) : card.appendChild(box);
    box.querySelector('select').addEventListener('change', e => window.switchTeamView(e.target.value));
  }
  box.setAttribute('data-mtr-free','1');
  return box;
}

const inheritedRender = window.renderTeamSwitcher;
window.renderTeamSwitcher = function(){
  const result = typeof inheritedRender === 'function' ? inheritedRender.apply(this, arguments) : undefined;
  const real = realUser();
  if(!isTeamAdminUser(real)) return result;
  const box = ensureSwitchBox(); if(!box) return result;
  const mine = myMemberships(real);
  const others = allTeams().filter(t => !mine.some(m => N(m.team) === N(t)));
  const sel = box.querySelector('select');
  sel.innerHTML =
    '<optgroup label="My teams">' + mine.map(m => `<option value="${ESC(m.team)}">${ESC(m.team)} · ${ESC(m.role)}</option>`).join('') + '</optgroup>' +
    (others.length ? '<optgroup label="Other teams (view only)">' + others.map(t => `<option value="${ESC(t)}">${ESC(t)} · View</option>`).join('') + '</optgroup>' : '');
  const active = String(window.activeTeamView || currentUser.team || '').trim();
  const opt = [...sel.options].find(o => N(o.value) === N(active)); if(opt) sel.value = opt.value;
  sel.disabled = false;
  box.classList.remove('hidden'); box.classList.toggle('v20-viewer-team-picker', !!currentUser.__viewAs);
  document.getElementById('teamStaticLabel')?.classList.add('hidden');
  document.getElementById('teamAdminControls')?.classList.add('hidden');
  const hint = document.getElementById('mtrScopeHint');
  if(hint) hint.textContent = currentUser.__viewAs ? 'View only · switch back to your team to edit.' : 'Choose a team. Other teams are view only.';
  const greet = document.getElementById('teamGreeting'); if(greet) greet.textContent = sel.value || active;
  return result;
};
try{ renderTeamSwitcher = window.renderTeamSwitcher; }catch(_){}

const inheritedSwitch = window.switchTeamView;
window.switchTeamView = async function(value){
  const real = realUser();
  if(!isTeamAdminUser(real)) return typeof inheritedSwitch === 'function' ? inheritedSwitch.apply(this, arguments) : undefined;
  const team = allTeams().find(t => N(t) === N(value)) || String(value || '').trim();
  if(!team) return;
  const own = myMemberships(real).find(m => N(m.team) === N(team));
  if(own){
    if(currentUser.__viewAs){ clearViewerReadOnlyMode(); currentUser = real; }
    await inheritedSwitch.call(this, own.team);
    try{ initUserSession(); }catch(_){}
  }else{
    if(!currentUser.__viewAs){
      currentUser = { id:'readonly-viewer', name:real.name, username:real.name, role:'Viewer', status:'Active',
                      isReadOnly:true, team:team, __viewAs:real };
    }else{
      currentUser.team = team;
      currentUser.role = 'Viewer';
      currentUser.isReadOnly = true;
    }
    // Team Admin may inspect teams outside their memberships as read-only.
    window.activeTeamView = team;
    window.__loadedTaskKey = null;
    try{ bomTopFilterState.Category.clear(); bomTopFilterState.Member.clear(); }catch(_){}
    const loaded = await window.fetchAllDataFromSheet({background:false, forceRender:true});
    if(!loaded) throw new Error('Unable to load the selected team from Supabase.');
    try{ applyViewerReadOnlyMode(); }catch(_){}
    if(!document.getElementById('tab-users')?.classList.contains('hidden')) try{ switchTab('overall'); }catch(_){}
  }
  window.renderTeamSwitcher();
};
try{ switchTeamView = window.switchTeamView; }catch(_){}

const prevLogout = window.logout;
if(typeof prevLogout === 'function'){
  window.logout = function(){ clearViewerReadOnlyMode(); window.activeTeamView = ''; window.__loadedTaskKey = null; return prevLogout.apply(this, arguments); };
  try{ logout = window.logout; }catch(_){}
}

/* User and team administration uses the real Supabase tables. */
})();
