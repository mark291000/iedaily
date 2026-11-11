/* =====================================================================
   VERSION CHECK
   1) Every updated file registers itself in window.__appFiles. If one is
      missing or old (file not uploaded / browser cache), a red banner lists it.
   2) version.json is read without cache; if GitHub already has a newer
      version than the one running, the page reloads once automatically.
   ===================================================================== */
(function(){
'use strict';
const V=(window.APP_CONFIG&&window.APP_CONFIG.APP_VERSION)||'?';
const EXPECTED={
  'config':'js/config.js','users':'js/data/users.js','02-app-core':'js/core/02-app-core.js',
  '02b-state-bridge':'js/core/02b-state-bridge.js','02c-perf-index':'js/core/02c-perf-index.js','02d-data-window':'js/core/02d-data-window.js',
  '45-hardcodedUsersV1':'js/modules/45-hardcodedUsersV1.js','46-projectExportV2':'js/modules/46-projectExportV2.js',
  '47-taskExportV2':'js/modules/47-taskExportV2.js','48-renderSkip':'js/modules/48-renderSkip.js'
};
function banner(html,color){
  let b=document.getElementById('appVersionBanner');
  if(!b){b=document.createElement('div');b.id='appVersionBanner';b.setAttribute('role','alert');
    b.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 16px;font:600 13px/1.45 Inter,Segoe UI,Arial,sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    document.body.appendChild(b);}
  b.style.background=color||'#b91c1c';b.innerHTML=html+' <button type="button" style="margin-left:12px;background:#fff;color:#111;border-radius:6px;padding:2px 10px;font-weight:700" onclick="this.parentNode.remove()">Close</button>';
}
function checkFiles(){
  const got=window.__appFiles||{};
  const bad=Object.entries(EXPECTED).filter(([k])=>got[k]!==V).map(([k,f])=>`${f} (${got[k]?'v'+got[k]:'missing'})`);
  const label=document.getElementById('appVersionLabel');
  if(label)label.textContent=`IE Team app v${V}`+(bad.length?' · files outdated':'');
  if(bad.length){
    console.error('[version-check] outdated/missing files:',bad);
    banner(`⚠ App v${V}: ${bad.length} file chưa được cập nhật trên server: <span style="font-weight:400">${bad.join(', ')}</span>. Hãy upload lại các file này lên GitHub, đợi 1–2 phút rồi nhấn Ctrl+F5.`);
  }
}
async function checkServer(){
  if(location.protocol==='file:')return;
  try{
    const r=await fetch('version.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)return;
    const j=await r.json();const server=String(j.version||'');
    if(!server||server===V){sessionStorage.removeItem('ieAppReloadedFor');return;}
    if(sessionStorage.getItem('ieAppReloadedFor')!==server){sessionStorage.setItem('ieAppReloadedFor',server);location.reload();return;}
    banner(`Có phiên bản mới v${server} nhưng trình duyệt vẫn đang chạy v${V}. Nhấn Ctrl+F5 để tải lại.`,'#b45309');
  }catch(_){}
}
function run(){checkFiles();checkServer();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();
