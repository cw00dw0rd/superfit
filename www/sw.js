// Offline support: app shell cache-first, schedule data network-first.
const CACHE = 'sfp-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'js/sync.js', 'js/store.js', 'js/pdfparse.js', 'data/classinfo.json', 'data/glyphs.json', 'data/schedule.json', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const networkFirst = url.pathname.endsWith('/data/schedule.json');
  e.respondWith(networkFirst
    ? fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request))
    : caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      })));
});
