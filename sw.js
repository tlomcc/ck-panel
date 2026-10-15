const CACHE_NAME = 'ck-panel-shell-v346-chat-v332-codex-floating-strips';
const SHELL_ASSETS = [
  './codex-storage.js?v=chat-v332-codex-floating-strips',
  './codex-tasks.js?v=chat-v332-codex-floating-strips',
  './codex-tasks.css?v=chat-v332-codex-floating-strips',
  './records-settings.css?v=chat-v332-codex-floating-strips',
  './settings-tabs.js?v=chat-v332-codex-floating-strips',
  './daily-records.js?v=chat-v332-codex-floating-strips',
  './subscription.js?v=chat-v332-codex-floating-strips',
  './subscription.css?v=chat-v332-codex-floating-strips',
  './memory-review.js?v=chat-v332-codex-floating-strips',
  './server-status.js?v=chat-v332-codex-floating-strips',
  './server-status.css?v=chat-v332-codex-floating-strips',
  './backend-route.js?v=chat-v332-codex-floating-strips',
  './chat-recovery.js?v=chat-v332-codex-floating-strips',
  './chat-wake.js?v=chat-v332-codex-floating-strips',
  './chat-digest.js?v=chat-v332-codex-floating-strips',
  './chat-digest-activation.js?v=chat-v332-codex-floating-strips',
  './chat-window-cleanup.js?v=chat-v332-codex-floating-strips',
  './chat-digest-schedule.js?v=chat-v332-codex-floating-strips',
  './chat-delete-digest.js?v=chat-v332-codex-floating-strips',
  './memory-workbench.js?v=chat-v332-codex-floating-strips',
  './memory-workbench.css?v=chat-v332-codex-floating-strips',
  './memory-library.css?v=chat-v332-codex-floating-strips',
  './maintenance.js?v=chat-v332-codex-floating-strips',
  './maintenance.css?v=chat-v332-codex-floating-strips',
  './select-ui.js?v=chat-v332-codex-floating-strips',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v332-codex-floating-strips',
  './tokens.css?v=chat-v332-codex-floating-strips',
  './style.css?v=chat-v332-codex-floating-strips',
  './polish.css?v=chat-v332-codex-floating-strips',
  './chat.css?v=chat-v332-codex-floating-strips',
  './wechat.css?v=chat-v332-codex-floating-strips',
  './visual-overrides.css?v=chat-v332-codex-floating-strips',
  './shell.css?v=chat-v332-codex-floating-strips',
  './daily-status.css?v=chat-v332-codex-floating-strips',
  './settings.css?v=chat-v332-codex-floating-strips',
  './components.css?v=chat-v332-codex-floating-strips',
  './chat-ui.js?v=chat-v332-codex-floating-strips',
  './chat-ui.css?v=chat-v332-codex-floating-strips',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v332-codex-floating-strips',
  './script.js?v=chat-v332-codex-floating-strips',
  './script-extra.js?v=chat-v332-codex-floating-strips',
  './pwa.js?v=chat-v332-codex-floating-strips',
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
