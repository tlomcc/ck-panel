const CACHE_NAME = 'ck-panel-shell-v257-chat-v243-notebook-and-cache-colors';
const SHELL_ASSETS = [
  './',
  './index.html',
  './version.json',
  './notebook.css?v=chat-v243-notebook-and-cache-colors',
  './tokens.css?v=chat-v243-notebook-and-cache-colors',
  './style.css?v=chat-v243-notebook-and-cache-colors',
  './polish.css?v=chat-v243-notebook-and-cache-colors',
  './chat.css?v=chat-v243-notebook-and-cache-colors',
  './wechat.css?v=chat-v243-notebook-and-cache-colors',
  './visual-overrides.css?v=chat-v243-notebook-and-cache-colors',
  './shell.css?v=chat-v243-notebook-and-cache-colors',
  './daily-status.css?v=chat-v243-notebook-and-cache-colors',
  './settings.css?v=chat-v243-notebook-and-cache-colors',
  './components.css?v=chat-v243-notebook-and-cache-colors',
  './chat-ui.js?v=chat-v243-notebook-and-cache-colors',
  './chat-ui.css?v=chat-v243-notebook-and-cache-colors',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v243-notebook-and-cache-colors',
  './script.js?v=chat-v243-notebook-and-cache-colors',
  './script-extra.js?v=chat-v243-notebook-and-cache-colors',
  './pwa.js?v=chat-v243-notebook-and-cache-colors',
  './manifest.webmanifest',
  './icons/app-icon-v4-192.png',
  './icons/app-icon-v4-maskable-192.png',
  './icons/app-icon-v4-512.png',
  './icons/app-icon-v4-maskable-512.png',
  './icons/apple-touch-icon-v4.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE_NAME) return caches.delete(key);
        return null;
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  var isVersionCheck = url.pathname.endsWith('/version.json') ||
    url.searchParams.has('__ck_version_check') ||
    url.searchParams.has('__ck_sw_version_check') ||
    url.searchParams.has('ck_reload');

  if (isVersionCheck) {
    event.respondWith(
      fetch(request, { cache: 'reload' }).then(function(response) {
        if (!response || response.status !== 200) return response;
        if (url.pathname.endsWith('/version.json')) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put('./version.json', copy);
          });
        }
        return response;
      }).catch(function() {
        if (url.pathname.endsWith('/version.json')) return caches.match('./version.json');
        return Response.error();
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'reload' }).then(function(response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put('./index.html', copy);
        });
        return response;
      }).catch(function() {
        return caches.match('./index.html');
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).then(function(response) {
      if (!response || response.status !== 200) return response;
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, copy);
      });
      return response;
    }).catch(function() {
      return caches.match(request).then(function(cached) {
        if (cached) return cached;
        return Response.error();
      });
    })
  );
});
