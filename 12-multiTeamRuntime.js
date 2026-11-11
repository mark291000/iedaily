/* =====================================================================
   MULTI-TEAM RUNTIME
   ---------------------------------------------------------------------
   Model
   - Every business row (users, capacity, tasks, timeoff_ot, projects) has a `team` column.
   - Member / Viewer : locked to ONE team. Only that team's rows are ever loaded.
   - Admin           : Users.role = 'Admin' (team = NULL). Sidebar switch -> "All teams" or one team.
   - The rest of the app keeps using the same global arrays (users, capacityData, dailyTasks,
     timeoffOtList, projectsList). They simply hold the rows of the ACTIVE scope, so Dashboard,
     Reports, charts and exports automatically show "this team" or "all teams".
   ===================================================================== */
const TEAM_ALL = '__ALL__';
window.TEAM_ALL = TEAM_ALL;
window.activeTeamView = TEAM_ALL;
window.teamsTableRows = [];
window.__seenTeams = [];

const normTeam = s => String(s ?? '').trim().toLowerCase();
window.normTeam = normTeam;

function isAdminSession() {
  return !!currentUser && currentUser.role === 'Admin' && !currentUser.isReadOnly;
}
function isTeamAdminSession(){
  return !!currentUser && currentUser.role === 'Team Admin' && !currentUser.isReadOnly && !!String(currentUser.team||'').trim();
}
function canManageUsers(){ return isAdminSession() || isTeamAdminSession(); }
function canManageTeams(){ return isAdminSession(); }
function canEditTeamData(team){
  if(isAdminSession()) return true;
  if(!currentUser || currentUser.isReadOnly) return false;
  return normTeam(team) === normTeam(currentUser.team);
}
window.isTeamAdminSession=isTeamAdminSession; window.canManageUsers=canManageUsers; window.canManageTeams=canManageTeams; window.canEditTeamData=canEditTeamData;

window.isAdminSession = isAdminSession;

/* Team whose data is currently displayed ('__ALL__' only possible for Admin). */
function getViewTeam() {
  if (!currentUser) return TEAM_ALL;
  if (isAdminSession()) return window.activeTeamView || TEAM_ALL;
  return String(currentUser.team || '').trim();
}
window.getViewTeam = getViewTeam;

/* Team that NEW rows / imports belong to. null = Admin is in "All teams" view. */
function getWriteTeam() {
  const v = getViewTeam();
  return (v && v !== TEAM_ALL) ? v : null;
}
window.getWriteTeam = getWriteTeam;

/* Team to stamp on a row being written. Non-admins can ONLY write to their own team. */
function resolveTeamOrThrow(row) {
  let t;
  if (!isAdminSession()) t = String(currentUser?.team || '').trim();
  else t = String(row?.team || '').trim() || getWriteTeam() || '';
  if (!t) throw new Error('Please select a specific Team in the sidebar before adding new data.');
  return t;
}
window.resolveTeamOrThrow = resolveTeamOrThrow;

/* Appended to every DELETE: a non-admin can never delete a row of another team,
   even if a stale/forged id slips into the delete list. Fails closed. */
function teamGuard(query) {
  if (currentUser && !isAdminSession()) {
    const t = String(currentUser.team || '').trim();
    return query.eq('team', t || '__no_team__');
  }
  return query;
}
window.teamGuard = teamGuard;

function scopeRowsToTeam(rows) {
  const v = getViewTeam();
  const list = Array.isArray(rows) ? rows : [];
  if (v === TEAM_ALL) return list;
  return list.filter(r => normTeam(r?.team) === normTeam(v));
}
window.scopeRowsToTeam = scopeRowsToTeam;

/* Team key used to match tasks <-> Category/Task Name rows. Falls back to the view team. */
function teamKeyOf(x) {
  return normTeam(String(x?.team || '').trim() || getWriteTeam() || '');
}
function teamMatch(a, b) {
  const ka = teamKeyOf(a), kb = teamKeyOf(b);
  return !ka || !kb || ka === kb;
}
window.teamKeyOf = teamKeyOf;
window.teamMatch = teamMatch;

