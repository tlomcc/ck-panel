const CACHE_NAME = 'ck-panel-shell-v402-chat-v388-quota-last-known';
const SHELL_ASSETS = [
  './game-window.js?v=chat-v388-quota-last-known',
  './gomoku.js?v=chat-v388-quota-last-known',
  './games.js?v=chat-v388-quota-last-known',
  './games.css?v=chat-v388-quota-last-known',
  './token-usage.js?v=chat-v388-quota-last-known',
  './token-usage.css?v=chat-v388-quota-last-known',
  './codex-storage.js?v=chat-v388-quota-last-known',
  './codex-tasks.js?v=chat-v388-quota-last-known',
  './codex-tasks.css?v=chat-v388-quota-last-known',
  './records-settings.css?v=chat-v388-quota-last-known',
  './settings-tabs.js?v=chat-v388-quota-last-known',
  './daily-records.js?v=chat-v388-quota-last-known',
  './active-memory.js?v=chat-v388-quota-last-known',
  './subscription.js?v=chat-v388-quota-last-known',
  './subscription.css?v=chat-v388-quota-last-known',
  './memory-review.js?v=chat-v388-quota-last-known',
  './server-status.js?v=chat-v388-quota-last-known',
  './server-status.css?v=chat-v388-quota-last-known',
  './backend-route.js?v=chat-v388-quota-last-known',
  './chat-recovery.js?v=chat-v388-quota-last-known',
  './chat-wake.js?v=chat-v388-quota-last-known',
  './chat-digest.js?v=chat-v388-quota-last-known',
  './chat-digest-activation.js?v=chat-v388-quota-last-known',
  './chat-window-cleanup.js?v=chat-v388-quota-last-known',
  './chat-digest-schedule.js?v=chat-v388-quota-last-known',
  './chat-delete-digest.js?v=chat-v388-quota-last-known',
  './memory-workbench.js?v=chat-v388-quota-last-known',
  './memory-workbench.css?v=chat-v388-quota-last-known',
  './memory-library.css?v=chat-v388-quota-last-known',
  './organizing-switches.js?v=chat-v388-quota-last-known',
  './digest-progress.js?v=chat-v388-quota-last-known',
  './maintenance.js?v=chat-v388-quota-last-known',
  './maintenance.css?v=chat-v388-quota-last-known',
  './select-ui.js?v=chat-v388-quota-last-known',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v388-quota-last-known',
  './tokens.css?v=chat-v388-quota-last-known',
  './style.css?v=chat-v388-quota-last-known',
  './polish.css?v=chat-v388-quota-last-known',
  './chat.css?v=chat-v388-quota-last-known',
  './wechat.css?v=chat-v388-quota-last-known',
  './visual-overrides.css?v=chat-v388-quota-last-known',
  './shell.css?v=chat-v388-quota-last-known',
  './daily-status.css?v=chat-v388-quota-last-known',
  './settings.css?v=chat-v388-quota-last-known',
  './components.css?v=chat-v388-quota-last-known',
  './chat-ui.js?v=chat-v388-quota-last-known',
  './chat-ui.css?v=chat-v388-quota-last-known',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v388-quota-last-known',
  './script.js?v=chat-v388-quota-last-known',
  './script-extra.js?v=chat-v388-quota-last-known',
  './pwa.js?v=chat-v388-quota-last-known',
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
