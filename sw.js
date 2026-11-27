const CACHE_NAME = 'ck-panel-shell-v457-chat-v443-history-recovery';
const SHELL_ASSETS = [
  './sortable-1.15.6.min.js?v=chat-v443-history-recovery',
  './game-window.js?v=chat-v443-history-recovery',
  './gomoku.js?v=chat-v443-history-recovery',
  './games.js?v=chat-v443-history-recovery',
  './games.css?v=chat-v443-history-recovery',
  './token-usage.js?v=chat-v443-history-recovery',
  './token-usage.css?v=chat-v443-history-recovery',
  './codex-storage.js?v=chat-v443-history-recovery',
  './codex-tasks.js?v=chat-v443-history-recovery',
  './codex-tasks.css?v=chat-v443-history-recovery',
  './records-settings.css?v=chat-v443-history-recovery',
  './settings-tabs.js?v=chat-v443-history-recovery',
  './daily-records.js?v=chat-v443-history-recovery',
  './active-memory.js?v=chat-v443-history-recovery',
  './subscription.js?v=chat-v443-history-recovery',
  './subscription.css?v=chat-v443-history-recovery',
  './server-status.js?v=chat-v443-history-recovery',
  './server-status.css?v=chat-v443-history-recovery',
  './backend-route.js?v=chat-v443-history-recovery',
  './chat-recovery.js?v=chat-v443-history-recovery',
  './chat-wake.js?v=chat-v443-history-recovery',
  './chat-digest.js?v=chat-v443-history-recovery',
  './chat-digest-activation.js?v=chat-v443-history-recovery',
  './chat-window-cleanup.js?v=chat-v443-history-recovery',
  './chat-digest-schedule.js?v=chat-v443-history-recovery',
  './chat-digest-auto.js?v=chat-v443-history-recovery',
  './chat-delete-digest.js?v=chat-v443-history-recovery',
  './memory-workbench.js?v=chat-v443-history-recovery',
  './memory-workbench.css?v=chat-v443-history-recovery',
  './event-memory.css?v=chat-v443-history-recovery',
  './organizing-switches.js?v=chat-v443-history-recovery',
  './digest-progress.js?v=chat-v443-history-recovery',
  './maintenance.js?v=chat-v443-history-recovery',
  './maintenance.css?v=chat-v443-history-recovery',
  './select-ui.js?v=chat-v443-history-recovery',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v443-history-recovery',
  './tokens.css?v=chat-v443-history-recovery',
  './style.css?v=chat-v443-history-recovery',
  './polish.css?v=chat-v443-history-recovery',
  './chat.css?v=chat-v443-history-recovery',
  './wechat.css?v=chat-v443-history-recovery',
  './visual-overrides.css?v=chat-v443-history-recovery',
  './shell.css?v=chat-v443-history-recovery',
  './daily-status.css?v=chat-v443-history-recovery',
  './settings.css?v=chat-v443-history-recovery',
  './components.css?v=chat-v443-history-recovery',
  './chat-ui.js?v=chat-v443-history-recovery',
  './chat-ui.css?v=chat-v443-history-recovery',
  './chat-page.css?v=chat-v443-history-recovery',
  './chat-addons.css?v=chat-v443-history-recovery',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v443-history-recovery',
  './script.js?v=chat-v443-history-recovery',
  './script-extra.js?v=chat-v443-history-recovery',
  './pwa.js?v=chat-v443-history-recovery',
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