/* ---------- Team list ---------- */
function computeKnownTeams() {
  const map = new Map();
  const add = t => { t = String(t || '').trim(); if (t && !map.has(normTeam(t))) map.set(normTeam(t), t); };
  (window.__seenTeams || []).forEach(add);
  (window.teamsTableRows || []).forEach(r => add(r.code));
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}
window.computeKnownTeams = computeKnownTeams;

/* Called from fetchAllDataFromSheet right after the rows are mapped (still UNSCOPED).
   1) remembers which teams exist, 2) cuts every array down to the active team. */
function applyTeamScopeToState() {
  const seen = new Set();
  (users || []).forEach(u => { if (u.role !== 'Admin') seen.add(String(u.team || '').trim()); });
  [capacityData, dailyTasks, projectsList, timeoffOtList].forEach(list => (list || []).forEach(r => seen.add(String(r.team || '').trim())));
  window.__seenTeams = [...seen].filter(Boolean);

  const v = getViewTeam();
  if (v !== TEAM_ALL) {
    users = (users || []).filter(u => normTeam(u.team) === normTeam(v));
    capacityData = scopeRowsToTeam(capacityData);
    dailyTasks = scopeRowsToTeam(dailyTasks);
    timeoffOtList = scopeRowsToTeam(timeoffOtList);
    projectsList = scopeRowsToTeam(projectsList);
  }
  renderTeamSwitcher();
}
window.applyTeamScopeToState = applyTeamScopeToState;

/* ---------- Sidebar team switcher ---------- */
function renderTeamSwitcher() {
  const label = document.getElementById('teamStaticLabel');
  const adminBox = document.getElementById('teamAdminControls');
  const sel = document.getElementById('teamSwitcher');
  const hint = document.getElementById('teamHint');
  const greet = document.getElementById('teamGreeting');
  if (!label || !currentUser) return;
  const v = getViewTeam();
  if (isAdminSession()) {
    label.classList.add('hidden');
    adminBox.classList.remove('hidden');
    const teams = computeKnownTeams();
    if (v !== TEAM_ALL && !teams.some(t => normTeam(t) === normTeam(v))) teams.push(v);
    sel.innerHTML = teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    sel.value = v;
    hint.classList.add('hidden');
    if (greet) greet.textContent = v || '';
  } else {
    adminBox.classList.add('hidden');
    hint.classList.add('hidden');
    label.classList.remove('hidden');
    label.textContent = v || '—';
    if (greet) greet.textContent = v || '';
  }
}
window.renderTeamSwitcher = renderTeamSwitcher;

/* Admin picks another team (or All teams): reload + re-render everything for that scope. */
window.switchTeamView = async function (value) {
  if (!isAdminSession()) return;
  window.activeTeamView = value || TEAM_ALL;
  // Category / Member filters hold names that belong to the previous team.
  try { bomTopFilterState.Category.clear(); bomTopFilterState.Member.clear(); } catch (_) {}
  const ok = await fetchAllDataFromSheet({ background: false, forceRender: true });
  if (ok) { try { updateDashboardCharts(); } catch (_) {} }
  renderTeamSwitcher();
};

window.loadTeamsTable = async function () {
  try {
    const r = await supabaseClient.from('teams').select('*').order('code', { ascending: true });
    if (!r.error) window.teamsTableRows = r.data || [];
  } catch (_) { /* table is optional until the SQL migration is run */ }
};

