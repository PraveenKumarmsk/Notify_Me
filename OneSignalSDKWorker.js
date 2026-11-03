importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

/* =====================================================
   Offline cache — OneSignal ke SAATH ek hi service worker file me
   Strategy: cache-first, aur background me network se update (taaki purana
   index.html hamesha ke liye atak na jaye). Network fail ho to offline.html.
   ===================================================== */

const CACHE_NAME = 'notify-app-v1';   // naya version chahiye to v2 kar dena
const ASSETS = ['/', '/index.html', '/offline.html', '/manifest.json'];

// INSTALL: zaruri files cache me daalo
self.addEventListener('install', (event) => {
  self.skipWaiting();   // naya worker turant active ho
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Har file alag add ki hai taaki ek fail ho to baaki na rukein
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)))
    )
  );
});

// ACTIVATE: purane cache versions delete karo aur control le lo
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('notify-app-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// FETCH: cache pehle, phir network
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sirf GET aur apni hi site ki files handle karenge
  // (OneSignal / Apps Script ke calls ko haath nahi lagate)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      // Network se fetch karke cache update karna (background refresh)
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      // Cache me mila to turant do; network update peeche chalta rahega
      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      // Cache me nahi mila → network try karo, fail ho to offline.html
      return network.then((res) =>
        res || caches.match('/offline.html').then((off) =>
          off || new Response('Offline', { status: 503, statusText: 'Offline' })
        )
      );
    })
  );
});
