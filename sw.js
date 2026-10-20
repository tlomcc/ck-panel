const CACHE_NAME = 'ck-panel-shell-v361-chat-v347-read-recovery';
const SHELL_ASSETS = [
  './codex-storage.js?v=chat-v347-read-recovery',
  './codex-tasks.js?v=chat-v347-read-recovery',
  './codex-tasks.css?v=chat-v347-read-recovery',
  './records-settings.css?v=chat-v347-read-recovery',
  './settings-tabs.js?v=chat-v347-read-recovery',
  './daily-records.js?v=chat-v347-read-recovery',
  './subscription.js?v=chat-v347-read-recovery',
  './subscription.css?v=chat-v347-read-recovery',
  './memory-review.js?v=chat-v347-read-recovery',
  './server-status.js?v=chat-v347-read-recovery',
  './server-status.css?v=chat-v347-read-recovery',
  './backend-route.js?v=chat-v347-read-recovery',
  './chat-recovery.js?v=chat-v347-read-recovery',
  './chat-wake.js?v=chat-v347-read-recovery',
  './chat-digest.js?v=chat-v347-read-recovery',
  './chat-digest-activation.js?v=chat-v347-read-recovery',
  './chat-window-cleanup.js?v=chat-v347-read-recovery',
  './chat-digest-schedule.js?v=chat-v347-read-recovery',
  './chat-delete-digest.js?v=chat-v347-read-recovery',
  './memory-workbench.js?v=chat-v347-read-recovery',
  './memory-workbench.css?v=chat-v347-read-recovery',
  './memory-library.css?v=chat-v347-read-recovery',
  './organizing-switches.js?v=chat-v347-read-recovery',
  './maintenance.js?v=chat-v347-read-recovery',
  './maintenance.css?v=chat-v347-read-recovery',
  './select-ui.js?v=chat-v347-read-recovery',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v347-read-recovery',
  './tokens.css?v=chat-v347-read-recovery',
  './style.css?v=chat-v347-read-recovery',
  './polish.css?v=chat-v347-read-recovery',
  './chat.css?v=chat-v347-read-recovery',
  './wechat.css?v=chat-v347-read-recovery',
  './visual-overrides.css?v=chat-v347-read-recovery',
  './shell.css?v=chat-v347-read-recovery',
  './daily-status.css?v=chat-v347-read-recovery',
  './settings.css?v=chat-v347-read-recovery',
  './components.css?v=chat-v347-read-recovery',
  './chat-ui.js?v=chat-v347-read-recovery',
  './chat-ui.css?v=chat-v347-read-recovery',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v347-read-recovery',
  './script.js?v=chat-v347-read-recovery',
  './script-extra.js?v=chat-v347-read-recovery',
  './pwa.js?v=chat-v347-read-recovery',
  './manifest.webmanifest',
  './icons/app-icon-v4-192.png',
  './icons/app-icon-v4-maskable-192.png',
  './icons/app-icon-v4-512.png',
  './icons/app-icon-v4-maskable-512.png',
  './icons/apple-touch-icon-v4.png'
];

// Limit maintenance and fallback to this app's shell.
self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(SHELL_ASSETS);
  }).then(function() { return self.skipWaiting(); }));
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) {
      return key.indexOf('ck-panel-shell-') === 0 && key !== CACHE_NAME;
    }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }));
});

async function shellFallback(key) {
  try {
    var cache = await caches.open(CACHE_NAME);
    return await cache.match(key) || Response.error();
  } catch (error) { return Response.error(); }
}

async function shellFetch(request, key, reload, navigation) {
  var response;
  try { response = await fetch(request, reload ? { cache: 'reload' } : undefined); }
  catch (error) { return shellFallback(key); }
  if (response.status >= 500) {
    var fallback = await shellFallback(key);
    if (fallback.type !== 'error') return fallback;
  }
  if (response.ok && (!navigation || /text\/html/i.test(response.headers.get('Content-Type') || ''))) {
    try {
      var cache = await caches.open(CACHE_NAME);
      await cache.put(key, response.clone());
    } catch (error) { /* Storage failure must not discard a usable network response. */ }
  }
  return response;
}

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  var base = new URL('./', self.location.href);
  var shellPath = SHELL_ASSETS.some(function(asset) { return new URL(asset, base).pathname === url.pathname; });
  if (!shellPath) return;
  var navigation = request.mode === 'navigate';
  if (navigation && url.pathname !== base.pathname && url.pathname !== new URL('index.html', base).pathname) return;
  var version = url.pathname === new URL('version.json', base).pathname;
  var reload = navigation || version || url.searchParams.has('__ck_version_check') ||
    url.searchParams.has('__ck_sw_version_check') || url.searchParams.has('ck_reload');
  var key = navigation ? './index.html' : version ? './version.json' : request;
  // respondWith owns the full cache-write lifetime; no detached put promises.
  event.respondWith(shellFetch(request, key, reload, navigation));
});