/* ---------- Team management (lives on the Users page, Admin only) ---------- */
function renderTeamModalList() {
  const box = document.getElementById('teamModalList');
  if (!box) return;
  const teams = computeKnownTeams();
  box.innerHTML = teams.length
    ? teams.map(t => `<span class="inline-block px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold">${escapeHtml(t)}</span>`).join(' ')
    : '<span class="text-xs text-slate-400 italic">No team yet.</span>';
}
window.openTeamModal = function () {
  if (!isAdminSession()) { showAppNotification('Only Admin can manage teams.', 'Permission denied'); return; }
  const input = document.getElementById('teamNewCode');
  if (input) input.value = '';
  renderTeamModalList();
  document.getElementById('teamModal').classList.remove('opacity-0', 'pointer-events-none');
  document.body.classList.add('modal-active');
};
window.closeTeamModal = function () {
  document.getElementById('teamModal').classList.add('opacity-0', 'pointer-events-none');
  document.body.classList.remove('modal-active');
};
window.createTeam = async function (e) {
  e?.preventDefault?.();
  if (!isAdminSession()) return;
  const input = document.getElementById('teamNewCode');
  const code = String(input?.value || '').trim();
  if (!code) return;
  if (computeKnownTeams().some(t => normTeam(t) === normTeam(code))) {
    showAppNotification('This team already exists.', 'Validation');
    return;
  }
  try {
    const { error } = await supabaseClient.from('teams').insert({ code, name: code });
    if (error) throw error;
  } catch (err) {
    showAppNotification(`Unable to create the team. Make sure the SQL migration (public.teams) has been run. ${err.message || ''}`, 'Database Error');
    return;
  }
  input.value = '';
  await loadTeamsTable();
  renderTeamSwitcher();
  renderTeamModalList();
  showAppNotification(`Team "${code}" created. Use "Add User" to add its members, then import its Category / Task Name.`);
};

