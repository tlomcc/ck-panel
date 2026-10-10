const CACHE_NAME = 'ck-panel-shell-v316-chat-v302-background-records';
const SHELL_ASSETS = [
  './records-settings.css?v=chat-v302-background-records',
  './settings-tabs.js?v=chat-v302-background-records',
  './daily-records.js?v=chat-v302-background-records',
  './subscription.js?v=chat-v302-background-records',
  './subscription.css?v=chat-v302-background-records',
  './memory-review.js?v=chat-v302-background-records',
  './server-status.js?v=chat-v302-background-records',
  './server-status.css?v=chat-v302-background-records',
  './backend-route.js?v=chat-v302-background-records',
  './chat-recovery.js?v=chat-v302-background-records',
  './chat-wake.js?v=chat-v302-background-records',
  './chat-digest.js?v=chat-v302-background-records',
  './chat-digest-activation.js?v=chat-v302-background-records',
  './chat-digest-schedule.js?v=chat-v302-background-records',
  './memory-workbench.js?v=chat-v302-background-records',
  './memory-workbench.css?v=chat-v302-background-records',
  './memory-library.css?v=chat-v302-background-records',
  './maintenance.js?v=chat-v302-background-records',
  './maintenance.css?v=chat-v302-background-records',
  './select-ui.js?v=chat-v302-background-records',
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v302-background-records',
  './tokens.css?v=chat-v302-background-records',
  './style.css?v=chat-v302-background-records',
  './polish.css?v=chat-v302-background-records',
  './chat.css?v=chat-v302-background-records',
  './wechat.css?v=chat-v302-background-records',
  './visual-overrides.css?v=chat-v302-background-records',
  './shell.css?v=chat-v302-background-records',
  './daily-status.css?v=chat-v302-background-records',
  './settings.css?v=chat-v302-background-records',
  './components.css?v=chat-v302-background-records',
  './chat-ui.js?v=chat-v302-background-records',
  './chat-ui.css?v=chat-v302-background-records',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v302-background-records',
  './script.js?v=chat-v302-background-records',
  './script-extra.js?v=chat-v302-background-records',
  './pwa.js?v=chat-v302-background-records',
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
