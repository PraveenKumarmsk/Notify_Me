/* =====================================================================
   PingMe — frontend (plain JavaScript, no framework, no build step)
   Backend: Google Apps Script Web App (Code.gs)   Push: Web Push + VAPID
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   CONFIG — yahan kuch bharna zaroori NAHI hai.
   App pehli baar kholne par Web App URL paste karne ko kahega aur browser me yaad rakhega.
   Chahein to apna /exec URL yahan daal dein (taaki sabke liye pehle se set rahe):
   --------------------------------------------------------------------- */
const BACKEND_URL_DEFAULT = "";   // jaise: "https://script.google.com/macros/s/XXXX/exec"

/* ---------- Chhote helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const localTime = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());

/* ---------- Icons (inline SVG, constants only) ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  history: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'
};
const icon = (n) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';

/* =====================================================================
   State
   ===================================================================== */
const S = {
  backend: '',
  token: null, user: null,
  view: 'dashboard',
  stats: null, devices: [],
  people: null,                 // {friends, incoming, outgoing}
  hist: { sent: null, received: null, scheduled: null }, histTab: 'received',
  compose: { tab: 'instant', to: [], msg: '' },
  vapid: null, vapidReady: null, vapidMsg: '',
  pushSub: false,
  installEvt: null,
  authMode: 'login'
};

function validBackend(u) { return typeof u === 'string' && /^https?:\/\/[^\s]+\/exec$/.test(u.trim()); }
function resolveBackend() {
  try {
    const p = new URLSearchParams(location.search), api = p.get('api');
    if (api && validBackend(api)) { ls.set('backendUrl', api.trim()); history.replaceState(null, '', location.pathname); }
  } catch (e) {}
  const saved = ls.get('backendUrl');
  if (validBackend(saved)) return saved.trim();
  if (validBackend(BACKEND_URL_DEFAULT)) return BACKEND_URL_DEFAULT.trim();
  return '';
}

/* =====================================================================
   API (Apps Script Web App)
   text/plain isliye ki browser "preflight" (OPTIONS) na bheje — Apps Script OPTIONS support nahi karta.
   ===================================================================== */
async function api(action, data) {
  const body = JSON.stringify(Object.assign({ action: action, token: S.token }, data || {}));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  let res;
  try {
    res = await fetch(S.backend, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, signal: ctl.signal });
  } catch (e) {
    throw new Error(navigator.onLine ? 'Server se connect nahi ho paya. Web App URL aur deploy setting (Access: Anyone) check kijiye.' : 'Internet nahi hai.');
  } finally { clearTimeout(timer); }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Server ka jawab samajh nahi aaya. Web App "Anyone" access ke saath deploy hai?'); }
  if (!json.ok) {
    if (json.code === 'auth' && S.token) forceLogout(json.error);
    const err = new Error(json.error || 'Error'); err.code = json.code; throw err;
  }
  return json;
}
async function loadConfig() {
  try {
    const r = await fetch(S.backend + '?action=config');
    const j = await r.json();
    if (j && j.ok) { S.vapid = j.vapidPublicKey || null; S.vapidReady = j.vapidReady; S.vapidMsg = j.vapidMessage || ''; }
  } catch (e) {}
}

/* ---------- Toast / messages ---------- */
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 4500 : 2600);
}
function setMsg(el, type, text) { el.className = 'msg show ' + type; el.textContent = text; }
function clearMsg(el) { el.className = 'msg'; el.textContent = ''; }

/* ---------- IndexedDB (service worker ke saath config share karne ke liye) ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('pingme', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  try {
    const db = await idb();
    await new Promise((resolve) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch (e) {}
}
function deviceId() {
  let id = ls.get('deviceId');
  if (!id) {
    id = 'd' + Array.from(crypto.getRandomValues(new Uint8Array(9))).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
    ls.set('deviceId', id);
  }
  return id;
}
function saveSwConfig() {
  return idbSet('config', { backendUrl: S.backend, token: S.token, deviceId: deviceId(), vapidKey: S.vapid });
}

/* =====================================================================
   Theme
   ===================================================================== */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  ls.set('theme', t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#0f1220' : '#6366f1');
  const b = $('themeBtn'); if (b) b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

/* =====================================================================
   Screens: setup / auth / app
   ===================================================================== */
function showOnly(id) {
  ['setupScreen', 'authScreen', 'appShell'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}

/* ---- Backend URL setup ---- */
$('setupSave').addEventListener('click', () => {
  const u = $('setupUrl').value.trim();
  if (!validBackend(u)) { setMsg($('setupMsg'), 'err', 'URL sahi nahi hai. Ye https://script.google.com/macros/s/.../exec jaisa hona chahiye.'); return; }
  ls.set('backendUrl', u); location.reload();
});
$('changeBackend').addEventListener('click', changeBackend);
function changeBackend() {
  const u = window.prompt('Naya Web App URL (/exec wala):', S.backend);
  if (u === null) return;
  if (!validBackend(u)) { alert('URL sahi nahi hai.'); return; }
  ls.set('backendUrl', u.trim()); location.reload();
}

/* ---- Login / Register ---- */
function setAuthMode(mode) {
  S.authMode = mode;
  document.querySelectorAll('#authTabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.auth === mode));
  $('nameRow').classList.toggle('hidden', mode !== 'register');
  $('authSubmit').textContent = mode === 'login' ? 'Login' : 'Account banao';
  $('fPass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  clearMsg($('authMsg'));
}
$('authTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-auth]'); if (b) setAuthMode(b.dataset.auth); });
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = $('fUser').value.trim().toLowerCase(), password = $('fPass').value, name = $('fName').value.trim();
  const msg = $('authMsg'), btn = $('authSubmit');
  if (!/^[a-z0-9_]{3,20}$/.test(userId)) { setMsg(msg, 'err', 'User ID 3-20 characters: sirf a-z, 0-9 aur _'); return; }
  if (password.length < 6) { setMsg(msg, 'err', 'Password kam se kam 6 characters ka rakhiye.'); return; }
  btn.disabled = true; setMsg(msg, 'info', S.authMode === 'login' ? 'Login ho raha hai…' : 'Account ban raha hai…');
  try {
    const r = await api(S.authMode, { userId: userId, password: password, name: name || userId });
    S.token = r.token; S.user = r.user;
    ls.set('session', JSON.stringify({ token: r.token, user: r.user }));
    $('fPass').value = '';
    clearMsg(msg);
    enterApp();
  } catch (err) { setMsg(msg, 'err', err.message); }
  btn.disabled = false;
});

