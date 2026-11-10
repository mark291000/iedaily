(function(){
  'use strict';
  const PAGE_LIMIT = 300;
  const STATUS_VALUES = ['Not Started','Working','Overdue','Completed'];
  const $ = id => document.getElementById(id);
  const notify = (m, t) => { try { showAppNotification(m, t); } catch(_) { alert(m); } };

  /* 1) STATUS FILTER: task pages use their own key "TaskStatus"
     (the "Status" key belongs to the Project/Gantt filter). */
  try { if (!(bomTopFilterState.TaskStatus instanceof Set)) bomTopFilterState.TaskStatus = new Set(); }
  catch (e) { console.error('patchV4: bomTopFilterState not found', e); }
  function renameTaskStatusBars(){
    document.querySelectorAll('.bom-multi[data-filter-key="Status"]').forEach(bar => {
      if (bar.closest('#tab-projects')) return;
      bar.dataset.filterKey = 'TaskStatus';
    });
  }
  const _bomTaskValues = bomTaskValues;
  bomTaskValues = function(key, task){
    if (key === 'TaskStatus') { try { calculateTaskMetadata(task); } catch(_){} return task && task.status ? [String(task.status)] : []; }
    return _bomTaskValues.apply(this, arguments);
  };
  window.bomTaskValues = bomTaskValues;
  const _getBomFilterUniverse = getBomFilterUniverse;
  getBomFilterUniverse = function(key){
    if (key === 'TaskStatus') return STATUS_VALUES.slice();
    return _getBomFilterUniverse.apply(this, arguments);
  };
  window.getBomFilterUniverse = getBomFilterUniverse;
  const _updateBomFilterButtons = updateBomFilterButtons;
  updateBomFilterButtons = function(){
    const r = _updateBomFilterButtons.apply(this, arguments);
    document.querySelectorAll('.bom-multi[data-filter-key="TaskStatus"] .bom-multi-btn span').forEach(s => {
      s.textContent = s.textContent.replace(/^TaskStatus/, 'Status');
      if (s.title) s.title = s.title.replace(/^TaskStatus/, 'Status');
    });
    return r;
  };
  window.updateBomFilterButtons = updateBomFilterButtons;
  const _bomFilterBarOptions = bomFilterBarOptions;
  bomFilterBarOptions = function(bar, key){
    const r = _bomFilterBarOptions.apply(this, arguments);
    if (key === 'TaskStatus') { const i = bar.querySelector('.bom-multi-menu input[type="search"]'); if (i) i.placeholder = 'Search Status...'; }
    return r;
  };
  window.bomFilterBarOptions = bomFilterBarOptions;

  /* 2) PERFORMANCE */
  if (typeof applyBomUnifiedFilters === 'function') {
    const _apply = applyBomUnifiedFilters; let timer = 0;
    applyBomUnifiedFilters = function(){
      const args = arguments, self = this; clearTimeout(timer);
      timer = setTimeout(() => { try { _apply.apply(self, args); } catch(e){ console.error(e); } }, 120);
    };
    window.applyBomUnifiedFilters = applyBomUnifiedFilters;
  }
  const LAZY = {
    renderDailyTrackingTable: 'tab-daily-tracking',
    renderMyTasksTable:       'tab-my-tasks',
    renderWeeklyCalendar:     ['tab-weekly-calendar','tab-dashboard'],
    renderTimeoffOtTable:     'tab-timeoff-ot',
    renderSaturdayMatrixTable:'tab-timeoff-ot',
    renderUserManagementTable:'tab-users',
    renderCapacityTable:      'tab-workload',
    renderProjectsTable:      'tab-projects',
    renderGanttChart:         'tab-projects',
    initDashboardCharts:      'tab-dashboard'
  };
  const pending = new Map(), originals = {};
  const isHidden = tabId => [].concat(tabId).every(id => { const el = $(id); return !el || el.classList.contains('hidden'); });
  function wrapLazy(name){
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__pv4) return;
    originals[name] = fn;
    const tabId = LAZY[name];
    const w = function(){
      if (isHidden(tabId)) { [].concat(tabId).forEach(t => { if (!pending.has(t)) pending.set(t, new Set()); pending.get(t).add(name); }); return; }
      return fn.apply(this, arguments);
    };
    w.__pv4 = true; window[name] = w;
    try { (0, eval)(`${name} = window.${name};`); } catch(_){}
  }
  function flush(tabId){
    const set = pending.get(tabId); if (!set) return;
    pending.delete(tabId);
    set.forEach(name => { try { originals[name](); } catch(e){ console.error('patchV4 render', name, e); } });
    try { restoreAdvancedTableFilters(); } catch(_){}
  }
  const showAll = { daily:false, my:false };
  function hasColumnFilter(tableId){ try { const f = advancedTableFilters[tableId]; return !!f && Object.keys(f).length > 0; } catch(_) { return false; } }
  function limitRows(tbodyId, flag, tableId){
    const tb = $(tbodyId); if (!tb) return;
    tb.querySelector('.pv4-more')?.remove();
    if (showAll[flag] || hasColumnFilter(tableId)) return;
    const rows = tb.querySelectorAll(':scope > tr');
    if (rows.length <= PAGE_LIMIT) return;
    for (let i = PAGE_LIMIT; i < rows.length; i++) rows[i].remove();
    const tr = document.createElement('tr'); tr.className = 'pv4-more';
    tr.innerHTML = `<td colspan="20">Showing ${PAGE_LIMIT} of ${rows.length.toLocaleString('en-US')} rows · <button type="button">Show all ${rows.length.toLocaleString('en-US')} rows</button></td>`;
    tr.querySelector('button').addEventListener('click', e => {
      e.stopPropagation(); showAll[flag] = true;
      const fn = flag === 'daily' ? 'renderDailyTrackingTable' : 'renderMyTasksTable';
      (originals[fn] || window[fn])();
    });
    tb.appendChild(tr);
  }
  function wrapLimit(name, tbodyId, flag, tableId){
    const fn = window[name]; if (typeof fn !== 'function') return;
    window[name] = function(){ const r = fn.apply(this, arguments); limitRows(tbodyId, flag, tableId); return r; };
    try { (0, eval)(`${name} = window.${name};`); } catch(_){}
  }
  ['changeBomTopFilter','selectAllBomFilter','resetBomTopFilters'].forEach(n => {
    const f = window[n]; if (typeof f !== 'function') return;
    window[n] = function(){ showAll.daily = showAll.my = false; return f.apply(this, arguments); };
    try { (0, eval)(`${n} = window.${n};`); } catch(_){}
  });

  /* 3) TIME OFF & OVERTIME - Requests List IMPORT / EXPORT */
  const TYPES = ['Day Off','Saturday Off','Over Time','Time Off'];
  const HEAD = ['Type','PIC','Start Date','End Date','Hours / Days','Reason','Team'];
  function exportRequests(){
    if (!window.XLSX) return notify('Excel library is not loaded.', 'Export Error');
    const list = (typeof timeoffOtList !== 'undefined' && Array.isArray(timeoffOtList)) ? timeoffOtList : [];
    const rows = list.slice().sort((a,b) => String(b.startDate||'').localeCompare(String(a.startDate||'')))
      .map(r => [r.type||'', r.pic||'', cleanDateStr(r.startDate)||'', cleanDateStr(r.endDate||r.startDate)||'', Number(r.hours)||0, r.reason||'', r.team||'']);
    const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows]);
    ws['!cols'] = [{wch:14},{wch:22},{wch:12},{wch:12},{wch:12},{wch:40},{wch:14}];
    HEAD.forEach((_, i) => { const c = XLSX.utils.encode_cell({r:0,c:i}); if (ws[c]) ws[c].s = {font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1E293B'}},alignment:{horizontal:'center'}}; });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Requests');
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `TimeOff_OT_Requests_${stamp}.xlsx`);
  }
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  function pick(row, keys){ for (const k of Object.keys(row)) if (keys.includes(norm(k))) return row[k]; return ''; }
  async function importRequests(file){
    if (!currentUser) return notify('Please sign in before importing.', 'Import Error');
    if (typeof window.canImportData === 'function' && !window.canImportData()) return notify('Only App Admin and Team Admin can import data.', 'Permission denied');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type:'array' });
    const sh = wb.Sheets[wb.SheetNames[0]];
    const raw = sh ? XLSX.utils.sheet_to_json(sh, { defval:'', raw:true }) : [];
    if (!raw.length) return notify('The selected file is empty.', 'Import Error');
    const activeNames = new Map((Array.isArray(users) ? users : []).filter(u => String(u.status||'').toLowerCase() === 'active' && !isHiddenMember(u.name||u.username||'')).map(u => [String(u.name||'').trim().toLowerCase(), String(u.name||'').trim()]));
    const errors = [], items = [];
    raw.forEach((r, i) => {
      const line = i + 2;
      const typeIn = String(pick(r, ['type','requesttype'])).trim();
      const type = TYPES.find(t => norm(t) === norm(typeIn));
      const picIn = String(pick(r, ['pic','member','name'])).trim();
      const pic = activeNames.get(picIn.toLowerCase());
      const start = cleanDateStr(pick(r, ['startdate','start','date','from']));
      let end = cleanDateStr(pick(r, ['enddate','end','to'])) || start;
      let hours = Number(String(pick(r, ['hoursdays','hours','days','amount'])).replace(',', '.'));
      const reason = String(pick(r, ['reason','note'])).trim();
      if (!type) errors.push(`Row ${line}: Type must be one of ${TYPES.join(', ')}.`);
      if (!pic) errors.push(`Row ${line}: PIC "${picIn}" is not an active user.`);
      if (!start) errors.push(`Row ${line}: Start Date is required.`);
      if (type === 'Over Time' || type === 'Saturday Off') end = start;
      if (start && end && end < start) errors.push(`Row ${line}: End Date is before Start Date.`);
      if (type === 'Saturday Off' && !(hours > 0)) hours = 6.5;
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) errors.push(`Row ${line}: Hours / Days must be > 0 and <= 24.`);
      if (type === 'Over Time' && !reason) errors.push(`Row ${line}: Reason is required for Over Time.`);
      if (type && pic && start) items.push({ type, pic, startDate:start, endDate:end, hours, reason: reason || (type === 'Saturday Off' ? 'Saturday Off Registration' : '') });
    });
    if (errors.length) return notify(errors.slice(0, 15).join('\n') + (errors.length > 15 ? `\n...and ${errors.length - 15} more error(s).` : ''), 'Import Error');
    const key = x => [x.type, String(x.pic).toLowerCase(), cleanDateStr(x.startDate), cleanDateStr(x.endDate || x.startDate)].join('|');
    const existing = new Set(timeoffOtList.map(key)); const fresh = [], seen = new Set();
    items.forEach(x => { const k = key(x); if (existing.has(k) || seen.has(k)) return; seen.add(k); fresh.push(x); });
    const skipped = items.length - fresh.length;
    if (!fresh.length) return notify(`Nothing to import. All ${items.length} row(s) already exist.`, 'Import');
    const ok = await showAppConfirm(`Import ${fresh.length} new request(s)?` + (skipped ? ` ${skipped} duplicate row(s) will be skipped.` : ''), 'Import Requests');
    if (!ok) return;
    const backup = timeoffOtList.slice();
    fresh.forEach(x => timeoffOtList.unshift({ id:`tmp_timeoff_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, ...x }));
    try {
      await saveSheetData('TimeOff_OT', timeoffOtList);
      await fetchAllDataFromSheet({ background:false });
      notify(`${fresh.length} request(s) imported.` + (skipped ? ` ${skipped} duplicate(s) skipped.` : ''));
    } catch (e) {
      timeoffOtList.splice(0, timeoffOtList.length, ...backup);
      console.error('Time Off import error:', e);
      notify(`Import failed. ${e?.message || e}`, 'Import Error');
    }
    try { renderTimeoffOtTable(); renderWeeklyCalendar(); renderSaturdayMatrixTable(); } catch(_){}
  }
  function addTimeoffButtons(){
    if ($('pv4TimeoffBar')) return;
    const tbody = $('timeoffOtTableBody'); if (!tbody) return;
    const card = tbody.closest('.lg\\:col-span-2') || tbody.closest('.bg-white');
    const title = card ? [...card.querySelectorAll('h3')].find(el => /requests\s*list/i.test(el.textContent)) : null;
    const bar = document.createElement('div'); bar.id = 'pv4TimeoffBar'; bar.className = 'pv4-bar';
    bar.innerHTML = `<button type="button" class="pv4-btn pv4-imp" id="pv4TimeoffImport"><i class="fa-solid fa-file-import"></i> Import</button>
      <button type="button" class="pv4-btn pv4-exp" id="pv4TimeoffExport"><i class="fa-solid fa-file-export"></i> Export</button>
      <input type="file" id="pv4TimeoffFile" accept=".xlsx,.xls,.csv" hidden>`;
    if (title) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap';
      row.className = title.className; title.className = 'text-base font-bold text-slate-800';
      title.parentNode.insertBefore(row, title); row.appendChild(title); row.appendChild(bar);
    } else { const host = $('timeoffRequestsScroll'); bar.style.margin = '0 0 8px 0'; host?.parentNode.insertBefore(bar, host); }
    $('pv4TimeoffExport').addEventListener('click', exportRequests);
    $('pv4TimeoffImport').addEventListener('click', () => $('pv4TimeoffFile').click());
    $('pv4TimeoffFile').addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      try { await importRequests(f); } catch (err) { notify(err?.message || 'Import failed.', 'Import Error'); }
      finally { e.target.value = ''; }
    });
  }
  function init(){
    renameTaskStatusBars();
    wrapLimit('renderDailyTrackingTable', 'dailyTrackingTableBody', 'daily', 'table-daily-tracking');
    wrapLimit('renderMyTasksTable', 'myTasksTableBody', 'my', 'table-my-tasks');
    Object.keys(LAZY).forEach(wrapLazy);
    const sw = window.switchTab;
    if (typeof sw === 'function' && !sw.__pv4) {
      const w = function(id){ if(id==='projects') pending.delete('tab-projects'); const r = sw.apply(this, arguments); flush('tab-' + id); if (id === 'timeoff-ot') addTimeoffButtons(); return r; };
      w.__pv4 = true; window.switchTab = w;
      try { (0, eval)('switchTab = window.switchTab;'); } catch(_){}
    }
    addTimeoffButtons();
    try { updateBomFilterButtons(); } catch(_){}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})();