/* ---------- Login screen: team list for Viewer ---------- */
async function loadLoginTeams() {
  const sel = document.getElementById('loginTeam');
  if (!sel) return;
  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading teams...</option>';
  const client = initSupabaseClient();
  const showErr = msg => { const err = document.getElementById('loginError'); if (err) { err.textContent = msg; err.classList.toggle('hidden', !msg); } };
  if (!client) { sel.innerHTML = '<option value="">Unable to connect database</option>'; showErr(supabaseInitError?.message || 'Unable to initialize Supabase.'); return; }
  const teams = new Map(), failures = [];
  const add = (code, name) => { const c = String(code || name || '').trim(); const n = String(name || code || '').trim() || c; if (c && !teams.has(c.toLowerCase())) teams.set(c.toLowerCase(), { code: c, name: n }); };
  async function read(table, columns, consume) {
    try { const r = await client.from(table).select(columns); if (r.error) throw r.error; (r.data || []).forEach(consume); }
    catch (e) { console.error(`Unable to read public.${table}:`, e); failures.push(`${table}: ${e?.message || 'query failed'}`); }
  }
  await read('teams', 'code,name,status', r => { if (!r.status || String(r.status).trim().toLowerCase() === 'active') add(r.code, r.name); });
  if (!teams.size) await read('users', 'team,status', r => { if (!r.status || String(r.status).trim().toLowerCase() === 'active') add(r.team, r.team); });
  const list = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) {
    sel.innerHTML = '<option value="">-- Select team --</option>' + list.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`).join('');
    sel.disabled = false; showErr('');
  } else {
    sel.innerHTML = '<option value="">Unable to load teams</option>';
    showErr(failures.length ? `Unable to load teams. ${failures.join(' | ')}` : 'No active team was found in Supabase.');
  }
}
window.loadLoginTeams = loadLoginTeams;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLoginTeams, { once: true });
else loadLoginTeams();

/* ---------- Users modal ---------- */
function syncUserTeamState() {
  const role = document.getElementById('userRole')?.value;
  const sel = document.getElementById('userTeam');
  if (!sel) return;
  sel.disabled = role === 'Admin';
  if (role === 'Admin') sel.value = '';
}
window.prepareUserTeamField = function (team) {
  const sel = document.getElementById('userTeam');
  if (!sel) return;
  const teams = computeKnownTeams();
  const wanted = String(team || '').trim() || getWriteTeam() || '';
  if (wanted && !teams.some(t => normTeam(t) === normTeam(wanted))) teams.push(wanted);
  sel.innerHTML = '<option value="">-- Select team --</option>' +
    teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  sel.value = teams.find(t => normTeam(t) === normTeam(wanted)) || '';
  syncUserTeamState();
};
document.getElementById('userRole')?.addEventListener('change', syncUserTeamState);

const _openAddUserModal = openAddUserModal;
openAddUserModal = function () {
  _openAddUserModal.apply(this, arguments);
  if (currentUser?.role === 'Admin') prepareUserTeamField('');
};
const _openEditUserModal = openEditUserModal;
openEditUserModal = function (idx) {
  _openEditUserModal.apply(this, arguments);
  const u = users[idx];
  if (u && currentUser?.role === 'Admin') prepareUserTeamField(u.team || '');
};

/* ---------- Session hooks ---------- */
const _initUserSession = initUserSession;
initUserSession = function () {
  _initUserSession.apply(this, arguments);
  renderTeamSwitcher();
  loadTeamsTable().then(renderTeamSwitcher);
};
const _logout = logout;
logout = function () {
  window.activeTeamView = TEAM_ALL;
  _logout.apply(this, arguments);
  loadLoginTeams();
};

/* ---------- Writes: always stamp the right team ---------- */
const _dbPayloadForSheet = dbPayloadForSheet;
dbPayloadForSheet = function (sheetName, row) {
  const p = _dbPayloadForSheet.call(this, sheetName, row);
  if (!p) return p;
  if (sheetName === 'Users') {
    p.team = ((isAdminSession() ? String(row?.team || '').trim() || getWriteTeam() : String(currentUser?.team || '').trim()) || null);
  } else {
    p.team = resolveTeamOrThrow(row);
  }
  return p;
};

const _taskDbPayload = taskDbPayload;
taskDbPayload = function (row) {
  const p = _taskDbPayload.call(this, row);
  p.team = resolveTeamOrThrow(row);
  return p;
};

/* New rows get the current team. In "All teams" view a NEW row has no team -> refuse the save. */
const _saveSheetData = saveSheetData;
saveSheetData = function (sheetName, rowsData) {
  if (Array.isArray(rowsData) && sheetName !== 'Users') {
    const wt = isAdminSession() ? getWriteTeam() : String(currentUser?.team || '').trim();
    rowsData.forEach(r => { if (r && typeof r === 'object' && !String(r.team || '').trim() && wt) r.team = wt; });
    if (rowsData.some(r => r && typeof r === 'object' && !String(r.team || '').trim())) {
      const msg = 'You are viewing All teams. Select a specific Team in the sidebar before adding new data.';
      if (typeof showAppNotification === 'function') showAppNotification(msg, 'Select a team');
      return Promise.reject(new Error(msg));
    }
  }
  return _saveSheetData.apply(this, arguments);
};

/* ---------- Category / Task Name import: replaces ONE team only ---------- */
window.importCapacityForTeam = async function (team, rows) {
  const t = String(team || '').trim();
  if (!t) throw new Error('Team is required for an import.');
  if (!isAdminSession() && normTeam(currentUser?.team) !== normTeam(t)) {
    throw new Error('You can only import Category / Task Name for your own team.');
  }
  // Deduplicate inside the file (team + category + task)
  const map = new Map();
  rows.forEach(r => {
    const k = `${String(r.category).trim().toLowerCase()}|||${String(r.task).trim().toLowerCase()}`;
    map.set(k, { team: t, category: String(r.category).trim(), task: String(r.task).trim(), scope: r.scope, workload: Math.max(0, Number(r.workload) || 0) });
  });
  const payload = [...map.values()];
  const cur = await supabaseClient.from(SUPABASE_TABLES.Capacity).select('*').eq('team', t);
  if (cur.error) throw cur.error;
  const backup = cur.data || [];
  const ok = await showAppConfirm(
    `FULL REPLACE for team "${t}": all ${backup.length} current Category / Task Name row(s) of this team will be DELETED and replaced by the ${payload.length} row(s) in the file. Other teams are NOT touched.`,
    `Replace categories of ${t}`);
  if (!ok) return null;

  // 1) delete everything of this team
  const del = await supabaseClient.from(SUPABASE_TABLES.Capacity).delete().eq('team', t);
  if (del.error) throw del.error;
  // 2) insert the new list (chunks), roll back on error
  try {
    for (let i = 0; i < payload.length; i += 500) {
      const ins = await supabaseClient.from(SUPABASE_TABLES.Capacity).insert(payload.slice(i, i + 500));
      if (ins.error) throw ins.error;
    }
  } catch (err) {
    await supabaseClient.from(SUPABASE_TABLES.Capacity).delete().eq('team', t);
    if (backup.length) {
      const restore = backup.map(({ id, created_at, updated_at, ...rest }) => rest);
      await supabaseClient.from(SUPABASE_TABLES.Capacity).insert(restore);
    }
    const hint = /capacity_unique_task|duplicate key/i.test(err?.message || '') ? '\nRun the SQL that changes the unique key to (team, category, task).' : '';
    throw new Error(`Import failed, old data of team "${t}" was restored. ${err?.message || err}${hint}`);
  }
  await fetchAllDataFromSheet({ background: false });
  return payload.length;
};


/* =====================================================================
   SCOPE DATA FROM THE DATABASE  (nothing is hardcoded any more)
   - scope_options     : values of the "Scope" dropdown (Category Setup / Task), per team
   - scope_items       : rows of the "BOM C&S Scope" matrix (groups 1,2.. and sub-items 1.1..)
   - scope_members     : matrix columns (member, order, avatar colour), per team
   - scope_assignments : which member owns which item (the ticks)
   The hardcoded array in CAPACITY_SCOPES is only a bootstrap fallback used when
   the tables are missing / empty for the active team.
   ===================================================================== */
const DEFAULT_SCOPES = [...CAPACITY_SCOPES];

function syncScopeSelects() {
  const sel = document.getElementById('capacityScope');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = CAPACITY_SCOPES.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if (keep && CAPACITY_SCOPES.includes(keep)) sel.value = keep;
}
syncScopeSelects();

window.loadScopeOptions = async function (force) {
  const v = getViewTeam();
  if (!force && window.__scopeOptKey === v) return;
  try {
    let q = supabaseClient.from('scope_options').select('team,name,sort_order').order('sort_order', { ascending: true });
    if (v !== TEAM_ALL) q = q.eq('team', v);
    const r = await q;
    if (r.error) throw r.error;
    const names = [];
    (r.data || []).forEach(x => { const n = String(x.name || '').trim(); if (n && !names.includes(n)) names.push(n); });
    CAPACITY_SCOPES.splice(0, CAPACITY_SCOPES.length, ...(names.length ? names : DEFAULT_SCOPES));
    window.__scopeOptKey = v;
  } catch (e) {
    console.warn('scope_options not available, using built-in defaults:', e?.message || e);
    CAPACITY_SCOPES.splice(0, CAPACITY_SCOPES.length, ...DEFAULT_SCOPES);
  }
  syncScopeSelects();
};

const SCOPE_AVATAR_PALETTE = ['#e5a42a', '#e44b87', '#7b62d9', '#2da981', '#2388c9', '#2c9ed4', '#e58a35', '#6177cf', '#35a68e', '#55aee5'];
const scopeEsc = s => escapeHtml(String(s ?? ''));

function scopeMessageHtml(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;height:100vh;display:grid;place-items:center;background:#edf4fa;color:#5f7690;font-family:Inter,Segoe UI,Arial,sans-serif;text-align:center;padding:24px"><p style="max-width:520px;line-height:1.5;font-size:15px">${scopeEsc(msg)}</p></body></html>`;
}

