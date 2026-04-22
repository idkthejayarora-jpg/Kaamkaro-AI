// Kaamkaro AI Service Worker
// Cache version — bump this string on each major release to bust stale caches.
const CACHE_VERSION = '2026-04-22-v2';
const CACHE_NAME = `kaamkaro-${CACHE_VERSION}`;

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  // skipWaiting forces this SW to activate immediately (replaces old SW).
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  // Delete ALL old caches (any name that isn't this exact version).
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests entirely.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — always network, never cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) {
    event.respondWith(fetch(request));
    return;
  }

  // Hashed static assets (/assets/xxx-HASH.js|css) — cache-first (safe, hash changes with content).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Everything else (HTML navigation, manifest, sw.js, icons) — network-first.
  // Fall back to cached index.html ONLY if genuinely offline.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match('/index.html'))
  );
});
