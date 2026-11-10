(function(){
'use strict';
/* =====================================================================
   HARDCODED USER LIST  (source: User_Team_Access.xlsx)
   - To add / change / remove a user: edit HARDCODED_USER_ROWS below.
   - Role: 'App Admin' | 'Team Admin' | 'Member'
   - Same Member name on several rows = ONE account with several team access.
     The FIRST row of that name is the Main team. Logging in with the password
     of a row opens the app in that row's team.
   - Tables users / user_team_roles / teams are NO LONGER read from or written to
     the database. Tasks, projects, time off... still use Supabase as before.
   ===================================================================== */
const HARDCODED_USER_ROWS = Array.isArray(window.HARDCODED_USER_ROWS) ? window.HARDCODED_USER_ROWS : []; // data: js/data/users.js
const N = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const toRole = r => N(r)==='app admin' ? 'Admin' : (N(r)==='team admin' ? 'Team Admin' : (N(r)==='viewer' ? 'Viewer' : 'Member'));
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
window.HARDCODED_USER_ROWS = HARDCODED_USER_ROWS;
window.HARDCODED_USERS = HC;
/* ---------- fake query builder for the hardcoded tables ---------- */
const HC_TABLES = new Set(['users','user_team_roles','teams']);
const READ_ONLY_MSG = 'User data is hardcoded in index.html (HARDCODED_USER_ROWS). Edit the code to add or change users.';
const val = (r,c) => r[c];
class HCQuery{
  constructor(table){ this.t = table; this.f = []; this.op = 'select'; this.ord = []; this.rng = null; this.lim = null; this.sing = false; this.maybe = false; }
  select(){ return this; }
  insert(){ this.op = 'write'; return this; } update(){ this.op = 'write'; return this; }
  upsert(){ this.op = 'write'; return this; } delete(){ this.op = 'write'; return this; }
  eq(c,v){ this.f.push(r => String(val(r,c) ?? '') === String(v ?? '')); return this; }
  neq(c,v){ this.f.push(r => String(val(r,c) ?? '') !== String(v ?? '')); return this; }
  in(c,a){ const s = new Set((a||[]).map(String)); this.f.push(r => s.has(String(val(r,c)))); return this; }
  is(c,v){ this.f.push(r => v === null ? val(r,c) == null : val(r,c) === v); return this; }
  not(c,op,v){ if(op === 'is' && v === null) this.f.push(r => val(r,c) != null); return this; }
  gte(c,v){ this.f.push(r => String(val(r,c)) >= String(v)); return this; }
  lte(c,v){ this.f.push(r => String(val(r,c)) <= String(v)); return this; }
  ilike(c,p){ const re = new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*') + '$','i'); this.f.push(r => re.test(String(val(r,c) ?? ''))); return this; }
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
/* ---------- login: credentials checked against the hardcoded list ---------- */
handleLogin = async function(e){
  e.preventDefault();
  const errDiv = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errDiv.classList.add('hidden'); errDiv.style.display = 'none';
  if(btn){ btn.disabled = true; btn.textContent = 'Connecting...'; }
  try{
    if(!initSupabaseClient()) throw supabaseInitError || new Error('Supabase client is not available.');
    users = HC.users.map(mapDbUserToApp);
    if(loginMode === 'viewer'){
      const viewerTeam = String(document.getElementById('loginTeam')?.value || '').trim();
      if(!viewerTeam) throw new Error('Please select the team you want to view.');
      window.activeTeamView = viewerTeam;
      currentUser = { id:'readonly-viewer', name:'Viewer', username:'Viewer', role:'Viewer', status:'Active', isReadOnly:true, team:viewerTeam };
    }else{
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
    }
    const loaded = await fetchAllDataFromSheet();
    if(!loaded) throw new Error('Unable to load application data from Supabase.');
    document.getElementById('loginScreen').classList.add('hidden');
    initUserSession();
    subscribeSupabaseRealtime();
    startMultiUserAutoSync();
    applyGlobalFilters();
    switchTab('overall');
    if(currentUser?.isReadOnly) applyViewerReadOnlyMode();
  }catch(err){
    console.error('Login error:', err);
    errDiv.textContent = err?.message || 'Unable to sign in.';
    errDiv.classList.remove('hidden'); errDiv.style.display = 'block';
    currentUser = null;
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = loginMode === 'viewer' ? 'Continue as Viewer' : 'Log In'; }
  }
};
window.handleLogin = handleLogin;
/* Users page: every write path explains that users are maintained in code. */
['saveUser','deleteUser','mtrDeleteUser','mtrToggleShow','createTeam','mtrOpenUser','openAddUserModal','openEditUserModal','openTeamModal','handleUserImport']
  .forEach(name => { window[name] = function(e){ try{ e?.preventDefault?.(); }catch(_){} showAppNotification(READ_ONLY_MSG, 'Users are hardcoded'); };
                     try{ (0,eval)(name + ' = window.' + name + ';'); }catch(_){} });
document.getElementById('mtrUserForm')?.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); showAppNotification(READ_ONLY_MSG, 'Users are hardcoded'); }, true);
/* Login "Team" dropdown is built from the hardcoded list (no database call, works instantly). */
function fillLoginTeams(){
  const sel = document.getElementById('loginTeam'); if(!sel) return;
  sel.innerHTML = '<option value="">-- Select team --</option>' + HC.teams.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`).join('');
  sel.disabled = false;
  const err = document.getElementById('loginError'); if(err){ err.textContent=''; err.classList.add('hidden'); err.style.display='none'; }
}
window.loadLoginTeams = fillLoginTeams;
try{ (0,eval)('loadLoginTeams = window.loadLoginTeams;'); }catch(_){}
fillLoginTeams();
document.addEventListener('DOMContentLoaded', fillLoginTeams, { once:true });
})();
