/* App configuration. The publishable key is safe for the browser; protect data with Supabase RLS. */
window.APP_CONFIG = {
  SUPABASE_URL: "https://mctutyvzloefyhpgokbe.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xqm86DxfEkJaXB8WUurYnA_kAT37Z1_",
  REALTIME_DEBOUNCE_MS: 1200,
  /* Counted in Overall headcount, but hidden from reports / workload and not counted in workload */
  HIDDEN_FROM_REPORTS: ['Anny'],
  APP_VERSION: '1.4.1'
};
(window.__appFiles=window.__appFiles||{})['config']='1.4.1';
