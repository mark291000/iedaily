(function(){
'use strict';
/* =====================================================================
   HARDCODED USERS + SINGLE LOGIN + TEAM-ADMIN VIEW OTHER TEAMS
   - User list: js/data/users.js (window.HARDCODED_USER_ROWS)
   - Tables users / user_team_roles / teams are NOT read from / written to
     the database. Tasks, projects, time off... still use Supabase.
   - Only one login type: user + password (Viewer login removed).
   - App Admin  : team dropdown = all teams, full rights (unchanged).
   - Team Admin : team dropdown = all teams.
                  Own teams -> normal rights. Other teams -> view only.
   - Member     : unchanged (own team; switch between own teams if >1).
   ===================================================================== */
const HARDCODED_USER_ROWS = Array.isArray(window.HARDCODED_USER_ROWS) ? window.HARDCODED_USER_ROWS : []; // data: js/data/users.js
window.HARDCODED_USER_ROWS = HARDCODED_USER_ROWS;
const N = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toRole = r => N(r)==='app admin' ? 'Admin' : (N(r)==='team admin' ? 'Team Admin' : 'Member');

/* ---------- build users / user_team_roles / teams rows ---------- */
const HC = { users: [], roles: [], teams: [] };
(function build(){
  const byName = new Map(); let roleId = 1;
  HARDCODED_USER_ROWS.forEach(r => {
    const k = N(r.member); if(!k) return;
    let u = byName.get(k);
    if(!u){
      u = { id: byName.size + 1, name: String(r.member).trim(), password: String(r.password), role: toRole(r.role),
            team: String(r.team).trim(), status: 'Active', show_in_reports: true, created_at: '', updated_at: '' };
      byName.set(k, u); HC.users.push(u);
    }
    if(!HC.roles.some(x => x.user_id === u.id && N(x.team) === N(r.team))){
      HC.roles.push({ id: roleId++, user_id: u.id, team: String(r.team).trim(),
                      role: toRole(r.role)==='Admin' ? 'Team Admin' : toRole(r.role),
                      is_primary: N(r.team) === N(u.team) });
    }
  });
  const teams = [...new Set(HARDCODED_USER_ROWS.map(r => String(r.team).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  HC.teams = teams.map((t,i) => ({ id: i + 1, code: t, name: t, status: 'Active' }));
})();
window.HARDCODED_USERS = HC;

/* ---------- fake query builder for the hardcoded tables ---------- */
const HC_TABLES = new Set(['users','user_team_roles','teams']);
const READ_ONLY_MSG = 'User data is hardcoded in js/data/users.js. Edit that file to add or change users.';
class HCQuery{
  constructor(table){ this.t = table; this.f = []; this.op = 'select'; this.ord = []; this.rng = null; this.lim = null; this.sing = false; this.maybe = false; }
  select(){ return this; }
  insert(){ this.op = 'write'; return this; } update(){ this.op = 'write'; return this; }
  upsert(){ this.op = 'write'; return this; } delete(){ this.op = 'write'; return this; }
  eq(c,v){ this.f.push(r => String(r[c] ?? '') === String(v ?? '')); return this; }
  neq(c,v){ this.f.push(r => String(r[c] ?? '') !== String(v ?? '')); return this; }
  in(c,a){ const s = new Set((a||[]).map(String)); this.f.push(r => s.has(String(r[c]))); return this; }
  is(c,v){ this.f.push(r => v === null ? r[c] == null : r[c] === v); return this; }
  not(c,op,v){ if(op === 'is' && v === null) this.f.push(r => r[c] != null); return this; }
  gte(c,v){ this.f.push(r => String(r[c]) >= String(v)); return this; }
  lte(c,v){ this.f.push(r => String(r[c]) <= String(v)); return this; }
  ilike(c,p){ const re = new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*') + '$','i'); this.f.push(r => re.test(String(r[c] ?? ''))); return this; }
  or(){ return this; } match(o){ Object.entries(o||{}).forEach(([c,v]) => this.eq(c,v)); return this; }
  order(c,o){ this.ord.push([c, !(o && o.ascending === false)]); return this; }
  range(a,b){ this.rng = [a,b]; return this; } limit(n){ this.lim = n; return this; }
  single(){ this.sing = true; return this; } maybeSingle(){ this.sing = true; this.maybe = true; return this; }
  async exec(){
    if(this.op === 'write') return { data: null, error: { message: READ_ONLY_MSG } };
    let rows = (HC[this.t === 'user_team_roles' ? 'roles' : this.t] || []).map(r => ({ ...r })).filter(r => this.f.every(fn => fn(r)));
    if(this.ord.length) rows.sort((a,b) => { for(const [c,asc] of this.ord){ const x = a[c], y = b[c]; if(x === y) continue; const d = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric:true}); if(d) return asc ? d : -d; } return 0; });
    if(this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if(this.lim != null) rows = rows.slice(0, this.lim);
    if(this.sing) return rows.length ? { data: rows[0], error: null } : { data: null, error: this.maybe ? null : { message: 'No rows found' } };
    return { data: rows, error: null };
  }
  then(a,b){ return this.exec().then(a,b); }
  catch(b){ return this.exec().catch(b); }
}
function patchClient(c){
  if(!c || c.__hcUsersPatched || typeof c.from !== 'function') return c;
  const realFrom = c.from.bind(c);
  c.from = table => HC_TABLES.has(String(table)) ? new HCQuery(String(table)) : realFrom(table);
  c.__hcUsersPatched = true;
  return c;
}
try{ patchClient(supabaseClient); }catch(_){}
const prevInit = initSupabaseClient;
initSupabaseClient = function(){ const c = prevInit.apply(this, arguments); try{ patchClient(c); patchClient(supabaseClient); }catch(_){} return c; };
window.initSupabaseClient = initSupabaseClient;

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

handleLogin = async function(e){
  e.preventDefault();
  const errDiv = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errDiv.classList.add('hidden'); errDiv.style.display = 'none';
  if(btn){ btn.disabled = true; btn.textContent = 'Connecting...'; }
  try{
    if(!initSupabaseClient()) throw supabaseInitError || new Error('Supabase client is not available.');
    users = HC.users.map(mapDbUserToApp);
    const uName = document.getElementById('loginUsername').value.trim();
    const pWord = document.getElementById('loginPassword').value.trim();
    if(!uName || !pWord) throw new Error('Please enter both username and password.');
    const row = HARDCODED_USER_ROWS.find(r => N(r.member) === N(uName) && String(r.password) === pWord);
    if(!row) throw new Error('Invalid username or password.');
    const base = users.find(u => N(u.name) === N(row.member));
    if(!base || N(base.status) !== 'active') throw new Error('This account is inactive.');
    const team = String(row.team || '').trim();
    if(!team) throw new Error('This account is not assigned to a team.');
    currentUser = { ...base, team, role: toRole(row.role) };
    window.activeTeamView = team;
    const loaded = await fetchAllDataFromSheet();
    if(!loaded) throw new Error('Unable to load application data from Supabase.');
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
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Log In'; }
  }
};
window.handleLogin = handleLogin;

/* ---------- reversible read-only mode (used when a Team Admin views another team) ---------- */
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
const allTeams = () => HC.teams.map(t => t.code);

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
    if(currentUser.__viewAs){               // leave view mode -> back to the real account
      clearViewerReadOnlyMode();
      currentUser = real;
    }
    await inheritedSwitch.call(this, own.team);
    try{ initUserSession(); }catch(_){}
  }else{
    if(!currentUser.__viewAs){              // enter view mode with a read-only clone
      currentUser = { id:'readonly-viewer', name:real.name, username:real.name, role:'Viewer', status:'Active',
                      isReadOnly:true, team:String(currentUser.team || ''), __viewAs:real };
    }
    await inheritedSwitch.call(this, team); // viewer branch: loads the selected team
    try{ applyViewerReadOnlyMode(); }catch(_){}
    if(!document.getElementById('tab-users')?.classList.contains('hidden')) try{ switchTab('overall'); }catch(_){}
  }
  window.renderTeamSwitcher();
};
try{ switchTeamView = window.switchTeamView; }catch(_){}

/* logout: always leave view mode cleanly */
const prevLogout = window.logout;
if(typeof prevLogout === 'function'){
  window.logout = function(){ clearViewerReadOnlyMode(); return prevLogout.apply(this, arguments); };
  try{ logout = window.logout; }catch(_){}
}

/* Users page: every write path explains that users are maintained in code. */
['saveUser','deleteUser','mtrDeleteUser','mtrToggleShow','createTeam','mtrOpenUser','openAddUserModal','openEditUserModal','openTeamModal','handleUserImport']
  .forEach(name => { window[name] = function(e){ try{ e?.preventDefault?.(); }catch(_){} showAppNotification(READ_ONLY_MSG, 'Users are hardcoded'); };
                     try{ (0,eval)(name + ' = window.' + name + ';'); }catch(_){} });
document.getElementById('mtrUserForm')?.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); showAppNotification(READ_ONLY_MSG, 'Users are hardcoded'); }, true);
})();