function forceLogout(message) {
  S.token = null; S.user = null; S.stats = null; S.people = null; S.hist = { sent: null, received: null, scheduled: null };
  ls.del('session'); idbSet('config', null);
  stopPolling();
  showOnly('authScreen'); setAuthMode('login');
  if (message) setMsg($('authMsg'), 'warn', message);
}
async function logout() {
  if (!confirm('Logout karna hai? Is device par notifications band ho jayengi.')) return;
  try { await api('logout', { deviceId: deviceId() }); } catch (e) {}
  try {
    if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); }
  } catch (e) {}
  ls.del('pushOn');
  forceLogout();
}

/* =====================================================================
   App shell: navigation
   ===================================================================== */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'compose', label: 'Send', icon: 'send' },
  { id: 'people', label: 'People', icon: 'users' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
];
function buildNav() {
  const st = S.stats ? S.stats.stats : null;
  const badge = (id) => {
    const n = id === 'people' ? (st && st.incoming) : id === 'history' ? (st && st.unread) : 0;
    return n ? '<span class="badge-dot">' + (n > 99 ? '99+' : n) + '</span>' : '';
  };
  const html = NAV.map((n) => '<button data-nav="' + n.id + '" class="' + (S.view === n.id ? 'active' : '') + '">' + icon(n.icon) + '<span>' + n.label + '</span>' + badge(n.id) + '</button>').join('');
  $('sideNav').innerHTML = html; $('bottomNav').innerHTML = html;
  $('meChip').innerHTML = S.user ? '<div class="avatar" style="' + avStyle(S.user.id) + '">' + esc(initial(S.user.name)) + '</div><div class="grow"><div class="title">' + esc(S.user.name) + '</div><div class="sub muted small">@' + esc(S.user.id) + '</div></div>' : '';
}
document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-nav]');
  if (n) navigate(n.dataset.nav);
});
const TITLES = { dashboard: 'Dashboard', compose: 'Notification bhejo', people: 'People', history: 'History', settings: 'Settings' };
function navigate(view, opts) {
  S.view = view;
  if (opts && opts.tab) S.histTab = opts.tab;
  $('pageTitle').textContent = TITLES[view] || '';
  buildNav(); render(true);
  window.scrollTo(0, 0);
}
function avStyle(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return 'background:linear-gradient(135deg,hsl(' + h + ',70%,55%),hsl(' + ((h + 40) % 360) + ',70%,48%))';
}
const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

/* =====================================================================
   Data loading (+ offline cache)
   ===================================================================== */
function cacheKey() { return 'cache_' + (S.user ? S.user.id : ''); }
function saveCache() { ls.set(cacheKey(), JSON.stringify({ stats: S.stats, people: S.people, hist: S.hist, devices: S.devices })); }
function loadCache() {
  try {
    const c = JSON.parse(ls.get(cacheKey()) || 'null');
    if (c) { S.stats = c.stats; S.people = c.people; S.hist = c.hist || S.hist; S.devices = c.devices || []; }
  } catch (e) {}
}
async function refreshStats() {
  const r = await api('stats');
  S.stats = r; S.devices = r.devices || []; S.user = r.user;
  ls.set('session', JSON.stringify({ token: S.token, user: S.user }));
  buildNav(); saveCache();
}
async function loadPeople() { S.people = await api('connections'); saveCache(); }
async function loadHistory(kind) { const r = await api('history', { kind: kind }); S.hist[kind] = r.items; saveCache(); }

