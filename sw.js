/* Offline shell.
   Bump CACHE on every release. Build 2 also switched from cache-first to network-first:
   the app is only ~50KB, and cache-first meant a broken build stayed broken on the phone
   even after the fix was published. Offline still works - it just falls back to the cache. */
const CACHE = 'hours-v2';

const SHELL = [
  '.',
  'index.html',
  'app.css?v=2',   // keep these query strings in step with index.html - the old cache-first
  'app.js?v=2',    // worker only fetches a fresh copy if the URL itself changed

  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) =>
          hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined)
        )
      )
  );
});
