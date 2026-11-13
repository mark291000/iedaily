/* App configuration. The publishable key is safe for the browser; protect data with Supabase RLS. */
(function () {
  /* Điền URL Cloudflare Worker vào đây (ví dụ "https://ie-supabase-proxy.ten-ban.workers.dev").
     Để trống "" = kết nối thẳng tới Supabase như cũ. */
  var SUPABASE_PROXY_URL = "https://iedaily.danghuuhoang29.workers.dev";

  var SUPABASE_DIRECT_URL = "https://mctutyvzloefyhpgokbe.supabase.co";

  window.APP_CONFIG = {
    SUPABASE_URL: (SUPABASE_PROXY_URL || SUPABASE_DIRECT_URL).replace(/\/+$/, ""),
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xqm86DxfEkJaXB8WUurYnA_kAT37Z1_",
    REALTIME_DEBOUNCE_MS: 1200,
    /* Counted in Overall headcount, but hidden from reports / workload and not counted in workload */
    HIDDEN_FROM_REPORTS: ['Anny'],
    APP_VERSION: '1.4.4'
  };
  (window.__appFiles = window.__appFiles || {})['config'] = '1.4.4';
})();
