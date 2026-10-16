// Service worker: app shell cache-first (opens offline), brief data network-first so the same URL shows the newest brief.
const C = 'brief-shell-v5', SHELL = ['./', 'index.html', 'app.css', 'app.js', 'vendor/supabase-2.118.0.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(SHELL))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;                       // writes always go to the network
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;                     // Supabase (auth, data, realtime) is never cached: private, always live
  if (u.pathname.includes('/data/')) {                           // demo data only
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
  } else e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
