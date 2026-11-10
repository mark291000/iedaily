(function(){
  'use strict';
  function isAppAdmin(){ try { return typeof window.isAdminSession === 'function' ? !!window.isAdminSession() : currentUser?.role === 'Admin'; } catch(_) { return false; } }
  function isTeamAdmin(){ return !!currentUser && !currentUser.isReadOnly && currentUser.role === 'Team Admin'; }
  function canImport(){ return !!currentUser && !currentUser.isReadOnly && (isAppAdmin() || isTeamAdmin()); }
  window.canImportData = canImport;
  const DENY_MSG = 'Only App Admin and Team Admin can import data.';
  const deny = () => { try { showAppNotification(DENY_MSG, 'Permission denied'); } catch(_) { alert(DENY_MSG); } };
  const IMPORT_INPUTS = { dailyTaskImportInput:canImport, myTaskImportInput:canImport, projectImportInput:canImport, capacityImportInput:canImport, ts2File:canImport, pv4TimeoffFile:canImport, mtrImportInput:isAppAdmin };
  const allowedFor = id => (IMPORT_INPUTS[id] || canImport)();
  document.addEventListener('click', e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !(el.id in IMPORT_INPUTS) || allowedFor(el.id)) return;
    e.preventDefault(); e.stopImmediatePropagation(); deny();
  }, true);
  document.addEventListener('change', e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !(el.id in IMPORT_INPUTS) || allowedFor(el.id)) return;
    e.preventDefault(); e.stopImmediatePropagation(); el.value = ''; deny();
  }, true);
  function guard(name, check){
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__importGuard) return;
    const w = function(e){ if (!check()) { try { if (e?.target) e.target.value = ''; } catch(_){} deny(); return; } return fn.apply(this, arguments); };
    w.__importGuard = true; window[name] = w;
    try { (0, eval)(`${name} = window.${name};`); } catch(_){}
  }
  function guardAll(){ guard('handleTaskImport', canImport); guard('handleProjectImport', canImport); guard('handleCapacityImport', canImport); guard('handleUserImport', isAppAdmin); }
  const BUTTON_SELECTORS = ['[onclick*="dailyTaskImportInput"]','[onclick*="myTaskImportInput"]','[onclick*="projectImportInput"]','[onclick*="capacityImportInput"]','#pv4TimeoffImport','#ts2Root [data-act="import"]','#ts2Root [data-act="template"]'].join(',');
  function syncButtons(){
    const ok = canImport();
    document.querySelectorAll(BUTTON_SELECTORS).forEach(b => { b.classList.toggle('hidden', !ok); b.setAttribute('aria-hidden', ok ? 'false' : 'true'); });
    const ub = document.getElementById('mtrImportBtn'); if (ub && !isAppAdmin()) ub.classList.add('hidden');
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; syncButtons(); }); };
  function hook(name){
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__importBtnHook) return;
    const w = function(){ const r = fn.apply(this, arguments); if (r && typeof r.then === 'function') return r.then(v => { guardAll(); schedule(); return v; }); guardAll(); schedule(); return r; };
    w.__importBtnHook = true; window[name] = w;
    try { (0, eval)(`${name} = window.${name};`); } catch(_){}
  }
  function init(){
    guardAll();
    ['initUserSession','switchTab','switchTeamView','fetchAllDataFromSheet','logout'].forEach(hook);
    syncButtons();
    new MutationObserver(schedule).observe(document.getElementById('contentArea') || document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
