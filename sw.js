const CACHE_NAME = 'ck-panel-shell-v378-chat-v364-active-memory-status';
const SHELL_ASSETS = [
  './codex-storage.js?v=chat-v364-active-memory-status',
  './codex-tasks.js?v=chat-v364-active-memory-status',
  './codex-tasks.css?v=chat-v364-active-memory-status',
  './records-settings.css?v=chat-v364-active-memory-status',
  './settings-tabs.js?v=chat-v364-active-memory-status',
  './daily-records.js?v=chat-v364-active-memory-status',
  './active-memory.js?v=chat-v364-active-memory-status',
  './subscription.js?v=chat-v364-active-memory-status',
  './subscription.css?v=chat-v364-active-memory-status',
  './memory-review.js?v=chat-v364-active-memory-status',
  './server-status.js?v=chat-v364-active-memory-status',
  './server-status.css?v=chat-v364-active-memory-status',
  './backend-route.js?v=chat-v364-active-memory-status',
  './chat-recovery.js?v=chat-v364-active-memory-status',
  './chat-wake.js?v=chat-v364-active-memory-status',
  './chat-digest.js?v=chat-v364-active-memory-status',
  './chat-digest-activation.js?v=chat-v364-active-memory-status',
  './chat-window-cleanup.js?v=chat-v364-active-memory-status',
  './chat-digest-schedule.js?v=chat-v364-active-memory-status',
  './chat-delete-digest.js?v=chat-v364-active-memory-status',
  './memory-workbench.js?v=chat-v364-active-memory-status',
  './memory-workbench.css?v=chat-v364-active-memory-status',
  './memory-library.css?v=chat-v364-active-memory-status',
  './organizing-switches.js?v=chat-v364-active-memory-status',
  './maintenance.js?v=chat-v364-active-memory-status',
  './maintenance.css?v=chat-v364-active-memory-status',
  './select-ui.js?v=chat-v364-active-memory-status',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v364-active-memory-status',
  './tokens.css?v=chat-v364-active-memory-status',
  './style.css?v=chat-v364-active-memory-status',
  './polish.css?v=chat-v364-active-memory-status',
  './chat.css?v=chat-v364-active-memory-status',
  './wechat.css?v=chat-v364-active-memory-status',
  './visual-overrides.css?v=chat-v364-active-memory-status',
  './shell.css?v=chat-v364-active-memory-status',
  './daily-status.css?v=chat-v364-active-memory-status',
  './settings.css?v=chat-v364-active-memory-status',
  './components.css?v=chat-v364-active-memory-status',
  './chat-ui.js?v=chat-v364-active-memory-status',
  './chat-ui.css?v=chat-v364-active-memory-status',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v364-active-memory-status',
  './script.js?v=chat-v364-active-memory-status',
  './script-extra.js?v=chat-v364-active-memory-status',
  './pwa.js?v=chat-v364-active-memory-status',
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
