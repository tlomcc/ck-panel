const CACHE_NAME = 'ck-panel-shell-v419-chat-v405-memory-every-100-rounds';
const SHELL_ASSETS = [
  './sortable-1.15.6.min.js?v=chat-v405-memory-every-100-rounds',
  './game-window.js?v=chat-v405-memory-every-100-rounds',
  './gomoku.js?v=chat-v405-memory-every-100-rounds',
  './games.js?v=chat-v405-memory-every-100-rounds',
  './games.css?v=chat-v405-memory-every-100-rounds',
  './token-usage.js?v=chat-v405-memory-every-100-rounds',
  './token-usage.css?v=chat-v405-memory-every-100-rounds',
  './codex-storage.js?v=chat-v405-memory-every-100-rounds',
  './codex-tasks.js?v=chat-v405-memory-every-100-rounds',
  './codex-tasks.css?v=chat-v405-memory-every-100-rounds',
  './records-settings.css?v=chat-v405-memory-every-100-rounds',
  './settings-tabs.js?v=chat-v405-memory-every-100-rounds',
  './daily-records.js?v=chat-v405-memory-every-100-rounds',
  './active-memory.js?v=chat-v405-memory-every-100-rounds',
  './subscription.js?v=chat-v405-memory-every-100-rounds',
  './subscription.css?v=chat-v405-memory-every-100-rounds',
  './server-status.js?v=chat-v405-memory-every-100-rounds',
  './server-status.css?v=chat-v405-memory-every-100-rounds',
  './backend-route.js?v=chat-v405-memory-every-100-rounds',
  './chat-recovery.js?v=chat-v405-memory-every-100-rounds',
  './chat-wake.js?v=chat-v405-memory-every-100-rounds',
  './chat-digest.js?v=chat-v405-memory-every-100-rounds',
  './chat-digest-activation.js?v=chat-v405-memory-every-100-rounds',
  './chat-window-cleanup.js?v=chat-v405-memory-every-100-rounds',
  './chat-digest-schedule.js?v=chat-v405-memory-every-100-rounds',
  './chat-delete-digest.js?v=chat-v405-memory-every-100-rounds',
  './memory-workbench.js?v=chat-v405-memory-every-100-rounds',
  './memory-workbench.css?v=chat-v405-memory-every-100-rounds',
  './event-memory.css?v=chat-v405-memory-every-100-rounds',
  './organizing-switches.js?v=chat-v405-memory-every-100-rounds',
  './digest-progress.js?v=chat-v405-memory-every-100-rounds',
  './maintenance.js?v=chat-v405-memory-every-100-rounds',
  './maintenance.css?v=chat-v405-memory-every-100-rounds',
  './select-ui.js?v=chat-v405-memory-every-100-rounds',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v405-memory-every-100-rounds',
  './tokens.css?v=chat-v405-memory-every-100-rounds',
  './style.css?v=chat-v405-memory-every-100-rounds',
  './polish.css?v=chat-v405-memory-every-100-rounds',
  './chat.css?v=chat-v405-memory-every-100-rounds',
  './wechat.css?v=chat-v405-memory-every-100-rounds',
  './visual-overrides.css?v=chat-v405-memory-every-100-rounds',
  './shell.css?v=chat-v405-memory-every-100-rounds',
  './daily-status.css?v=chat-v405-memory-every-100-rounds',
  './settings.css?v=chat-v405-memory-every-100-rounds',
  './components.css?v=chat-v405-memory-every-100-rounds',
  './chat-ui.js?v=chat-v405-memory-every-100-rounds',
  './chat-ui.css?v=chat-v405-memory-every-100-rounds',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v405-memory-every-100-rounds',
  './script.js?v=chat-v405-memory-every-100-rounds',
  './script-extra.js?v=chat-v405-memory-every-100-rounds',
  './pwa.js?v=chat-v405-memory-every-100-rounds',
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
