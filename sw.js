/* Семейное Древо — офлайн-кэш. Программа работает без интернета;
   в сеть ходят только тайлы карты и шрифты. */
var CACHE = 'drevo-v1';
var SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/store.js', './js/tree.js', './js/io.js', './js/sync.js', './js/map.js',
  './js/person.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // тайлы карты и шрифты — из сети, с запасом из кэша
  if (url.hostname.indexOf('tile.openstreetmap.org') >= 0 || url.hostname.indexOf('fonts.') >= 0) {
    e.respondWith(
      caches.open(CACHE + '-net').then(function (c) {
        return fetch(e.request).then(function (r) {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        }).catch(function () { return c.match(e.request); });
      })
    );
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) {
        if (r.ok) caches.open(CACHE).then(function (c) { c.put(e.request, r.clone()); });
        return r;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
