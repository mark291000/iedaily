        // PWA: register the service worker so the page can be installed as an app
        // when it is served over HTTPS (or localhost).
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').catch(err => {
                    console.warn('PWA service worker registration failed:', err);
                });
            });
        }
    
