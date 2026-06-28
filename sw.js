const CACHE_NAME = 'ck-panel-shell-v29-chat-v9';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=chat-v9',
  './polish.css?v=chat-v9',
  './script.js?v=chat-v9',
  './script-extra.js?v=chat-v9',
  './pwa.js?v=chat-v9',
  './manifest.webmanifest',
  './icons/app-icon-v2-192.png',
  './icons/app-icon-v2-maskable-192.png',
  './icons/app-icon-v2-512.png',
  './icons/app-icon-v2-maskable-512.png',
  './icons/apple-touch-icon-v2.png'
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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function(response) {
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
