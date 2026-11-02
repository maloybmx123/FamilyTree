/* Семейное Древо — небольшая карта на тайлах OpenStreetMap, без внешних библиотек.
   Показывает места рождения, смерти и событий. */
(function (global) {
  'use strict';

  function MiniMap(host) {
    this.host = host;
    this.z = 4;
    this.cx = 55.75; this.cy = 37.62;     // широта/долгота центра
    this.pins = [];
    this.onPin = function () {};
    this._build();
  }
  var TILE = 256;

  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z) * TILE; }
  function lat2y(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * TILE;
  }
  function x2lon(x, z) { return x / (Math.pow(2, z) * TILE) * 360 - 180; }
  function y2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / (Math.pow(2, z) * TILE);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  MiniMap.prototype._build = function () {
    var self = this;
    this.host.innerHTML =
      '<div class="map-ctl">' +
      '<button class="btn btn-sm" data-z="1" type="button" title="Приблизить" aria-label="Приблизить">' +
      global.Icon('plus') + '</button>' +
      '<button class="btn btn-sm" data-z="-1" type="button" title="Отдалить" aria-label="Отдалить">' +
      global.Icon('minus') + '</button>' +
      '<button class="btn btn-sm" data-fit="1" type="button" title="Показать все" aria-label="Показать все">' +
      global.Icon('expand') + '</button>' +
      '</div><div class="map-attr">© OpenStreetMap</div>';
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0';
    this.host.insertBefore(this.layer, this.host.firstChild);

    this.onClick = null;      // выбор точки: fn(lat, lng)
    this.host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]');
      if (b) { self.z = Math.max(2, Math.min(17, self.z + (+b.dataset.z))); self.draw(); return; }
      if (e.target.closest('[data-fit]')) { self.fit(); return; }
      if (e.target.closest('.map-ctl') || e.target.closest('.map-pin')) return;
      if (!self.onClick || self._moved) return;
      var r = self.host.getBoundingClientRect();
      var W = r.width, H = r.height, z = self.z;
      var left = lon2x(self.cy, z) - W / 2, top = lat2y(self.cx, z) - H / 2;
      self.onClick(y2lat(top + (e.clientY - r.top), z), x2lon(left + (e.clientX - r.left), z));
    });
    var drag = null;
    this.host.addEventListener('dragstart', function (e) { e.preventDefault(); });
    this.host.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.map-ctl') || e.target.closest('.map-pin')) return;
      if (e.target.closest('.map-tools')) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, cx: self.cx, cy: self.cy };
      self._moved = false;
      self.host.setPointerCapture(e.pointerId);
      self.host.classList.add('grabbing');
    });
    this.host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) self._moved = true;
      var z = self.z;
      var px = lon2x(drag.cy, z) - (e.clientX - drag.x);
      var py = lat2y(drag.cx, z) - (e.clientY - drag.y);
      self.cy = x2lon(px, z); self.cx = y2lat(py, z);
      self.draw();
    });
    function end() { drag = null; self.host.classList.remove('grabbing'); }
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
    this.host.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.z = Math.max(2, Math.min(17, self.z + (e.deltaY < 0 ? 1 : -1)));
      self.draw();
    }, { passive: false });
  };

  MiniMap.prototype.setPins = function (pins) { this.pins = pins || []; this.draw(); };

  /** поставить центр и приближение */
  MiniMap.prototype.goTo = function (lat, lng, z) {
    this.cx = lat; this.cy = lng;
    if (z) this.z = Math.max(2, Math.min(18, z));
    this.draw();
  };

  MiniMap.prototype.fit = function () {
    if (!this.pins.length) return;
    var la = this.pins.map(function (p) { return p.lat; });
    var lo = this.pins.map(function (p) { return p.lng; });
    var minLa = Math.min.apply(null, la), maxLa = Math.max.apply(null, la);
    var minLo = Math.min.apply(null, lo), maxLo = Math.max.apply(null, lo);
    this.cx = (minLa + maxLa) / 2; this.cy = (minLo + maxLo) / 2;
    var r = this.host.getBoundingClientRect();
    var z = 17;
    while (z > 2) {
      var w = Math.abs(lon2x(maxLo, z) - lon2x(minLo, z));
      var h = Math.abs(lat2y(minLa, z) - lat2y(maxLa, z));
      if (w < r.width * 0.8 && h < r.height * 0.8) break;
      z--;
    }
    this.z = z;
    this.draw();
  };

  MiniMap.prototype.draw = function () {
    var self = this, r = this.host.getBoundingClientRect();
    var W = r.width || 600, H = r.height || 400, z = this.z;
    var px = lon2x(this.cy, z), py = lat2y(this.cx, z);
    var left = px - W / 2, top = py - H / 2;
    var x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    var x1 = Math.ceil((left + W) / TILE), y1 = Math.ceil((top + H) / TILE);
    var max = Math.pow(2, z);
    var html = '';
    for (var x = x0; x < x1; x++) {
      for (var y = y0; y < y1; y++) {
        if (y < 0 || y >= max) continue;
        var tx = ((x % max) + max) % max;
        html += '<img class="map-tile" alt="" loading="lazy" draggable="false" ' +
          'src="https://tile.openstreetmap.org/' + z + '/' + tx + '/' + y + '.png" ' +
          'style="left:' + (x * TILE - left) + 'px;top:' + (y * TILE - top) + 'px">';
      }
    }
    this.pins.forEach(function (p, i) {
      var ppx = lon2x(p.lng, z) - left, ppy = lat2y(p.lat, z) - top;
      if (ppx < -40 || ppy < -40 || ppx > W + 40 || ppy > H + 40) return;
      var cls = p.kind === 'birth' ? 'birth' : p.kind === 'death' ? 'death' : 'event';
      html += '<button type="button" class="map-pin ' + cls + '" data-i="' + i + '" title="' +
        esc((p.label || '') + (p.place ? ' · ' + p.place : '')) + '" style="left:' + ppx + 'px;top:' + ppy + 'px"></button>';
    });
    this.layer.innerHTML = html;
    this.layer.querySelectorAll('.map-pin').forEach(function (b) {
      b.addEventListener('click', function () { self.onPin(self.pins[+b.dataset.i]); });
    });
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.MiniMap = MiniMap;
})(window);
