const CACHE_NAME = 'ck-panel-shell-v256-chat-v242-search-and-smooth-chat';
const SHELL_ASSETS = [
  './',
  './index.html',
  './version.json',
  './tokens.css?v=chat-v242-search-and-smooth-chat',
  './style.css?v=chat-v242-search-and-smooth-chat',
  './polish.css?v=chat-v242-search-and-smooth-chat',
  './chat.css?v=chat-v242-search-and-smooth-chat',
  './wechat.css?v=chat-v242-search-and-smooth-chat',
  './visual-overrides.css?v=chat-v242-search-and-smooth-chat',
  './shell.css?v=chat-v242-search-and-smooth-chat',
  './daily-status.css?v=chat-v242-search-and-smooth-chat',
  './settings.css?v=chat-v242-search-and-smooth-chat',
  './components.css?v=chat-v242-search-and-smooth-chat',
  './chat-ui.js?v=chat-v242-search-and-smooth-chat',
  './chat-ui.css?v=chat-v242-search-and-smooth-chat',
  './icons/app-icon-v4.svg',
  './chat-history.js?v=chat-v242-search-and-smooth-chat',
  './script.js?v=chat-v242-search-and-smooth-chat',
  './script-extra.js?v=chat-v242-search-and-smooth-chat',
  './pwa.js?v=chat-v242-search-and-smooth-chat',
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
