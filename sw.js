// SpeakUp service worker: network-first for the app shell (so updates arrive
// as soon as you're online), cached copy when offline. API calls are never cached.
const CACHE = 'speakup-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.css',
  './app.js',
  './ui.js',
  './icons.js',
  './store.js',
  './claude.js',
  './speech.js',
  './prompts.js',
  './diff.js',
  './chat.js',
  './talk.js',
  './roleplay.js',
  './review.js',
  './progress.js',
  './settings.js',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
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
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch api.anthropic.com etc.

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const fresh = await fetch(req, { signal: ctrl.signal, cache: 'no-cache' });
      clearTimeout(timer);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
