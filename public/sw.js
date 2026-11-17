// reachloop service worker: offline app shell + receiving photos shared from the gallery.
// Bump VERSION whenever the shell files change so phones pick up the new cache.
const VERSION = 'reachloop-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg'
];
const RUNTIME_HOSTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('reachloop-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Photos or videos shared into reachloop from another app (Android share sheet)
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/share-target') {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const files = form.getAll('media').filter((f) => f && typeof f !== 'string');
        const cache = await caches.open('reachloop-share');
        for (const old of await cache.keys()) await cache.delete(old);
        let i = 0;
        for (const f of files) {
          const name = encodeURIComponent(f.name || `shared-${i}`);
          await cache.put(`/shared/${Date.now()}-${i++}/${name}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
        }
      } catch (_) { /* fall through to the app */ }
      return Response.redirect('/?shared=1#create', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Pages: network first so updates arrive, cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Own files, fonts and the MP4 library: cache first, refresh in the background
  if (url.origin === location.origin || RUNTIME_HOSTS.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
});