/* view ke hisaab se zaroori data lao, phir render */
async function loadFor(view) {
  const jobs = [refreshStats()];
  if (view === 'compose' || view === 'people') jobs.push(loadPeople());
  if (view === 'history') jobs.push(loadHistory(S.histTab));
  if (view === 'dashboard') jobs.push(loadHistory('received'));
  await Promise.all(jobs);
}
let loadSeq = 0;
async function render(withLoad) {
  const seq = ++loadSeq;
  renderView();
  if (!withLoad) return;
  try {
    await loadFor(S.view);
    setOffline(false);
  } catch (e) {
    if (!navigator.onLine || /Internet nahi|connect nahi/.test(e.message)) setOffline(true);
    else toast(e.message, true);
  }
  if (seq === loadSeq) {
    renderView(true);
    if (S.view === 'history' && S.histTab === 'received') markReadSilently();
  }
}
function setOffline(v) { $('offlineBar').classList.toggle('hidden', !v); }

let pollTimer = null;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !S.token || S.view === 'compose' || S.view === 'settings') return;
    softRefresh();
  }, 25000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
async function softRefresh() {
  if (!S.token) return;
  const view = S.view;
  try { await loadFor(view); setOffline(false); if (S.view === view && !modalOpen()) renderView(true); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) softRefresh(); });
window.addEventListener('online', () => { setOffline(false); if (S.token) softRefresh(); });
window.addEventListener('offline', () => setOffline(true));

async function markReadSilently() {
  const items = S.hist.received || [];
  if (!items.some((i) => !i.readAt)) return;
  try {
    await api('markRead', {});
    const now = new Date().toISOString();
    items.forEach((i) => { if (!i.readAt) { i.readAt = now; if (i.status !== 'failed') i.status = 'read'; } });
    if (S.stats) S.stats.stats.unread = 0;
    buildNav();
  } catch (e) {}
}

/* =====================================================================
   View rendering
   ===================================================================== */
function renderView(partial) {
  const v = $('view');
  if (S.view === 'compose') {
    // typing ke beech me poll/load se poora re-render na ho — sirf user-list badlo
    if (partial && $('whoBox')) { $('whoBox').innerHTML = composeWho(); updateBulkLabel(); }
    else { v.innerHTML = viewCompose(); afterCompose(); }
  } else if (S.view === 'people') {
    if (partial && $('peopleLists')) $('peopleLists').innerHTML = peopleListsHtml();
    else { v.innerHTML = viewPeople(); afterPeople(); }
  } else if (S.view === 'history') v.innerHTML = viewHistory();
  else if (S.view === 'settings') v.innerHTML = viewSettings();
  else v.innerHTML = viewDashboard();
  if (S.view === 'dashboard' || S.view === 'settings') updatePushUi();
}

const pillClass = (st) => String(st || '').split(':')[0];
const pillLabel = (st) => ({ sent: 'Sent', delivered: 'Delivered', read: 'Read', queued: 'Queued', failed: 'Failed', pending: 'Scheduled', cancelled: 'Cancelled', sending: 'Sending' }[pillClass(st)] || st);
function fmtWhen(iso, d, t) {
  try { const x = new Date(iso); if (!isNaN(x)) return x.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) {}
  return (d || '') + ' ' + (t || '');
}

/* ---------- Dashboard ---------- */
function viewDashboard() {
  const st = S.stats ? S.stats.stats : { totalUsers: 0, connected: 0, sent: 0, received: 0, scheduled: 0 };
  const cards = [
    ['Total Users', st.totalUsers, 'users', 'c1'], ['Connected Users', st.connected, 'userplus', 'c2'],
    ['Notifications Sent', st.sent, 'send', 'c3'], ['Notifications Received', st.received, 'inbox', 'c4'],
    ['Scheduled', st.scheduled, 'clock', 'c5']
  ].map((c) => '<div class="stat"><div class="ico ' + c[3] + '">' + icon(c[2]) + '</div><div class="num">' + esc(c[1]) + '</div><div class="lbl">' + c[0] + '</div></div>').join('');
  const recent = (S.hist.received || []).slice(0, 4);
  const recentHtml = recent.length
    ? recent.map((i) => bubbleHtml(i, 'received', true)).join('')
    : '<div class="empty">Abhi koi notification nahi aayi.</div>';
  return '' +
    '<div class="card hero"><div><h3>Hi, ' + esc(S.user ? S.user.name : '') + '</h3><p>@' + esc(S.user ? S.user.id : '') + ' &middot; ' + esc(st.connected) + ' connected</p></div>' +
    '<button class="btn" data-nav="compose">' + icon('send') + ' Notification bhejo</button></div>' +
    '<div id="pushCard"></div>' +
    '<div class="stats">' + cards + '</div>' +
    (S.installEvt ? '<div class="card"><div class="card-head"><div><h3>App install kijiye</h3><div class="muted small">Home screen par icon aayega aur app full-screen khulega.</div></div><button class="btn primary sm" data-act="install">Install</button></div></div>' : '') +
    '<div class="card"><div class="card-head"><h3>Recent notifications</h3><button class="btn sm" data-nav="history">Sab dekhein</button></div><div>' + recentHtml + '</div></div>';
}

