/* Семейное Древо — раскладка и отрисовка дерева.
   Три вида: вертикальный, горизонтальный, «бабочка».
   Расчёт идёт в абстрактных координатах (поколение × позиция),
   затем переводится в пиксели по выбранному виду. */
(function (global) {
  'use strict';

  var S = global.Store;

  function Tree(opts) {
    this.host = opts.host;                 // контейнер со скроллом
    this.canvas = opts.canvas;             // слой с карточками
    this.svg = opts.svg;                   // слой с линиями
    this.focusId = null;
    this.mode = 'vertical';
    this.up = 3;                           // поколений вверх
    this.down = 3;                         // поколений вниз
    this.scale = 1;
    this.tx = 0; this.ty = 0;
    this.onSelect = opts.onSelect || function () {};
    this.onAdd = opts.onAdd || function () {};
    this.onRender = opts.onRender || function () {};
    this.openId = null;        // чья карточка сейчас раскрыта сбоку
    this.cards = [];
    this.links = [];
    this._bindPanZoom();
  }

  Tree.prototype.setFocus = function (id) { this.focusId = id; this.render(true); };
  /** пометить эскиз, карточка которого открыта; null — снять пометку */
  Tree.prototype.setOpen = function (id) {
    if (this.openId === id) return;
    this.openId = id;
    var self = this;
    this.canvas.querySelectorAll('.node').forEach(function (n) {
      n.classList.toggle('is-open', n.dataset.id === self.openId);
    });
  };
  Tree.prototype.setMode = function (m) { this.mode = m; this.render(true); };

  /* ---------------- раскладка ---------------- */
  Tree.prototype.compute = function () {
    var self = this, prefs = S.prefs;
    var CW = prefs.card.w, CH = prefs.card.h;
    var mode = this.mode;

    // шаг вдоль оси «братья-сёстры» и шаг между поколениями
    var SLOT, LEVEL;
    if (mode === 'horizontal') { SLOT = CH + 22; LEVEL = CW + 110; }
    else { SLOT = CW + 26; LEVEL = CH + 78; }
    var MATE = (mode === 'horizontal') ? CH + 10 : CW + 12;  // шаг внутри пары супругов

    var cards = [], links = [];
    var focus = S.person(this.focusId);
    if (!focus) return { cards: [], links: [], w: 0, h: 0 };

    var placed = {};           // personId -> card
    var cursor = { v: 0 };

    function unitOf(personId) {
      var u = [personId];
      S.spousesOf(personId).forEach(function (sp) {
        if (u.indexOf(sp.id) < 0 && !placed[sp.id]) u.push(sp.id);
      });
      return u;
    }
    function unitSize(u) { return u.length * MATE - (MATE - SLOT); }

    function addCard(personId, gen, pos, role) {
      var p = S.person(personId);
      if (!p) return null;
      var c = { id: personId, person: p, gen: gen, pos: pos, role: role || 'blood' };
      cards.push(c); placed[personId] = c;
      return c;
    }

    /* потомки: раскладываем пару и её детей */
    function descend(unit, gen, depth) {
      unit.forEach(function (pid) { placed[pid] = 'res'; });   // занимаем места, чтобы супруга не забрали дважды
      var start = cards.length;
      var uw = unitSize(unit);

      var kids = [];
      if (depth > 0) {
        var seen = {};
        unit.forEach(function (pid) {
          S.childrenOf(pid).forEach(function (ch) {
            if (!seen[ch.id] && !placed[ch.id]) { seen[ch.id] = 1; kids.push(ch.id); }
          });
        });
      }

      var centers = [];
      kids.forEach(function (kid) {
        if (placed[kid]) return;
        centers.push(descend(unitOf(kid), gen + 1, depth - 1));
      });

      var center;
      if (!centers.length) {
        center = cursor.v + uw / 2;
        cursor.v += uw + SLOT * 0.2;
      } else {
        var span = centers[centers.length - 1] - centers[0];
        center = centers[0] + span / 2;
        if (uw > span + SLOT) {                                 // пара шире, чем её дети
          var delta = (uw - span - SLOT) / 2;
          for (var i = start; i < cards.length; i++) cards[i].pos += delta;
          center += delta;
          cursor.v += delta;
        }
      }

      var left = center - uw / 2;
      unit.forEach(function (pid, i) {
        addCard(pid, gen, left + i * MATE, i === 0 ? 'blood' : 'spouse');
      });
      if (unit.length > 1) links.push({ kind: 'couple', a: unit[0], b: unit[1] });
      kids.forEach(function (kid) {
        if (placed[kid] && placed[kid] !== 'res') links.push({ kind: 'parent', from: unit, to: kid });
      });
      return center;
    }

    /* предки: пирамида над человеком */
    function ancWidth(pid, depth) {
      if (!pid || depth <= 0) return SLOT;
      var par = S.parentsOf(pid);
      if (!par.length) return SLOT;
      var w = 0;
      par.forEach(function (p) { w += ancWidth(p.id, depth - 1); });
      return Math.max(SLOT, w);
    }
    function ascend(pid, centerPos, gen, depth, wing) {
      if (depth <= 0) return;
      var par = S.parentsOf(pid);
      if (!par.length) return;
      var widths = par.map(function (p) { return ancWidth(p.id, depth - 1); });
      var total = widths.reduce(function (a, b) { return a + b; }, 0);
      var x = centerPos - total / 2;
      par.forEach(function (p, i) {
        var c = x + widths[i] / 2;
        x += widths[i];
        if (placed[p.id]) return;
        var w2 = wing;
        if (w2 === 0) w2 = (p.sex === 'F' ? 1 : -1);
        var bias = (mode === 'butterfly') ? w2 * SLOT * 0.9 * (self.up - depth + 1) : 0;
        addCard(p.id, gen, c - SLOT / 2 + bias, 'blood');
        ascend(p.id, c + bias, gen - 1, depth - 1, w2);
      });
      var both = par.length === 2 && placed[par[0].id] && placed[par[1].id];
      if (both) {
        // от пары к ребёнку идёт одна линия — из середины связки супругов
        links.push({ kind: 'couple', a: par[0].id, b: par[1].id });
        links.push({ kind: 'parent', from: [par[0].id, par[1].id], to: pid });
      } else {
        par.forEach(function (p) {
          if (placed[p.id]) links.push({ kind: 'parent', from: [p.id], to: pid });
        });
      }
    }

    /* старт: опора — родительская пара фокуса (тогда видны братья и сёстры) */
    var pivotFam = S.childFamily(focus.id);
    var rootUnit;
    if (pivotFam && (pivotFam.husb || pivotFam.wife)) {
      rootUnit = [pivotFam.husb, pivotFam.wife].filter(Boolean);
      descend(rootUnit, -1, this.down + 1);
    } else {
      rootUnit = unitOf(focus.id);
      descend(rootUnit, 0, this.down);
    }

    // предки над каждым членом опорной пары
    rootUnit.forEach(function (pid) {
      var c = placed[pid];
      if (!c) return;
      ascend(pid, c.pos + SLOT / 2, c.gen - 1, self.up, 0);
    });

    // развести предков, которые наехали друг на друга
    var byGen = {};
    cards.forEach(function (c) { (byGen[c.gen] = byGen[c.gen] || []).push(c); });
    Object.keys(byGen).forEach(function (g) {
      if (+g >= 0) return;
      var row = byGen[g].sort(function (a, b) { return a.pos - b.pos; });
      for (var i = 1; i < row.length; i++) {
        var need = row[i - 1].pos + SLOT * 0.96;
        if (row[i].pos < need) row[i].pos = need;
      }
    });

    /* перевод в пиксели */
    var minPos = Infinity, maxPos = -Infinity, minGen = Infinity, maxGen = -Infinity;
    cards.forEach(function (c) {
      minPos = Math.min(minPos, c.pos); maxPos = Math.max(maxPos, c.pos);
      minGen = Math.min(minGen, c.gen); maxGen = Math.max(maxGen, c.gen);
    });
    var PAD = 60;
    cards.forEach(function (c) {
      var p = c.pos - minPos, g = c.gen - minGen;
      if (mode === 'horizontal') { c.x = PAD + g * LEVEL; c.y = PAD + p; }
      else { c.x = PAD + p; c.y = PAD + g * LEVEL; }
      c.w = CW; c.h = CH;
    });

    var w = PAD * 2 + (mode === 'horizontal' ? (maxGen - minGen) * LEVEL + CW : (maxPos - minPos) + CW);
    var h = PAD * 2 + (mode === 'horizontal' ? (maxPos - minPos) + CH : (maxGen - minGen) * LEVEL + CH);

    return { cards: cards, links: links, w: w, h: h, map: placed };
  };

  /* ---------------- отрисовка ---------------- */
  Tree.prototype.render = function (recenter) {
    var self = this;
    this.host.classList.toggle('grid', !!(S.prefs && S.prefs.treeGrid));
    if (!S.persons().length) {
      this.canvas.innerHTML = '';
      this.svg.innerHTML = '';
      this.cards = []; this.links = [];
      this.onRender(this);
      return;
    }
    if (!this.focusId || !S.person(this.focusId)) {
      this.focusId = S.tree.meta.rootId && S.person(S.tree.meta.rootId)
        ? S.tree.meta.rootId : Object.keys(S.tree.persons)[0];
    }
    var res = this.compute();
    this.cards = res.cards; this.links = res.links;
    var prefs = S.prefs;

    this.canvas.style.width = res.w + 'px';
    this.canvas.style.height = res.h + 'px';
    this.svg.setAttribute('width', res.w);
    this.svg.setAttribute('height', res.h);
    this.svg.setAttribute('viewBox', '0 0 ' + res.w + ' ' + res.h);

    /* Линии. Главное правило: каждый конец упирается в край эскиза, а не
       повисает в воздухе. Линия от пары детей выходит из середины связки
       супругов — то есть с отрезка, который уже нарисован между ними. */
    var paths = [], map = res.map;
    var horiz = this.mode === 'horizontal';
    var OVER = 1;                      // заход под рамку, чтобы не было волоска зазора

    function coupleLine(a, b) {
      return horiz
        ? { x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y }
        : { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
    }

    res.links.forEach(function (L) {
      if (L.kind === 'couple') {
        var a = map[L.a], b = map[L.b];
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return;
        var ln = coupleLine(a, b);
        paths.push({
          d: 'M' + (ln.x1 - OVER * (horiz ? 0 : 1)) + ',' + (ln.y1 - OVER * (horiz ? 1 : 0)) +
            ' L' + (ln.x2 + OVER * (horiz ? 0 : 1)) + ',' + (ln.y2 + OVER * (horiz ? 1 : 0)),
          cls: 'lnk-couple'
        });
        return;
      }
      if (L.kind !== 'parent') return;

      var kid = map[L.to];
      if (!kid || typeof kid !== 'object') return;
      var ps = L.from.map(function (id) { return map[id]; })
        .filter(function (c) { return c && typeof c === 'object'; });
      if (!ps.length) return;

      // точка выхода: середина связки супругов либо край одиночного эскиза
      var ox, oy;
      if (ps.length === 2) {
        var ln2 = coupleLine(ps[0], ps[1]);
        ox = (ln2.x1 + ln2.x2) / 2;
        oy = (ln2.y1 + ln2.y2) / 2;
      } else if (horiz) {
        ox = ps[0].x + ps[0].w - OVER; oy = ps[0].y + ps[0].h / 2;
      } else {
        ox = ps[0].x + ps[0].w / 2; oy = ps[0].y + ps[0].h - OVER;
      }

      if (horiz) {
        var tx = kid.x + OVER, ty = kid.y + kid.h / 2;
        var mx = Math.max(ox + 12, (ox + tx) / 2);
        paths.push({ d: 'M' + ox + ',' + oy + ' H' + mx + ' V' + ty + ' H' + tx, cls: 'lnk-parent' });
      } else {
        var tx2 = kid.x + kid.w / 2, ty2 = kid.y + OVER;
        var my = Math.max(oy + 12, (oy + ty2) / 2);
        paths.push({ d: 'M' + ox + ',' + oy + ' V' + my + ' H' + tx2 + ' V' + ty2, cls: 'lnk-parent' });
      }
    });
    this.svg.innerHTML = paths.map(function (p) {
      return '<path d="' + p.d + '" class="' + p.cls + '"/>';
    }).join('');

    // карточки
    var frag = document.createDocumentFragment();
    res.cards.forEach(function (c) { frag.appendChild(self.cardEl(c)); });
    this.canvas.innerHTML = '';
    this.canvas.appendChild(frag);

    this.applyTransform();
    if (recenter) this.centerOn(this.focusId);
    this.onRender(this);
  };

  /** человека нет в живых: есть дата смерти или снята отметка «жив» */
  function isGone(p) {
    return !!(p && ((p.death && p.death.date) || p.living === false));
  }

  Tree.prototype.cardEl = function (c) {
    var self = this, p = c.person, prefs = S.prefs;
    var el = document.createElement('div');
    var radius = prefs.card.shape === 'circle' ? Math.round(c.h / 2) : prefs.card.radius;
    el.className = 'node sex-' + (p.sex || 'U').toLowerCase() +
      (p.id === this.openId ? ' is-open' : '') +
      (isGone(p) ? ' is-gone' : '');
    el.style.left = c.x + 'px';
    el.style.top = c.y + 'px';
    el.style.width = c.w + 'px';
    el.style.height = c.h + 'px';
    el.style.borderRadius = radius + 'px';
    el.dataset.id = p.id;

    var html = '';
    if (prefs.showPhotos && prefs.card.photo > 0) {
      var silhouette = p.sex === 'M' ? 'personM' : p.sex === 'F' ? 'personF' : 'person';
      html += '<div class="node-ph" style="width:' + prefs.card.photo + 'px;height:' + prefs.card.photo +
        'px;border-radius:' + (prefs.card.shape === 'circle' ? '50%' : Math.max(2, prefs.card.radius - 4) + 'px') +
        '">' + global.Icon(silhouette) + '</div>';
    }
    html += '<div class="node-txt"><div class="node-name" style="font-size:' + prefs.card.nameSize + 'px">' +
      esc(S.shortName(p)) + '</div>';
    if (prefs.showDates) {
      html += '<div class="node-years" style="font-size:' + prefs.card.dateSize +
        'px;font-weight:' + (prefs.card.dateWeight || 400) + '">' + esc(S.years(p)) + '</div>';
    }
    html += '</div>';
    if (isGone(p)) {
      // траурная полоса на верхнем левом углу
      html += '<span class="node-mourn" aria-hidden="true" style="border-top-left-radius:' + radius + 'px"></span>';
    }
    if (p.acl && (p.acl.locked || p.acl.level !== 'public')) {
      html += '<span class="node-lock" title="Ограниченный доступ">' + global.Icon('lock') + '</span>';
    }
    el.innerHTML = html;

    // кнопка «добавить родственника»
    var plus = document.createElement('button');
    plus.className = 'node-plus';
    plus.type = 'button';
    plus.innerHTML = global.Icon('plus');
    plus.title = 'Добавить родственника к ' + S.callName(p);
    plus.setAttribute('aria-label', plus.title);
    plus.addEventListener('click', function (e) { e.stopPropagation(); self.onAdd(p.id, plus); });
    el.appendChild(plus);

    el.addEventListener('click', function () { self.onSelect(p.id); });
    el.addEventListener('dblclick', function () { self.setFocus(p.id); });

    if (prefs.showPhotos && p.photo) {
      S.mediaURL(p.photo).then(function (url) {
        var ph = el.querySelector('.node-ph');
        if (url && ph) {
          ph.style.backgroundImage = 'url(' + url + ')';
          ph.classList.add('has-img');
          ph.innerHTML = '';
        }
      });
    }
    return el;
  };

  /* ---------------- масштаб и перетаскивание ---------------- */
  Tree.prototype.applyTransform = function () {
    var t = 'translate(' + this.tx + 'px,' + this.ty + 'px) scale(' + this.scale + ')';
    this.canvas.style.transform = t;
    this.svg.style.transform = t;
  };
  Tree.prototype.zoom = function (factor, cx, cy) {
    var rect = this.host.getBoundingClientRect();
    cx = cx == null ? rect.width / 2 : cx;
    cy = cy == null ? rect.height / 2 : cy;
    var ns = Math.min(2.5, Math.max(0.2, this.scale * factor));
    var k = ns / this.scale;
    this.tx = cx - k * (cx - this.tx);
    this.ty = cy - k * (cy - this.ty);
    this.scale = ns;
    this.applyTransform();
  };
  /* keepReadable: если всё дерево пришлось бы ужать до нечитаемого размера,
     показываем ближний круг выбранного человека — родителей, супругов, детей */
  Tree.prototype.fit = function (keepReadable) {
    var rect = this.host.getBoundingClientRect();
    var w = parseFloat(this.canvas.style.width) || 1, h = parseFloat(this.canvas.style.height) || 1;
    var s = Math.min(rect.width / w, rect.height / h, 1) * 0.96;
    if (keepReadable && s < 0.45) { this.fitCircle(); return; }
    this.scale = Math.max(0.2, s);
    this.tx = (rect.width - w * this.scale) / 2;
    this.ty = (rect.height - h * this.scale) / 2;
    this.applyTransform();
  };

  /** вписать ближний круг выбранного человека */
  Tree.prototype.fitCircle = function () {
    var S2 = global.Store, id = this.focusId;
    var want = {};
    want[id] = 1;
    [S2.parentsOf(id), S2.spousesOf(id), S2.childrenOf(id), S2.siblingsOf(id)].forEach(function (arr) {
      arr.forEach(function (p) { want[p.id] = 1; });
    });
    var box = null;
    this.cards.forEach(function (c) {
      if (!want[c.id]) return;
      if (!box) box = { x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y + c.h };
      else {
        box.x1 = Math.min(box.x1, c.x); box.y1 = Math.min(box.y1, c.y);
        box.x2 = Math.max(box.x2, c.x + c.w); box.y2 = Math.max(box.y2, c.y + c.h);
      }
    });
    if (!box) { this.centerOn(id); return; }
    var rect = this.host.getBoundingClientRect();
    var bw = (box.x2 - box.x1) + 48, bh = (box.y2 - box.y1) + 48;
    this.scale = Math.max(0.42, Math.min(1, Math.min(rect.width / bw, rect.height / bh)));
    this.tx = rect.width / 2 - ((box.x1 + box.x2) / 2) * this.scale;
    this.ty = rect.height / 2 - ((box.y1 + box.y2) / 2) * this.scale;
    this.applyTransform();
  };

  Tree.prototype.centerOn = function (id) {
    var c = this.cards.filter(function (x) { return x.id === id; })[0] || this.cards[0];
    if (!c) return;
    var rect = this.host.getBoundingClientRect();
    this.tx = rect.width / 2 - (c.x + c.w / 2) * this.scale;
    this.ty = rect.height / 2 - (c.y + c.h / 2) * this.scale;
    this.applyTransform();
  };
  Tree.prototype._bindPanZoom = function () {
    var self = this, drag = null, pinch = null;
    this.host.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.node')) return;
      drag = { x: e.clientX, y: e.clientY, tx: self.tx, ty: self.ty, id: e.pointerId };
      self.host.setPointerCapture(e.pointerId);
      self.host.classList.add('grabbing');
    });
    this.host.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      self.tx = drag.tx + (e.clientX - drag.x);
      self.ty = drag.ty + (e.clientY - drag.y);
      self.applyTransform();
    });
    function end() { drag = null; self.host.classList.remove('grabbing'); }
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
    this.host.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = self.host.getBoundingClientRect();
      self.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // щипок на сенсорном экране
    var pts = {};
    this.host.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        pinch = { d: dist(e.touches), s: self.scale };
      }
    }, { passive: true });
    this.host.addEventListener('touchmove', function (e) {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        var r = self.host.getBoundingClientRect();
        var d = dist(e.touches);
        var target = pinch.s * (d / pinch.d);
        var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        self.zoom(target / self.scale, cx, cy);
      }
    }, { passive: false });
    this.host.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; });
    function dist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy) || 1;
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  Tree.esc = esc;
  global.TreeView = Tree;
})(window);
