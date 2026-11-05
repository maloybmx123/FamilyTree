/* Семейное Древо — офлайн-кэш. Программа работает без интернета;
   в сеть ходят только тайлы карты и шрифты.

   Важное про обновления. Раньше кэш назывался drevo-v1 и отдавался первым:
   один раз открыв сайт, устройство навсегда оставалось на той сборке,
   даже после загрузки новой на сервер. Теперь наоборот — сначала сеть,
   кэш только запасной вариант. И имя кэша привязано к номеру сборки,
   поэтому старые файлы вычищаются сами. */
var BUILD = '20';
var CACHE = 'drevo-' + BUILD;
var NET = CACHE + '-net';
var SHELL = [
  './', './index.html', './manifest.webmanifest',
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
    return Promise.all(keys.map(function (k) {
      return (k === CACHE || k === NET) ? null : caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

/* Если страница просит — обновиться немедленно, не дожидаясь закрытия вкладок. */
self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

/** Сеть с ограничением по времени: на плохой связи не ждём дольше, чем нужно.
    cache:'no-cache' обязателен: без него запрос забирает обычный кэш браузера,
    до сервера он не доходит, и новая сборка на устройство не попадает.
    Это не «качать всё заново»: сервер отвечает «не изменилось», и файл берётся
    с диска — свежесть есть, трафика нет. */
function netFirst(req, ms) {
  return new Promise(function (resolve) {
    var done = false, timer = setTimeout(function () {
      if (!done) { done = true; caches.match(req).then(function (hit) { resolve(hit || fetch(req)); }); }
    }, ms);
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
      if (done) { if (r && r.ok) caches.open(CACHE).then(function (c) { c.put(req, r.clone()); }); return; }
      done = true; clearTimeout(timer);
      if (r && r.ok) caches.open(CACHE).then(function (c) { c.put(req, r.clone()); });
      resolve(r);
    }).catch(function () {
      if (done) return;
      done = true; clearTimeout(timer);
      caches.match(req).then(function (hit) {
        resolve(hit || caches.match('./index.html').then(function (h) {
          return h || new Response('Нет сети', { status: 503 });
        }));
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // тайлы карты и шрифты — из сети, с запасом из кэша
  if (url.hostname.indexOf('tile.openstreetmap.org') >= 0 || url.hostname.indexOf('fonts.') >= 0) {
    e.respondWith(
      caches.open(NET).then(function (c) {
        return fetch(e.request).then(function (r) {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        }).catch(function () { return c.match(e.request); });
      })
    );
    return;
  }
  if (url.origin !== location.origin) return;
  // сама программа — всегда свежая, если сеть есть
  e.respondWith(netFirst(e.request, 4000));
});
