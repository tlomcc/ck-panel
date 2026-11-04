const CACHE_NAME = 'ck-panel-shell-v386-chat-v372-token-usage';
const SHELL_ASSETS = [
  './token-usage.js?v=chat-v372-token-usage',
  './token-usage.css?v=chat-v372-token-usage',
  './codex-storage.js?v=chat-v372-token-usage',
  './codex-tasks.js?v=chat-v372-token-usage',
  './codex-tasks.css?v=chat-v372-token-usage',
  './records-settings.css?v=chat-v372-token-usage',
  './settings-tabs.js?v=chat-v372-token-usage',
  './daily-records.js?v=chat-v372-token-usage',
  './active-memory.js?v=chat-v372-token-usage',
  './subscription.js?v=chat-v372-token-usage',
  './subscription.css?v=chat-v372-token-usage',
  './memory-review.js?v=chat-v372-token-usage',
  './server-status.js?v=chat-v372-token-usage',
  './server-status.css?v=chat-v372-token-usage',
  './backend-route.js?v=chat-v372-token-usage',
  './chat-recovery.js?v=chat-v372-token-usage',
  './chat-wake.js?v=chat-v372-token-usage',
  './chat-digest.js?v=chat-v372-token-usage',
  './chat-digest-activation.js?v=chat-v372-token-usage',
  './chat-window-cleanup.js?v=chat-v372-token-usage',
  './chat-digest-schedule.js?v=chat-v372-token-usage',
  './chat-delete-digest.js?v=chat-v372-token-usage',
  './memory-workbench.js?v=chat-v372-token-usage',
  './memory-workbench.css?v=chat-v372-token-usage',
  './memory-library.css?v=chat-v372-token-usage',
  './organizing-switches.js?v=chat-v372-token-usage',
  './digest-progress.js?v=chat-v372-token-usage',
  './maintenance.js?v=chat-v372-token-usage',
  './maintenance.css?v=chat-v372-token-usage',
  './select-ui.js?v=chat-v372-token-usage',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v372-token-usage',
  './tokens.css?v=chat-v372-token-usage',
  './style.css?v=chat-v372-token-usage',
  './polish.css?v=chat-v372-token-usage',
  './chat.css?v=chat-v372-token-usage',
  './wechat.css?v=chat-v372-token-usage',
  './visual-overrides.css?v=chat-v372-token-usage',
  './shell.css?v=chat-v372-token-usage',
  './daily-status.css?v=chat-v372-token-usage',
  './settings.css?v=chat-v372-token-usage',
  './components.css?v=chat-v372-token-usage',
  './chat-ui.js?v=chat-v372-token-usage',
  './chat-ui.css?v=chat-v372-token-usage',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v372-token-usage',
  './script.js?v=chat-v372-token-usage',
  './script-extra.js?v=chat-v372-token-usage',
  './pwa.js?v=chat-v372-token-usage',
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