/* ---------- Push status card (dashboard + settings) ---------- */
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
async function refreshPushSub() {
  try {
    if (!pushSupported()) { S.pushSub = false; return; }
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 3000))]);
    S.pushSub = !!(await reg.pushManager.getSubscription()) && Notification.permission === 'granted';
  } catch (e) { S.pushSub = false; }
}
async function updatePushUi() {
  await refreshPushSub();
  const box = $('pushCard');
  if (box) {
    let inner;
    if (!pushSupported()) {
      inner = '<h3>Push notifications</h3><div class="msg show warn">' + (isIOS() && !isStandalone()
        ? 'iPhone par: Safari me Share &rarr; <b>Add to Home Screen</b> karke app wahin se kholiye, tab push chalenge (iOS 16.4+).'
        : 'Ye browser push notifications support nahi karta. Android par Chrome use kijiye.') + '</div>';
    } else if (S.pushSub) {
      inner = '<div class="card-head"><div><h3>Push chalu hai</h3><div class="muted small">Is device par notifications aayengi.</div></div><button class="btn sm" data-act="testPush">Test bhejo</button></div>';
    } else {
      inner = '<div class="card-head"><div><h3>Notifications band hain</h3><div class="muted small">Is device par push paane ke liye Enable kijiye.</div></div><button class="btn primary sm" data-act="enablePush">Enable</button></div>' +
        (S.vapidReady === false ? '<div class="msg show warn">Server setup adhoora hai: ' + esc(S.vapidMsg) + '</div>' : '');
    }
    box.innerHTML = '<div class="card">' + inner + '</div>';
  }
  const sb = $('settingsPush');
  if (sb) {
    sb.innerHTML = !pushSupported() ? '<div class="muted">Ye browser push support nahi karta' + (isIOS() && !isStandalone() ? ' — pehle Add to Home Screen kijiye.' : '.') + '</div>'
      : (S.pushSub
        ? '<div class="kv"><span>Is device par push</span><b style="color:var(--ok)">Chalu</b></div><div class="acts" style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" data-act="testPush">Test notification</button><button class="btn sm danger" data-act="disablePush">Band karein</button></div>'
        : '<div class="kv"><span>Is device par push</span><b style="color:var(--warn)">Band</b></div><button class="btn primary sm" style="margin-top:10px" data-act="enablePush">Enable notifications</button>' +
          (S.vapidReady === false ? '<div class="msg show warn">Server setup adhoora hai: ' + esc(S.vapidMsg) + '</div>' : ''));
  }
}

