/* Семейное Древо — карточка персоны: сведения, медиа, записи, контакты, события, доступ, родня. */
(function (global) {
  'use strict';
  var S = global.Store;
  var U = S.util;
  var esc = global.TreeView.esc;
  var I = global.Icon;

  var ACL_LEVELS = [
    { v: 'public', t: 'Видно всем' },
    { v: 'group', t: 'Только вошедшим' },
    { v: 'admin', t: 'Только администратору' }
  ];

  function Sheet(opts) {
    this.el = opts.el;
    this.onChange = opts.onChange || function () {};
    this.onFocus = opts.onFocus || function () {};
    this.onOpen = opts.onOpen || function () {};
    this.pending = [];
    this.toast = opts.toast || function () {};
    this.personId = null;
    this.tab = 'info';
    this.urls = [];
    this._bind();
  }

  Sheet.prototype.open = function (id) {
    var self = this;
    if (this.personId && this.personId !== id && this.hasPending()) {
      this.guard(function () { self.openNow(id); });
      return;
    }
    this.openNow(id);
  };
  Sheet.prototype.openNow = function (id) {
    this.pending = [];
    this.personId = id;
    this.el.hidden = false;
    this.render();
    if (this.onOpen) this.onOpen(id);
  };
  Sheet.prototype.close = function () {
    var self = this;
    this.guard(function () {
      self.el.hidden = true;
      self.revoke();
      self.personId = null;
      self.pending = [];
      if (self.onOpen) self.onOpen(null);
    });
  };
  Sheet.prototype.revoke = function () {
    this.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    this.urls = [];
  };
  Sheet.prototype._bind = function () {
    var self = this;
    this.el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.dataset.act;
      if (self.actions[act]) { e.preventDefault(); self.actions[act].call(self, t); }
    });
    function onEdit(e) {
      var f = e.target.closest('[data-bind]');
      if (f) self.applyField(f);
    }
    this.el.addEventListener('change', onEdit);
    this.el.addEventListener('input', onEdit);
  };

  /* --------- чтение и запись полей --------- */
  Sheet.prototype.applyField = function (input) {
    var p = S.person(this.personId);
    if (!p) return;
    var path = input.dataset.bind.split('.');
    var val = input.type === 'checkbox' ? input.checked : input.value;
    this.stage('bind:' + input.dataset.bind, function () {
      var o = p;
      for (var i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] || {}; o = o[path[i]]; }
      o[path[path.length - 1]] = val;
    });
  };

  /* --------- отрисовка --------- */
  Sheet.prototype.render = function () {
    var p = S.person(this.personId);
    if (!p) { this.close(); return; }
    this.revoke();
    var tabs = [
      ['info', 'Сведения'], ['media', 'Фото и файлы'], ['notes', 'Записи'],
      ['contacts', 'Контакты'], ['events', 'События'], ['family', 'Родня'], ['access', 'Доступ']
    ];
    this.el.innerHTML =
      '<div class="sheet-head">' +
      '<div class="sheet-ph" id="shPhoto">' + I('person') + '</div>' +
      '<div style="flex:1 1 auto;min-width:0">' +
      '<div class="sheet-title" id="shName"></div>' +
      '<div class="sheet-sub" id="shSub"></div>' +
      '<div class="btn-row" style="margin-top:6px">' +
      '<button class="btn btn-sm" data-act="focus">В центр дерева</button>' +
      '<button class="btn btn-sm" data-act="addRel">+ Родственник</button>' +
      '</div></div>' +
      '<button class="icon-btn" data-act="close" title="Закрыть" aria-label="Закрыть">' + I('close') + '</button>' +
      '</div>' +
      '<div class="sheet-tabs" role="tablist">' +
      tabs.map(function (t) {
        return '<button role="tab" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="sheet-body" id="shBody"></div>' +
      '<div class="sheet-bar" id="shBar" hidden>' +
      '<span class="bar-count"></span>' +
      '<button class="btn btn-sm" data-act="discard">Отменить</button>' +
      '<button class="btn btn-sm btn-primary" data-act="commit">Сохранить</button>' +
      '</div>';
    this.renderHead();
    this.renderBody();
    this.paintBar();
  };

  Sheet.prototype.renderHead = function () {
    var p = S.person(this.personId), self = this;
    if (!p) return;
    this.el.querySelector('#shName').textContent = S.fullName(p);
    var bits = [];
    if (S.years(p)) bits.push(S.years(p));
    if (p.birth && p.birth.place) bits.push(p.birth.place);
    this.el.querySelector('#shSub').textContent = bits.join(' · ') || 'даты не указаны';
    var ph = this.el.querySelector('#shPhoto');
    ph.style.backgroundImage = '';
    ph.innerHTML = I('person');
    if (p.photo) {
      S.mediaURL(p.photo).then(function (url) {
        if (!url) return;
        self.urls.push(url);
        ph.style.backgroundImage = 'url(' + url + ')';
        ph.innerHTML = '';
      });
    }
    this.el.querySelectorAll('[data-act="tab"]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === self.tab ? 'true' : 'false');
    });
  };

  Sheet.prototype.renderBody = function () {
    var p = S.person(this.personId);
    if (!p) return;
    var body = this.el.querySelector('#shBody');
    body.innerHTML = this.views[this.tab].call(this, p);
    this.after[this.tab] && this.after[this.tab].call(this, p, body);
    var self = this;
    this.el.querySelectorAll('[data-act="tab"]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === self.tab ? 'true' : 'false');
    });
  };

  function micBtn(target) {
    return '<button class="btn btn-sm mic-btn" data-act="dictate" data-target="' + target +
      '" title="Надиктовать" aria-label="Надиктовать">' + I('mic') + '</button>';
  }
  function aclSelect(bindAttr, acl) {
    acl = acl || { level: 'public', locked: false };
    return '<select data-acl="' + bindAttr + '">' + ACL_LEVELS.map(function (l) {
      return '<option value="' + l.v + '"' + (acl.level === l.v ? ' selected' : '') + '>' + l.t + '</option>';
    }).join('') + '</select>';
  }

  Sheet.prototype.views = {
    info: function (p) {
      return '' +
        row('Фамилия', '<input data-bind="surname" value="' + esc(p.surname) + '">') +
        row('Имя', '<input data-bind="given" value="' + esc(p.given) + '">') +
        row('Отчество', '<input data-bind="patronymic" value="' + esc(p.patronymic) + '">') +
        row('Девичья', '<input data-bind="maiden" value="' + esc(p.maiden) + '">') +
        row('Пол', '<select data-bind="sex">' +
          opt('M', 'Мужской', p.sex) + opt('F', 'Женский', p.sex) + opt('U', 'Не указан', p.sex) + '</select>') +
        '<div class="sect-title">Рождение</div>' +
        row('Дата', '<input type="date" data-bind="birth.date" value="' + esc(dateVal(p.birth.date)) + '">') +
        row('Место', '<input data-bind="birth.place" value="' + esc(p.birth.place) + '">') +
        row('На карте', mapRow('birth', p.birth)) +
        '<div class="sect-title">Смерть</div>' +
        row('Жив(а)', '<input type="checkbox" data-bind="living"' + (p.living !== false ? ' checked' : '') + '>') +
        row('Дата', '<input type="date" data-bind="death.date" value="' + esc(dateVal(p.death.date)) + '">') +
        row('Место', '<input data-bind="death.place" value="' + esc(p.death.place) + '">') +
        row('На карте', mapRow('death', p.death)) +
        '<div class="btn-row"><button class="btn btn-danger btn-sm" data-act="delPerson">Удалить персону</button></div>';
    },

    media: function (p) {
      var list = S.mediaOf(p.id);
      var html = '<div class="btn-row" style="margin-top:0">' +
        '<button class="btn btn-primary btn-sm" data-act="pickFile">Добавить файлы</button>' +
        '<button class="btn btn-sm" data-act="recVoice">' + I('mic') + ' Голосовая заметка</button>' +
        '</div>' +
        '<p class="note" style="margin:8px 0 0">Фото, документы, аудио и видео — без ограничения количества. ' +
        'Для каждого файла можно включить замок: тогда он хранится и попадает в резервную копию в зашифрованном виде.</p>' +
        '<div id="recState" class="note"></div>';
      if (!list.length) return html + '<div class="empty">Файлов пока нет</div>';
      html += '<div class="sect-title">Файлы (' + list.length + ')</div><div class="media-grid" id="shMedia">';
      list.forEach(function (m) {
        var visible = S.canSee(m.acl);
        var ic = I(m.kind === 'photo' ? 'photo' : m.kind === 'audio' ? 'mic' :
          m.kind === 'video' ? 'map' : 'note');
        html += '<button class="media-tile" data-act="openMedia" data-id="' + m.id + '" title="' + esc(m.name) + '">' +
          (visible ? ic : I('lock')) +
          (m.acl && (m.acl.locked || m.acl.level !== 'public')
            ? '<span class="m-lock">' + I('lock') + '</span>' : '') +
          '<span class="m-name">' + esc(m.caption || m.name) + '</span></button>';
      });
      return html + '</div>';
    },

    notes: function (p) {
      var html = '<div class="sect-title">Общая запись</div>' +
        '<div class="inline" style="align-items:flex-start">' +
        '<textarea data-bind="note" id="noteArea" rows="6">' + esc(p.note) + '</textarea>' +
        micBtn('note') + '</div>';
      var custom = (p.fields || []).filter(function (f) { return f.type === 'text' || f.type === 'note'; });
      html += '<div class="sect-title">Дополнительные строки</div>';
      if (!custom.length) html += '<p class="note">Строк пока нет. Можно добавить любые: «Служба в армии», «Прозвище», «Откуда родом» и что угодно ещё.</p>';
      html += '<div class="list">' + custom.map(fieldRow).join('') + '</div>' +
        '<div class="btn-row"><button class="btn btn-sm" data-act="addField" data-type="text">+ Добавить строку</button></div>';
      return html;
    },

    contacts: function (p) {
      var cs = (p.fields || []).filter(function (f) {
        return ['phone', 'email', 'addr', 'link', 'messenger'].indexOf(f.type) >= 0;
      });
      var html = '<p class="note">Контактные данные живых родственников лучше закрывать от общего доступа — ' +
        'выберите «Только вошедшим» или «Только администратору».</p><div class="list">' +
        cs.map(fieldRow).join('') + '</div>';
      if (!cs.length) html += '<div class="empty">Контактов пока нет</div>';
      html += '<div class="btn-row">' +
        '<button class="btn btn-sm" data-act="addField" data-type="phone">+ Телефон</button>' +
        '<button class="btn btn-sm" data-act="addField" data-type="email">+ Почта</button>' +
        '<button class="btn btn-sm" data-act="addField" data-type="addr">+ Адрес</button>' +
        '<button class="btn btn-sm" data-act="addField" data-type="link">+ Ссылка</button>' +
        '</div>';
      return html;
    },

    events: function (p) {
      var evs = p.events || [];
      var html = '<p class="note">События ложатся на карту и в календарь: переезд, свадьба, служба, поездка.</p>';
      if (!evs.length) html += '<div class="empty">Событий пока нет</div>';
      html += '<div class="list">' + evs.map(function (e) {
        return '<div class="list-item" style="flex-wrap:wrap">' +
          '<div class="li-main" style="flex:1 1 100%">' +
          '<div class="inline"><input data-ev="' + e.id + '.type" value="' + esc(e.type) + '" placeholder="Что произошло">' +
          '<input type="date" data-ev="' + e.id + '.date" value="' + esc(dateVal(e.date)) + '" style="max-width:150px"></div>' +
          '<div class="inline" style="margin-top:5px"><input data-ev="' + e.id + '.place" value="' + esc(e.place) + '" placeholder="Место"></div>' +
          '<div class="inline" style="margin-top:5px">' + mapRow('ev:' + e.id, e) + '</div>' +
          '<div class="inline" style="margin-top:5px"><input data-ev="' + e.id + '.note" value="' + esc(e.note) + '" placeholder="Подробности">' +
          micBtn('ev:' + e.id + '.note') + '</div>' +
          '<div class="inline" style="margin-top:5px">' + aclSelect('ev:' + e.id, e.acl) +
          '<button class="btn btn-sm btn-danger" data-act="delEvent" data-id="' + e.id + '">Удалить</button></div>' +
          '</div></div>';
      }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn btn-sm" data-act="addEvent">+ Добавить событие</button></div>';
      return html;
    },

    family: function (p) {
      var par = S.parentsOf(p.id), sp = S.spousesOf(p.id), ch = S.childrenOf(p.id), sib = S.siblingsOf(p.id);
      function group(title, arr, rel) {
        var h = '<div class="sect-title">' + title + '</div>';
        if (!arr.length) return h + '<p class="note">нет</p>';
        return h + '<div class="list">' + arr.map(function (x) {
          return '<div class="list-item"><div class="mini-ph" data-ph="' + x.id + '">' + I('person') + '</div>' +
            '<div class="li-main"><div>' + esc(S.fullName(x)) + '</div>' +
            '<div class="li-sub">' + esc(S.years(x) || '—') + '</div></div>' +
            '<button class="btn btn-sm" data-act="goto" data-id="' + x.id + '">Открыть</button>' +
            (rel ? '<button class="btn btn-sm btn-danger" data-act="unlink" data-id="' + x.id +
              '" title="Убрать связь" aria-label="Убрать связь">' + I('close') + '</button>' : '') +
            '</div>';
        }).join('') + '</div>';
      }
      return group('Родители', par, true) + group('Супруги', sp, true) +
        group('Дети', ch, true) + group('Братья и сёстры', sib, false) +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" data-act="addRel">+ Добавить родственника</button></div>';
    },

    access: function (p) {
      var a = p.acl || { level: 'public', locked: false };
      return '<p class="note">Права действуют на всю карточку. Отдельные строки, файлы и события закрываются каждый своим замком ' +
        'на соответствующих вкладках.</p>' +
        row('Видимость', '<select data-acl="person">' + ACL_LEVELS.map(function (l) {
          return '<option value="' + l.v + '"' + (a.level === l.v ? ' selected' : '') + '>' + l.t + '</option>';
        }).join('') + '</select>') +
        row('Замок', '<label class="inline"><input type="checkbox" data-lock="person"' + (a.locked ? ' checked' : '') +
          '> <span class="note">запретить изменение всем, кроме администратора</span></label>') +
        '<div class="sect-title">Что это значит</div>' +
        '<p class="note">«Только администратору» скрывает запись у обычных пользователей и шифрует связанные с ней файлы ' +
        'при сохранении и в резервной копии. Ключ выводится из пароля дерева и нигде не хранится.</p>';
    }
  };

  Sheet.prototype.after = {
    media: function (p, body) {
      var self = this;
      body.querySelectorAll('.media-tile').forEach(function (tile) {
        var m = S.tree.media[tile.dataset.id];
        if (!m || m.kind !== 'photo' || !S.canSee(m.acl)) return;
        S.mediaURL(m.id).then(function (url) {
          if (!url) return;
          self.urls.push(url);
          tile.style.backgroundImage = 'url(' + url + ')';
          var ic0 = tile.querySelector('.ico');
          if (ic0) ic0.remove();
        });
      });
    },
    family: function (p, body) {
      var self = this;
      body.querySelectorAll('[data-ph]').forEach(function (el) {
        var per = S.person(el.dataset.ph);
        if (!per || !per.photo) return;
        S.mediaURL(per.photo).then(function (url) {
          if (!url) return;
          self.urls.push(url);
          el.style.backgroundImage = 'url(' + url + ')';
          el.innerHTML = '';
        });
      });
    },
    notes: function (p, body) { this.bindFields(body); },
    contacts: function (p, body) { this.bindFields(body); },
    events: function (p, body) { this.bindEvents(body); },
    access: function (p, body) { this.bindAcl(body); },
    info: function () {}
  };

  /* --------- отложенные правки ---------
     Поля не записываются в дерево сразу: правка попадает в очередь,
     внизу карточки появляется полоса «Сохранить / Отменить». Так случайное
     нажатие не уходит к родственникам при следующей синхронизации. */

  Sheet.prototype.stage = function (key, apply, label) {
    this.pending = this.pending || [];
    var found = false;
    for (var i = 0; i < this.pending.length; i++) {
      if (this.pending[i].key === key) { this.pending[i].apply = apply; found = true; break; }
    }
    if (!found) this.pending.push({ key: key, apply: apply, label: label || '' });
    this.paintBar();
  };
  Sheet.prototype.hasPending = function () { return !!(this.pending && this.pending.length); };

  Sheet.prototype.paintBar = function () {
    var bar = this.el.querySelector('#shBar');
    if (!bar) return;
    var n = this.pending ? this.pending.length : 0;
    bar.hidden = !n;
    if (!n) return;
    bar.querySelector('.bar-count').textContent =
      'Не сохранено: ' + n + ' ' + plural(n, 'правка', 'правки', 'правок');
  };

  Sheet.prototype.commit = function () {
    var p = S.person(this.personId);
    if (!p || !this.hasPending()) { this.pending = []; this.paintBar(); return; }
    this.pending.forEach(function (x) { try { x.apply(); } catch (e) { console.error(e); } });
    this.pending = [];
    S.updatePerson(p.id, {});
    this.paintBar();
    this.renderHead();
    this.renderBody();
    this.onChange();
    this.toast('Сохранено');
  };

  Sheet.prototype.discard = function () {
    this.pending = [];
    this.paintBar();
    this.renderBody();
  };

  /** спросить, если есть несохранённые правки; then() вызывается, когда можно идти дальше */
  Sheet.prototype.guard = function (then) {
    var self = this;
    if (!this.hasPending()) { then(); return; }
    global.App.modal('Сохранить изменения?',
      '<p class="note">В карточке ' + esc(S.fullName(S.person(this.personId))) +
      ' есть несохранённые правки: ' + this.pending.length + '. Что с ними сделать?</p>',
      [
        { text: 'Сохранить', primary: true, fn: function () {
          global.App.closeModal(); self.commit(); then();
        } },
        { text: 'Не сохранять', danger: true, fn: function () {
          global.App.closeModal(); self.pending = []; self.paintBar(); then();
        } }
      ]);
  };

  Sheet.prototype.bindFields = function (body) {
    var self = this, p = S.person(this.personId);
    body.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var parts = inp.dataset.f.split('.');
        var v = inp.value;
        self.stage('f:' + inp.dataset.f, function () {
          var f = (p.fields || []).filter(function (x) { return x.id === parts[0]; })[0];
          if (f) f[parts[1]] = v;
        });
      });
    });
    body.querySelectorAll('[data-acl]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var key = sel.dataset.acl, v = sel.value;
        self.stage('acl:' + key, function () {
          if (key.indexOf('f:') === 0) {
            var f = (p.fields || []).filter(function (x) { return x.id === key.slice(2); })[0];
            if (f) { f.acl = f.acl || {}; f.acl.level = v; }
          }
        });
      });
    });
  };

  Sheet.prototype.bindEvents = function (body) {
    var self = this, p = S.person(this.personId);
    body.querySelectorAll('[data-ev]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var parts = inp.dataset.ev.split('.');
        var v = inp.value;
        self.stage('ev:' + inp.dataset.ev, function () {
          var e = (p.events || []).filter(function (x) { return x.id === parts[0]; })[0];
          if (e) e[parts[1]] = v;
        });
      });
    });
    body.querySelectorAll('[data-acl]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.dataset.acl.replace('ev:', ''), v = sel.value;
        self.stage('evacl:' + id, function () {
          var e = (p.events || []).filter(function (x) { return x.id === id; })[0];
          if (e) { e.acl = e.acl || {}; e.acl.level = v; }
        });
      });
    });
  };

  Sheet.prototype.bindAcl = function (body) {
    var self = this, p = S.person(this.personId);
    var sel = body.querySelector('[data-acl="person"]');
    if (sel) sel.addEventListener('change', function () {
      var v = sel.value;
      self.stage('person.acl', function () { p.acl = p.acl || {}; p.acl.level = v; });
    });
    var lock = body.querySelector('[data-lock="person"]');
    if (lock) lock.addEventListener('change', function () {
      var v = lock.checked;
      self.stage('person.lock', function () { p.acl = p.acl || {}; p.acl.locked = v; });
    });
  };

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* --------- действия --------- */
  Sheet.prototype.actions = {
    close: function () { this.close(); },
    commit: function () { this.commit(); },
    discard: function () { this.discard(); },
    tab: function (btn) {
      var self = this, t = btn.dataset.tab;
      this.guard(function () { self.tab = t; self.renderBody(); self.renderHead(); });
    },
    focus: function () { this.onFocus(this.personId); },
    goto: function (btn) { this.open(btn.dataset.id); },
    pickPlace: function (btn) { this.pickPlace(btn.dataset.key); },
    dropPlace: function (btn) {
      var self = this, key = btn.dataset.key;
      global.App.confirm('Убрать точку с карты?',
        'Место словами останется в карточке — пропадёт только метка на карте.',
        function () {
          self.setPlace(key, null, null);
          self.renderBody();
          self.toast('Точка убрана');
        });
    },
    delPerson: function () {
      var p = S.person(this.personId);
      var self = this;
      global.App.confirm('Удалить ' + S.fullName(p) + '?', 'Связи с другими персонами тоже будут сняты. Отменить нельзя.', function () {
        S.removePerson(self.personId);
        self.close();
        self.onChange();
      });
    },
    addRel: function () { global.App.addRelative(this.personId); },
    unlink: function (btn) {
      S.unlink(this.personId, btn.dataset.id);
      this.renderBody();
      this.onChange();
    },
    addField: function (btn) {
      this.commit();
      var p = S.person(this.personId);
      var type = btn.dataset.type;
      var labels = { phone: 'Телефон', email: 'Почта', addr: 'Адрес', link: 'Ссылка', text: 'Новая строка' };
      p.fields = p.fields || [];
      p.fields.push({
        id: U.uid('f'), label: labels[type] || 'Строка', value: '', type: type,
        acl: { level: type === 'text' ? 'public' : 'group', locked: false }
      });
      S.updatePerson(p.id, {});
      this.renderBody();
      this.onChange();
    },
    delField: function (btn) {
      var p = S.person(this.personId);
      p.fields = (p.fields || []).filter(function (f) { return f.id !== btn.dataset.id; });
      S.updatePerson(p.id, {});
      this.renderBody();
      this.onChange();
    },
    addEvent: function () {
      this.commit();
      var p = S.person(this.personId);
      p.events = p.events || [];
      p.events.push({
        id: U.uid('e'), type: '', date: '', place: '', lat: null, lng: null, note: '',
        acl: { level: 'public', locked: false }
      });
      S.updatePerson(p.id, {});
      this.renderBody();
      this.onChange();
    },
    delEvent: function (btn) {
      var p = S.person(this.personId);
      p.events = (p.events || []).filter(function (e) { return e.id !== btn.dataset.id; });
      S.updatePerson(p.id, {});
      this.renderBody();
      this.onChange();
    },
    pickFile: function () {
      var self = this;
      global.App.pickFiles(function (files) {
        global.App.askAccess(function (acl) {
          var queue = Array.prototype.slice.call(files);
          (function next() {
            if (!queue.length) { self.renderBody(); self.renderHead(); self.onChange(); return; }
            S.addMedia(self.personId, queue.shift(), { acl: acl }).then(next, function (e) {
              self.toast('Файл не добавился: ' + e.message);
              next();
            });
          })();
        });
      });
    },
    openMedia: function (btn) { global.App.viewMedia(btn.dataset.id, this); },
    recVoice: function (btn) { this.recordVoice(btn); },
    dictate: function (btn) { this.dictate(btn.dataset.target, btn); }
  };

  /* --------- точка на карте --------- */
  /* Точку записываем сразу: в окне карты человек уже нажал «Сохранить точку»,
     второе подтверждение внизу карточки было бы лишним. */
  Sheet.prototype.setPlace = function (key, lat, lng) {
    var p = S.person(this.personId);
    if (!p) return;
    if (key.indexOf('ev:') === 0) {
      var e = (p.events || []).filter(function (x) { return x.id === key.slice(3); })[0];
      if (e) { e.lat = lat; e.lng = lng; }
    } else {
      p[key] = p[key] || {};
      p[key].lat = lat;
      p[key].lng = lng;
    }
    S.updatePerson(p.id, {});
    this.onChange();
  };

  Sheet.prototype.pickPlace = function (key) {
    var self = this, p = S.person(this.personId);
    var cur = key.indexOf('ev:') === 0
      ? (p.events || []).filter(function (x) { return x.id === key.slice(3); })[0]
      : p[key];
    var placeName = (cur && cur.place) || '';
    var chosen = { lat: cur && cur.lat, lng: cur && cur.lng };

    global.App.modal('Где это было?',
      '<p class="note" style="margin:0 0 10px">Нажмите на карту в нужном месте. ' +
      'Перетаскивание двигает карту, колесо и кнопки слева меняют масштаб.</p>' +
      (placeName ? '<p class="note">Записано место: <b>' + esc(placeName) + '</b></p>' : '') +
      '<div id="pkMap" style="height:52vh;min-height:280px;position:relative;border-radius:10px;' +
      'overflow:hidden;border:1px solid var(--line)"></div>' +
      '<p class="note" id="pkInfo" style="margin-top:8px">' +
      (chosen.lat != null ? 'Выбрано: ' + (+chosen.lat).toFixed(4) + ', ' + (+chosen.lng).toFixed(4)
        : 'Точка пока не выбрана') + '</p>',
      [{ text: 'Сохранить точку', primary: true, fn: function () {
        if (chosen.lat == null) { self.toast('Сначала отметьте место на карте'); return; }
        global.App.closeModal();
        self.setPlace(key, +(+chosen.lat).toFixed(6), +(+chosen.lng).toFixed(6));
        self.renderBody();
      } }]);

    var m = new global.MiniMap(document.getElementById('pkMap'));
    var pins = [];
    if (chosen.lat != null) pins.push({ lat: +chosen.lat, lng: +chosen.lng, kind: 'event', label: placeName });
    m.setPins(pins);
    if (pins.length) { m.z = 11; m.cx = +chosen.lat; m.cy = +chosen.lng; m.draw(); }
    else m.draw();
    m.onClick = function (lat, lng) {
      chosen.lat = lat; chosen.lng = lng;
      m.setPins([{ lat: lat, lng: lng, kind: 'event', label: placeName }]);
      var info = document.getElementById('pkInfo');
      if (info) info.textContent = 'Выбрано: ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
    };
  };

  /* --------- голос --------- */
  Sheet.prototype.dictate = function (target, btn) {
    var self = this;
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) { this.toast('Голосовой ввод доступен в Chrome, Edge и Safari на установленном приложении'); return; }
    var rec = new SR();
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = false;
    btn.classList.add('rec');
    var buf = '';
    rec.onresult = function (e) {
      buf = '';
      for (var i = 0; i < e.results.length; i++) buf += e.results[i][0].transcript;
    };
    rec.onerror = function () { btn.classList.remove('rec'); self.toast('Микрофон недоступен'); };
    rec.onend = function () {
      btn.classList.remove('rec');
      if (!buf.trim()) return;
      var p = S.person(self.personId);
      if (target === 'note') p.note = (p.note ? p.note + '\n' : '') + buf;
      else if (target.indexOf('ev:') === 0) {
        var id = target.slice(3).split('.')[0];
        var ev = (p.events || []).filter(function (x) { return x.id === id; })[0];
        if (ev) ev.note = (ev.note ? ev.note + ' ' : '') + buf;
      } else if (target.indexOf('f:') === 0) {
        var f = (p.fields || []).filter(function (x) { return x.id === target.slice(2); })[0];
        if (f) f.value = (f.value ? f.value + ' ' : '') + buf;
      } else {
        var path = target.split('.');
        if (path.length === 2) p[path[0]][path[1]] = buf;
        else p[path[0]] = buf;
      }
      S.updatePerson(p.id, {});
      self.renderBody();
      self.onChange();
    };
    try { rec.start(); } catch (e) { btn.classList.remove('rec'); }
  };

  Sheet.prototype.recordVoice = function (btn) {
    var self = this;
    if (this._rec) {
      this._rec.stop();
      return;
    }
    if (!navigator.mediaDevices || !global.MediaRecorder) {
      this.toast('Запись звука недоступна в этом окружении');
      return;
    }
    var state = this.el.querySelector('#recState');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mr = new MediaRecorder(stream);
      var chunks = [];
      self._rec = mr;
      btn.textContent = '⏹ Остановить запись';
      btn.classList.add('rec');
      var t0 = Date.now();
      var timer = setInterval(function () {
        if (state) state.textContent = 'Идёт запись… ' + Math.round((Date.now() - t0) / 1000) + ' с';
      }, 300);
      mr.ondataavailable = function (e) { chunks.push(e.data); };
      mr.onstop = function () {
        clearInterval(timer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        self._rec = null;
        var blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        blob.name = 'Голосовая заметка ' + new Date().toLocaleString('ru-RU') + '.webm';
        var file = new File([blob], blob.name, { type: blob.type });
        global.App.askAccess(function (acl) {
          S.addMedia(self.personId, file, { acl: acl, kind: 'audio' }).then(function () {
            self.renderBody();
            self.onChange();
            self.toast('Заметка сохранена');
          });
        });
      };
      mr.start();
    }).catch(function () { self.toast('Нет доступа к микрофону'); });
  };

  /* --------- мелкие построители разметки --------- */
  function row(label, inner) {
    return '<div class="row"><label>' + label + '</label><div>' + inner + '</div></div>';
  }
  function opt(v, t, cur) {
    return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + t + '</option>';
  }
  function dateVal(s) {
    var d = U.parseDate(s);
    if (!d || !d.m || !d.d) return '';
    return d.y + '-' + pad(d.m) + '-' + pad(d.d);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** Вместо двух полей с цифрами — ссылка на карту и кнопка выбора точки.
      Координаты по-прежнему хранятся: по ним строится вкладка «Карта». */
  function mapRow(key, o) {
    o = o || {};
    var has = o.lat != null && o.lng != null;
    var h = '<div class="map-row">';
    if (has) {
      var url = 'https://www.openstreetmap.org/?mlat=' + o.lat + '&mlon=' + o.lng + '#map=13/' +
        o.lat + '/' + o.lng;
      h += '<a class="map-link" href="' + url + '" target="_blank" rel="noopener">' +
        I('pin') + ' Открыть на карте</a>' +
        '<span class="map-coord">' + (+o.lat).toFixed(4) + ', ' + (+o.lng).toFixed(4) + '</span>' +
        '<button class="btn btn-sm" data-act="pickPlace" data-key="' + key + '">Изменить точку</button>' +
        '<button class="btn btn-sm btn-danger" data-act="dropPlace" data-key="' + key + '">Убрать</button>';
    } else {
      h += '<button class="btn btn-sm" data-act="pickPlace" data-key="' + key + '">' +
        I('pin') + ' Указать на карте</button>' +
        '<span class="note">точка не отмечена</span>';
    }
    return h + '</div>';
  }
  function fieldRow(f) {
    var isNote = f.type === 'text' || f.type === 'note';
    return '<div class="list-item" style="flex-wrap:wrap">' +
      '<div class="li-main" style="flex:1 1 100%">' +
      '<div class="inline"><input data-f="' + f.id + '.label" value="' + esc(f.label) + '" placeholder="Название" style="max-width:40%">' +
      '<input data-f="' + f.id + '.value" value="' + esc(f.value) + '" placeholder="Значение">' +
      micBtn('f:' + f.id) + '</div>' +
      '<div class="inline" style="margin-top:5px">' + aclSelect('f:' + f.id, f.acl) +
      '<button class="btn btn-sm btn-danger" data-act="delField" data-id="' + f.id + '">Удалить</button></div>' +
      '</div></div>';
  }

  global.PersonSheet = Sheet;
  global.ACL_LEVELS = ACL_LEVELS;
})(window);
