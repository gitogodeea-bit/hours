/* Offline shell.
   Bump CACHE on every release, and keep the ?v= query strings in step with index.html.
   Network-first since build 2: the app is tiny, and cache-first meant a broken build
   stayed broken on the phone even after the fix was published. Offline still works -
   it just falls back to whatever is in the cache. */
const CACHE = 'hours-v4';

const SHELL = [
  '.',
  'index.html',
  'app.css?v=4',
  'app.js?v=4',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

/* Each file is added on its own. addAll() is all-or-nothing, so a single asset that
   fails to fetch throws away the entire precache and leaves the app with nothing
   offline; this way we keep whatever we did manage to get. */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
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