/* ---------- Compose ---------- */
const QUICK = ['Hi', 'Hello', 'How are you?', 'Good morning', 'Good night', 'Call me', 'Thanks', 'Reached safely'];
function friendsList() { return S.people ? S.people.friends : []; }
function composeWho() {
  const c = S.compose, fr = friendsList();
  let who;
  if (S.people === null) {
    who = '<div class="empty">Load ho raha hai…</div>';
  } else if (!fr.length) {
    who = '<div class="empty">Abhi koi connected user nahi hai.<br><button class="btn primary sm" style="margin-top:10px" data-nav="people">User dhoondhein</button></div>';
  } else {
    const multi = c.tab === 'bulk';
    who = (multi ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="muted small" id="selCount"></span><button class="chip" data-act="selAll">Sabko chuniye</button></div>' : '') +
      '<div class="pick">' + fr.map((f) => '<label class="opt ' + (c.to.indexOf(f.userId) !== -1 ? 'sel' : '') + '"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="to" value="' + esc(f.userId) + '" ' + (c.to.indexOf(f.userId) !== -1 ? 'checked' : '') + '><span class="avatar" style="' + avStyle(f.userId) + '">' + esc(initial(f.name)) + '</span><span>' + esc(f.name) + ' <span class="muted small">@' + esc(f.userId) + '</span></span></label>').join('') + '</div>';
  }
  return who;
}
function viewCompose() {
  const c = S.compose;
  const seg = ['instant|Instant', 'schedule|Schedule', 'bulk|Bulk'].map((s) => { const p = s.split('|'); return '<button class="seg-btn ' + (c.tab === p[0] ? 'active' : '') + '" data-ctab="' + p[0] + '">' + p[1] + '</button>'; }).join('');
  const btnLabel = c.tab === 'instant' ? icon('send') + ' Abhi bhejo' : c.tab === 'schedule' ? icon('clock') + ' Time chuniye…' : icon('send') + ' <span id="bulkLbl">Sabko bhejo</span>';
  return '<div class="card"><div class="seg" style="margin-top:0">' + seg + '</div>' +
    '<label style="margin-top:6px">' + (c.tab === 'bulk' ? 'Kinko bhejna hai? (multiple)' : 'Kisko bhejna hai?') + '</label><div id="whoBox">' + composeWho() + '</div>' +
    '<label for="cMsg">Message</label><textarea id="cMsg" maxlength="300" placeholder="Jaise: Hi, How are you?">' + esc(c.msg) + '</textarea>' +
    '<div class="counter"><span id="cCount">0</span>/300</div>' +
    '<div class="chips">' + QUICK.map((q) => '<button class="chip" type="button" data-quick="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
    '<button class="btn primary block" id="cSend" data-act="composeGo">' + btnLabel + '</button><div class="msg" id="cMsgBox"></div></div>';
}
function afterCompose() {
  const t = $('cMsg'); if (t) $('cCount').textContent = t.value.length;
  updateBulkLabel();
}
function updateBulkLabel() {
  const n = S.compose.to.length;
  if ($('selCount')) $('selCount').textContent = n + ' chune gaye';
  if ($('bulkLbl')) $('bulkLbl').textContent = n ? n + ' ko bhejo' : 'Sabko bhejo';
}
function readComposeInputs() { const t = $('cMsg'); if (t) S.compose.msg = t.value; }

/* ---------- People ---------- */
function personRow(u, actions) {
  return '<div class="row"><div class="avatar" style="' + avStyle(u.userId) + '">' + esc(initial(u.name)) + '</div><div class="grow"><div class="title">' + esc(u.name) + '</div><div class="sub">@' + esc(u.userId) + '</div></div><div class="acts">' + actions + '</div></div>';
}
function viewPeople() {
  return '<div class="card"><h3>User dhoondhein</h3><div class="muted small" style="margin-bottom:10px">User ID ya naam se search kijiye aur connection request bhejiye.</div>' +
    '<div class="search-box">' + icon('search') + '<input id="peopleQ" type="search" placeholder="User ID search…" autocomplete="off" autocapitalize="none"></div>' +
    '<div id="searchRes" class="list" style="margin-top:8px"></div></div><div id="peopleLists">' + peopleListsHtml() + '</div>';
}
function peopleListsHtml() {
  const p = S.people || { friends: [], incoming: [], outgoing: [] };
  return '' +
    (p.incoming.length ? '<div class="card"><h3>Aayi hui requests (' + p.incoming.length + ')</h3><div class="list">' + p.incoming.map((u) => personRow(u, '<button class="btn primary sm" data-act="accept" data-id="' + esc(u.userId) + '">' + icon('check') + '</button><button class="btn sm danger" data-act="reject" data-id="' + esc(u.userId) + '">' + icon('x') + '</button>')).join('') + '</div></div>' : '') +
    (p.outgoing.length ? '<div class="card"><h3>Bheji hui requests</h3><div class="list">' + p.outgoing.map((u) => personRow(u, '<span class="pill pending">Pending</span><button class="btn sm" data-act="cancelReq" data-id="' + esc(u.userId) + '">Cancel</button>')).join('') + '</div></div>' : '') +
    '<div class="card"><h3>Connected users (' + p.friends.length + ')</h3>' +
    (p.friends.length ? '<div class="list">' + p.friends.map((u) => personRow(u, '<button class="btn primary sm" data-act="sendTo" data-id="' + esc(u.userId) + '">' + icon('send') + '</button><button class="btn sm danger" data-act="unfriend" data-id="' + esc(u.userId) + '">' + icon('trash') + '</button>')).join('') + '</div>' : '<div class="empty">Abhi koi connection nahi hai. Upar se user search kijiye.</div>') + '</div>';
}
let searchTimer = null;
function afterPeople() {
  const q = $('peopleQ'); if (!q) return;
  q.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 350); };
  if (q.value) doSearch();
}
async function doSearch() {
  const q = $('peopleQ'), box = $('searchRes'); if (!q || !box) return;
  const term = q.value.trim();
  if (term.length < 2) { box.innerHTML = ''; return; }
  try {
    const r = await api('searchUsers', { q: term });
    if (!$('searchRes') || $('peopleQ').value.trim() !== term) return;
    box.innerHTML = r.users.length ? r.users.map((u) => {
      const act = u.relation === 'none' ? '<button class="btn primary sm" data-act="request" data-id="' + esc(u.userId) + '">' + icon('userplus') + ' Connect</button>'
        : u.relation === 'connected' ? '<span class="pill delivered">Connected</span>'
        : u.relation === 'pending_out' ? '<span class="pill pending">Request bheji</span>'
        : '<button class="btn primary sm" data-act="accept" data-id="' + esc(u.userId) + '">Accept</button>';
      return personRow(u, act);
    }).join('') : '<div class="empty">Koi user nahi mila.</div>';
  } catch (e) { box.innerHTML = '<div class="msg show err">' + esc(e.message) + '</div>'; }
}

