// Service worker: guarda la app para que abra sin señal.
// Páginas: red primero (para tomar versiones nuevas), caché si no hay señal.
// Archivos estáticos (_next/static) son inmutables: caché primero.
const VERSION = 'qsecha-v2';
const PRECACHE = ['/', '/campo/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Supabase y otros: directo a la red

  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(req).then((res) => {
      const copia = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copia));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('/campo/')))
  );
});
