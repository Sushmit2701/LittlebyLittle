// Keeps the app working offline. Bump VERSION when files change so phones pick up the update.
const VERSION = 'chunker-v3';
const FILES = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/app.js', './js/dates.js', './js/store.js', './js/scheduler.js', './js/parser.js', './js/ics.js', './js/ai.js', './js/cloud.js', './js/cloud-config.js', './js/sync-merge.js',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first for our own files (so updates arrive), cache as the offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