/* ---------- History ---------- */
function bubbleHtml(i, kind, compact) {
  const unread = kind === 'received' && !i.readAt;
  const who = kind === 'received' ? 'From ' + esc(i.otherName) + ' <span class="muted small">@' + esc(i.other) + '</span>' : 'To ' + esc(i.otherName) + ' <span class="muted small">@' + esc(i.other) + '</span>';
  const st = kind === 'received' ? '' : '<span class="pill ' + pillClass(i.status) + '">' + esc(pillLabel(i.status)) + '</span>';
  const recvTag = kind === 'received' ? (i.readAt ? '<span class="small">Read</span>' : '<span class="pill sent">New</span>') : '';
  return '<div class="bubble-row ' + (unread ? 'unread' : '') + '"><div class="avatar" style="' + avStyle(i.other) + '">' + esc(initial(i.otherName)) + '</div><div class="bubble"><div class="who"><span>' + who + '</span></div><div class="txt">' + esc(i.message) + '</div><div class="meta"><span>' + esc(fmtWhen(i.at, i.date, i.time)) + '</span>' + st + recvTag +
    (compact ? '' : '<button class="del" data-act="del" data-id="' + esc(i.id) + '" data-kind="' + kind + '" title="' + (kind === 'scheduled' ? 'Cancel / delete' : 'Delete') + '" aria-label="Delete">' + icon('trash') + '</button>') + '</div></div></div>';
}
function viewHistory() {
  const tab = S.histTab, items = S.hist[tab];
  const seg = ['received|Received', 'sent|Sent', 'scheduled|Scheduled'].map((s) => { const p = s.split('|'); return '<button class="seg-btn ' + (tab === p[0] ? 'active' : '') + '" data-htab="' + p[0] + '">' + p[1] + '</button>'; }).join('');
  let body;
  if (items === null) body = '<div class="empty">Load ho raha hai…</div>';
  else if (!items.length) body = '<div class="empty">' + (tab === 'scheduled' ? 'Koi scheduled notification nahi hai.' : 'Yahan abhi kuch nahi hai.') + '</div>';
  else body = items.map((i) => bubbleHtml(i, tab, false)).join('');
  return '<div class="card"><div class="seg" style="margin-top:0">' + seg + '</div>' +
    '<div class="muted small" style="margin:8px 2px">' + (tab === 'sent' ? 'Status: Sent &rarr; Delivered &rarr; Read' : tab === 'scheduled' ? 'Pending wali notification delete karne par cancel ho jati hai.' : 'Notification kholne par Read mark ho jati hai.') + '</div>' + body + '</div>';
}

/* ---------- Settings ---------- */
function viewSettings() {
  const devs = S.devices || [];
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return '<div class="card"><h3>Account</h3><div class="kv"><span>Naam</span><b>' + esc(S.user ? S.user.name : '') + '</b></div><div class="kv"><span>User ID</span><b>@' + esc(S.user ? S.user.id : '') + '</b></div>' +
    '<div class="kv"><span>Sync hue devices</span><b>' + devs.length + '</b></div>' +
    (devs.length ? '<div class="muted small" style="margin-top:6px">' + devs.map((d) => esc(d.label || 'Device')).join(' &middot; ') + '</div>' : '') +
    '<div class="muted small" style="margin-top:10px">Doosre phone/laptop par isi User ID se login kijiye aur Enable dabaiye — sabhi devices par notification aayegi.</div></div>' +
    '<div class="card"><h3>Push notifications</h3><div id="settingsPush"></div></div>' +
    '<div class="card"><h3>Display</h3><div class="kv"><span>Theme</span><button class="btn sm" data-act="theme">' + icon(dark ? 'sun' : 'moon') + ' ' + (dark ? 'Light mode' : 'Dark mode') + '</button></div>' +
    (S.installEvt ? '<div class="kv"><span>App install</span><button class="btn sm primary" data-act="install">Install</button></div>' : '') + '</div>' +
    '<div class="card"><h3>Backend</h3><div class="muted small" style="word-break:break-all">' + esc(S.backend) + '</div><button class="btn sm" style="margin-top:10px" data-act="backend">URL badlo</button></div>' +
    '<button class="btn block danger" data-act="logout">' + icon('logout') + ' Logout</button>';
}

/* =====================================================================
   Modal (schedule popup)
   ===================================================================== */
function modalOpen() { return !$('modal').classList.contains('hidden'); }
function openModal(html) { $('modalCard').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modalCard').innerHTML = ''; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') || e.target.closest('[data-close]')) closeModal(); });

function openScheduleModal() {
  const d = new Date(Date.now() + 10 * 60000);
  const to = S.compose.to[0], f = friendsList().find((x) => x.userId === to);
  openModal('<h3>Notification schedule kijiye</h3><div class="muted small">To: <b>' + esc(f ? f.name : '@' + to) + '</b></div>' +
    '<div class="two"><div><label for="sDate">Date</label><input type="date" id="sDate" min="' + localDate(new Date()) + '" value="' + localDate(d) + '"></div>' +
    '<div><label for="sTime">Time</label><input type="time" id="sTime" value="' + localTime(d) + '"></div></div>' +
    '<div class="chips"><button class="chip" data-qs="10">10 min baad</button><button class="chip" data-qs="60">1 ghante baad</button><button class="chip" data-qs="eve">Aaj 8 PM</button><button class="chip" data-qs="tom">Kal 9 AM</button></div>' +
    '<div class="msg" id="sMsg"></div>' +
    '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sGo">' + icon('clock') + ' Schedule karo</button></div>');
}
document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-qs]'); if (!q) return;
  const v = q.dataset.qs; let d = new Date();
  if (v === '10' || v === '60') d = new Date(Date.now() + parseInt(v, 10) * 60000);
  else if (v === 'eve') { d.setHours(20, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
  else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  $('sDate').value = localDate(d); $('sTime').value = localTime(d);
});
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#sGo')) return;
  const date = $('sDate').value, time = $('sTime').value, msg = $('sMsg');
  if (!date || !time) { setMsg(msg, 'err', 'Date aur time dono chuniye.'); return; }
  const when = new Date(date + 'T' + time);
  if (isNaN(when) || when.getTime() < Date.now() + 30000) { setMsg(msg, 'err', 'Time future me hona chahiye.'); return; }
  const btn = $('sGo'); btn.disabled = true; setMsg(msg, 'info', 'Schedule ho raha hai…');
  try {
    await api('send', { to: S.compose.to.slice(0, 1), message: S.compose.msg.trim(), scheduleAt: when.toISOString() });
    closeModal(); S.compose.msg = ''; S.compose.to = [];
    toast('Schedule ho gaya: ' + when.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }));
    S.hist.scheduled = null; refreshStats().catch(() => {}); navigate('history', { tab: 'scheduled' });
  } catch (err) { setMsg(msg, 'err', err.message); btn.disabled = false; }
});

