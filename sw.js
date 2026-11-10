/* Minimal service worker: enables "Install app". No caching, so every deploy is picked up immediately. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
