/* =====================================================================
   PingMe — Service Worker
   1) Web Push: push aate hi backend se naya message le kar notification dikhata hai
      (browser band ho ya app background me ho, tab bhi — jahan OS/browser allow kare)
   2) Offline: app ka shell cache me rakhta hai
   ===================================================================== */

const CACHE = 'pingme-v4';                       // app update karne par v2, v3... kar dein
const SHELL = ['./', 'index.html', 'style.css', 'script.js', 'manifest.json',
               'icons/icon-192x192.png', 'icons/icon-512x512.png', 'icons/badge-96x96.png'];
const SCOPE = self.registration.scope;
const url = (p) => new URL(p, SCOPE).href;

/* ---------- Chhota IndexedDB key-value (page aur worker dono share karte hain) ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('pingme', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => resolve(undefined);
  });
}

/* ---------- Install / Activate ---------- */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((p) => cache.add(url(p)).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pingme-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- Offline cache ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;           // Apps Script / dusre sites ko haath nahi lagate

  // Page kholna: pehle network (taaki naya version mile), na ho to cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url('index.html'), copy));
        return res;
      }).catch(() => caches.match(url('index.html')).then((r) => r || caches.match(url('./'))))
    );
    return;
  }
  // Baaki files: cache pehle, saath me background me update
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

/* ---------- Push ---------- */
async function showMsg(n) {
  const title = (n.fromName || n.from || 'PingMe');
  await self.registration.showNotification(title, {
    body: n.message,
    icon: url('icons/icon-192x192.png'),
    badge: url('icons/badge-96x96.png'),            // status bar ka chhota icon (white + transparent hona zaroori)
    tag: n.id || undefined,
    timestamp: n.at ? Date.parse(n.at) : Date.now(),
    data: { id: n.id || '', from: n.from || '' }
  });
}

async function handlePush(event) {
  let shown = 0, fetched = false;

  // Agar kabhi payload ke saath push aaye to wahi dikha do
  if (event.data) {
    try { const d = event.data.json(); if (d && d.message) { await showMsg(d); shown++; } } catch (e) {}
  }

  // Normal raasta: server se is device ke naye messages le aao
  if (!shown) {
    try {
      const cfg = await idbGet('config');
      if (cfg && cfg.backendUrl && cfg.token) {
        const res = await fetch(cfg.backendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'pull', token: cfg.token, deviceId: cfg.deviceId })
        });
        const data = await res.json();
        fetched = !!(data && data.ok);
        if (fetched) for (const n of data.items || []) { await showMsg(n); shown++; }
      }
    } catch (e) { /* network issue — neeche generic notification dikhayenge */ }
  }

  // Browser ko har push par notification chahiye (userVisibleOnly). Kuch na mile to generic dikhao.
  if (!shown) {
    await self.registration.showNotification('PingMe', {
      body: 'You have a new message. Open the app to view it.',
      icon: url('icons/icon-192x192.png'),
      badge: url('icons/badge-96x96.png'),
      tag: 'pingme-generic'
    });
    if (fetched) {   // server ne bola koi naya nahi (duplicate push) → generic ko turant hata do
      await new Promise((r) => setTimeout(r, 1500));
      const list = await self.registration.getNotifications({ tag: 'pingme-generic' });
      list.forEach((n) => n.close());
    }
  }

  // Khula hua app ho to usse refresh karne ko bolo
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  wins.forEach((w) => w.postMessage({ type: 'refresh' }));
}

self.addEventListener('push', (event) => { event.waitUntil(handlePush(event)); });

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.indexOf(SCOPE) === 0) {
        await w.focus();
        w.postMessage({ type: 'open', view: 'history', tab: 'received' });
        return;
      }
    }
    await self.clients.openWindow(url('./?open=received'));
  })());
});

/* Push subscription expire ho jaye to chupke se dobara subscribe karo */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const cfg = await idbGet('config');
      if (!cfg || !cfg.vapidKey || !cfg.token || !cfg.backendUrl) return;
      const pad = '='.repeat((4 - (cfg.vapidKey.length % 4)) % 4);
      const raw = atob((cfg.vapidKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch(cfg.backendUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'subscribe', token: cfg.token, deviceId: cfg.deviceId, subscription: sub.toJSON(), label: 'Device' })
      });
    } catch (e) {}
  })());
});