function buildScopeFrameHtml(data) {
  const items = [...(data.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const members = [...(data.members || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const assigned = new Set((data.assignments || []).map(a => `${a.item_code}\u0000${a.member_name}`));
  const colorOf = new Map();
  let top = 0;
  items.forEach(it => { if (!it.parent_code) { top++; colorOf.set(it.code, Number(it.color_index) || top); } });
  const rowClass = it => {
    const idx = colorOf.get(it.parent_code || it.code) || 1;
    return ((idx - 1) % 10) + 1;
  };
  const avatar = (m, i) => /^#[0-9a-f]{3,8}$/i.test(String(m.avatar_color || '')) ? m.avatar_color : SCOPE_AVATAR_PALETTE[i % SCOPE_AVATAR_PALETTE.length];

  const head = '<div class="head">SCOPE</div>' + members.map((m, i) =>
    `<div class="head member"><span class="avatar" style="background:${avatar(m, i)}">${scopeEsc(String(m.member_name || '?').trim().charAt(0).toUpperCase())}</span><span class="member-name">${scopeEsc(m.member_name)}</span></div>`).join('');

  const rows = items.map(it => {
    const r = rowClass(it);
    const isSub = !!it.parent_code;
    const label = isSub
      ? `<div class="cell group r${r} scope-subitem"><span class="scope-subnumber">${scopeEsc(it.code)}</span><span>${scopeEsc(it.title)}</span></div>`
      : `<div class="cell group r${r}"><span class="group-badge b${r}">${scopeEsc(it.code)}</span><span>${scopeEsc(it.title)}</span></div>`;
    const cells = members.map(m =>
      `<div class="cell member-cell r${r}">${assigned.has(`${it.code}\u0000${m.member_name}`) ? '<span class="check x1">✓</span>' : ''}</div>`).join('');
    return label + cells;
  }).join('\n');

  const css = document.getElementById('scopeFrameCss')?.textContent || '';
  const override = `.matrix{grid-template-columns:380px repeat(${Math.max(1, members.length)},minmax(70px,1fr)) !important;min-width:${380 + Math.max(1, members.length) * 122}px !important}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${css}\n${override}</style></head><body><div class="page"><main class="wrap"><div class="scroll"><section class="matrix">${head}\n${rows}</section></div></main></div></body></html>`;
}

window.renderScopeFromDb = async function () {
  const frame = document.getElementById('bomCsScopeFrame');
  if (!frame || !currentUser) return;
  const team = getViewTeam();
  if (team === TEAM_ALL) {
    frame.srcdoc = scopeMessageHtml('Select a team in the sidebar to view its scope.');
    return;
  }
  try {
    const [it, me, as] = await Promise.all([
      supabaseClient.from('scope_items').select('*').eq('team', team).order('sort_order', { ascending: true }),
      supabaseClient.from('scope_members').select('*').eq('team', team).order('sort_order', { ascending: true }),
      supabaseClient.from('scope_assignments').select('*').eq('team', team)
    ]);
    for (const r of [it, me, as]) if (r.error) throw r.error;
    if (!(it.data || []).length) {
      frame.srcdoc = scopeMessageHtml(`No scope has been defined for team "${team}" yet. Add rows to the scope_items / scope_members / scope_assignments tables.`);
      return;
    }
    frame.srcdoc = buildScopeFrameHtml({ items: it.data, members: me.data, assignments: as.data });
  } catch (e) {
    console.error('Scope load error:', e);
    frame.srcdoc = scopeMessageHtml('Unable to load scope data. Run the SQL file "supabase_02_bom_cs_data_and_scope.sql" to create the scope tables. ' + (e.message || ''));
  }
};

const scopeTabVisible = () => !document.getElementById('tab-bom-cs-scope')?.classList.contains('hidden');

const _fetchAllDataFromSheet = fetchAllDataFromSheet;
fetchAllDataFromSheet = async function (opts) {
  // Scope list must be ready BEFORE the tables are rendered.
  if (currentUser) await loadScopeOptions(!(opts && opts.background));
  const result = await _fetchAllDataFromSheet.apply(this, arguments);
  if (currentUser && scopeTabVisible()) renderScopeFromDb();
  return result;
};

const _switchTab = switchTab;
switchTab = function (tabId) {
  const r = _switchTab.apply(this, arguments);
  if (tabId === 'bom-cs-scope') renderScopeFromDb();
  return r;
};
