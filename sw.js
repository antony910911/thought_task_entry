// 離線快取：App 本身的檔案先從快取讀，背景再更新。外部 API（Microsoft、Webhook）一律不快取。
// 新版檔案會在背景下載、下次開啟生效；新增或改名檔案時請更新 FILES 並把 VERSION 加一。
const VERSION = 'v21';
const CACHE = `beamup-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/parser.js',
  './js/icons.js',
  './js/themes.js',
  './js/mascot.js',
  './js/aliens.js',
  './js/capture.js',
  './js/pet.js',
  './js/sync/todo.js',
  './js/sync/microsoft.js',
  './js/sync/calendar.js',
  './js/sync/folio.js',
  './js/sync/cloud.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 登入導回時網址帶 ?code=，要走網路讓頁面正常載入
  const key = url.search ? new Request(url.origin + url.pathname) : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