/* =====================================================================
   Click / input handling (event delegation)
   ===================================================================== */
$('view').addEventListener('input', (e) => {
  if (e.target.id === 'cMsg') { S.compose.msg = e.target.value; $('cCount').textContent = e.target.value.length; }
});
$('view').addEventListener('change', (e) => {
  if (e.target.name !== 'to') return;
  const multi = S.compose.tab === 'bulk', v = e.target.value;
  if (multi) {
    const i = S.compose.to.indexOf(v);
    if (e.target.checked && i === -1) S.compose.to.push(v); else if (!e.target.checked && i !== -1) S.compose.to.splice(i, 1);
  } else S.compose.to = [v];
  document.querySelectorAll('.pick label.opt').forEach((l) => l.classList.toggle('sel', l.querySelector('input').checked));
  updateBulkLabel();
});

$('view').addEventListener('click', async (e) => {
  const ct = e.target.closest('[data-ctab]');
  if (ct) {
    readComposeInputs(); S.compose.tab = ct.dataset.ctab;
    if (S.compose.tab !== 'bulk') S.compose.to = S.compose.to.slice(0, 1);
    renderView(); return;
  }
  const ht = e.target.closest('[data-htab]');
  if (ht) { S.histTab = ht.dataset.htab; render(true); return; }
  const qk = e.target.closest('[data-quick]');
  if (qk) { const t = $('cMsg'); t.value = qk.dataset.quick; S.compose.msg = t.value; $('cCount').textContent = t.value.length; t.focus(); return; }

  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act, id = a.dataset.id;
  const run = async (fn, okMsg) => {
    a.disabled = true;
    try { await fn(); if (okMsg) toast(okMsg); } catch (err) { toast(err.message, true); }
    a.disabled = false;
  };
  switch (act) {
    case 'theme': toggleTheme(); renderView(); break;
    case 'logout': logout(); break;
    case 'backend': changeBackend(); break;
    case 'install': installApp(); break;
    case 'enablePush': run(async () => { await enablePush(); await refreshStats(); await updatePushUi(); }, 'Notifications chalu ho gayi'); break;
    case 'disablePush': run(async () => { await disablePush(); await refreshStats(); await updatePushUi(); }, 'Is device par push band kar diya'); break;
    case 'testPush': run(async () => { const r = await api('test'); toast(r.devices ? 'Test bhej diya — kuch second me aayega' : 'Pehle is device par Enable kijiye'); }); break;
    case 'selAll': {
      const all = friendsList().map((f) => f.userId);
      S.compose.to = S.compose.to.length === all.length ? [] : all.slice();
      readComposeInputs(); renderView(); break;
    }
    case 'composeGo': composeGo(a); break;
    case 'request': run(async () => { const r = await api('sendRequest', { to: id }); await loadPeople(); renderView(true); doSearch(); toast(r.status === 'accepted' ? 'Connected!' : 'Request bhej di'); }); break;
    case 'accept': run(async () => { await api('respondRequest', { from: id, accept: true }); await Promise.all([loadPeople(), refreshStats()]); renderView(true); doSearch(); }, 'Accept ho gaya'); break;
    case 'reject': run(async () => { await api('respondRequest', { from: id, accept: false }); await Promise.all([loadPeople(), refreshStats()]); renderView(true); doSearch(); }, 'Reject kar diya'); break;
    case 'cancelReq': run(async () => { await api('removeConnection', { userId: id }); await Promise.all([loadPeople(), refreshStats()]); renderView(true); doSearch(); }, 'Request cancel'); break;
    case 'unfriend': if (confirm('@' + id + ' ko connections se hatayein?')) run(async () => { await api('removeConnection', { userId: id }); await Promise.all([loadPeople(), refreshStats()]); renderView(true); doSearch(); }, 'Hata diya'); break;
    case 'sendTo': S.compose.to = [id]; S.compose.tab = S.compose.tab === 'bulk' ? 'instant' : S.compose.tab; navigate('compose'); break;
    case 'del': {
      const kind = a.dataset.kind;
      if (!confirm(kind === 'scheduled' ? 'Ye scheduled notification delete / cancel karein?' : 'Is notification ko history se delete karein?')) break;
      run(async () => {
        await api('remove', { id: id, kind: kind === 'scheduled' ? 'scheduled' : 'notif' });
        S.hist[kind] = (S.hist[kind] || []).filter((x) => x.id !== id); saveCache();
        refreshStats().catch(() => {}); renderView();
      }, 'Delete ho gaya');
      break;
    }
  }
});

/* ---------- Send / schedule action ---------- */
async function composeGo(btn) {
  readComposeInputs();
  const c = S.compose, msgBox = $('cMsgBox'), text = c.msg.trim();
  clearMsg(msgBox);
  if (!c.to.length) { setMsg(msgBox, 'err', c.tab === 'bulk' ? 'Kam se kam ek user chuniye.' : 'Pehle user chuniye.'); return; }
  if (!text) { setMsg(msgBox, 'err', 'Message likhiye.'); return; }
  if (c.tab === 'schedule') { openScheduleModal(); return; }
  btn.disabled = true; setMsg(msgBox, 'info', 'Bheja ja raha hai…');
  try {
    const r = await api('send', { to: c.to, message: text });
    const res = r.results || [];
    const failed = res.filter((x) => x.status === 'failed').length, queued = res.filter((x) => x.status === 'queued').length;
    c.msg = ''; c.to = c.tab === 'bulk' ? [] : c.to;
    renderView();
    const box = $('cMsgBox');
    if (failed === res.length) setMsg(box, 'err', 'Push nahi ja paya (receiver ka device abhi register nahi / push service error). Message unke app me History me dikhega.');
    else if (queued) setMsg(box, 'warn', 'Bhej diya. ' + queued + ' user ne abhi is app me notifications Enable nahi kiye — unhe app kholne par message dikhega.');
    else setMsg(box, 'ok', res.length > 1 ? res.length + ' users ko notification bhej di gayi.' : 'Notification bhej di gayi.');
    refreshStats().catch(() => {});
  } catch (err) { setMsg($('cMsgBox') || msgBox, 'err', err.message); btn.disabled = false; }
}

/* =====================================================================
   Push subscribe / unsubscribe
   ===================================================================== */
function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function sameKey(sub, bytes) {
  try {
    const cur = sub.options && sub.options.applicationServerKey;
    if (!cur) return true;
    const a = new Uint8Array(cur);
    if (a.length !== bytes.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  } catch (e) { return true; }
}
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  return os + ' ' + br;
}
async function swReady() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Service worker ready nahi hua. Site https (GitHub Pages) par kholiye.')), 8000))]);
}
async function enablePush(silent) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'iPhone par pehle Share → "Add to Home Screen" karke app wahin se kholiye (iOS 16.4+).' : 'Is browser me push notifications supported nahi hain.');
  if (!S.vapid) await loadConfig();
  if (!S.vapid) throw new Error('Server se VAPID public key nahi mili. Code.gs me keys daaliye aur New version deploy kijiye.');
  if (S.vapidReady === false) throw new Error('Server par VAPID keys sahi nahi hain: ' + S.vapidMsg);
  let perm = Notification.permission;
  if (perm === 'default' && !silent) perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    if (silent) return false;
    throw new Error(perm === 'denied' ? 'Notifications blocked hain. Browser ki site settings me jaakar Allow kijiye.' : 'Permission nahi mili.');
  }
  const reg = await swReady();
  const key = b64uToBytes(S.vapid);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('subscribe', { deviceId: deviceId(), subscription: sub.toJSON(), label: deviceLabel() });
  ls.set('pushOn', '1');
  await saveSwConfig();
  S.pushSub = true;
  return true;
}
async function disablePush() {
  try { await api('unsubscribe', { deviceId: deviceId() }); } catch (e) {}
  try { const reg = await swReady(); const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) {}
  ls.del('pushOn'); S.pushSub = false;
}
async function syncPush() {                         // login/app open par device ko is account se jod do (chupke se)
  try {
    if (pushSupported() && Notification.permission === 'granted') await enablePush(true);
  } catch (e) {}
}

function installApp() {
  const ev = S.installEvt; if (!ev) return;
  ev.prompt();
  ev.userChoice.finally(() => { S.installEvt = null; renderView(); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.token && (S.view === 'dashboard' || S.view === 'settings')) renderView(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('App install ho gaya'); });

/* =====================================================================
   Start
   ===================================================================== */
function enterApp() {
  showOnly('appShell');
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  loadCache();
  const open = new URLSearchParams(location.search).get('open');
  if (open) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  buildNav();
  saveSwConfig();
  loadConfig().then(() => { saveSwConfig(); syncPush().then(() => { if (S.view === 'dashboard' || S.view === 'settings') updatePushUi(); }); });
  navigate(open === 'received' ? 'history' : 'dashboard', open === 'received' ? { tab: 'received' } : null);
  startPolling();
}

$('themeBtn').addEventListener('click', () => { toggleTheme(); if (S.view === 'settings') renderView(); });
$('refreshBtn').addEventListener('click', () => { $('refreshBtn').classList.add('spin'); render(true).finally(() => $('refreshBtn').classList.remove('spin')); });
$('refreshBtn').innerHTML = icon('refresh');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'refresh' && S.token) softRefresh();
    if (d.type === 'open' && S.token) navigate('history', { tab: d.tab || 'received' });
  });
}

(function boot() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js', { scope: './' }).catch((err) => console.warn('SW register fail:', err)); });
  }
  S.backend = resolveBackend();
  if (!S.backend) { showOnly('setupScreen'); return; }
  try {
    const sess = JSON.parse(ls.get('session') || 'null');
    if (sess && sess.token && sess.user) { S.token = sess.token; S.user = sess.user; enterApp(); return; }
  } catch (e) {}
  showOnly('authScreen'); setAuthMode('login');
})();
