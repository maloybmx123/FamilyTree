/* Семейное Древо — главный модуль: вход, вкладки, поиск, настройки, календарь, карта. */
(function (global) {
  'use strict';
  var S = global.Store, U = S.util, esc = global.TreeView.esc;

  var App = {
    tree: null, sheet: null, map: null,
    activeTab: 'tree',
    _mediaUrls: [],

    /* ============ запуск ============ */
    init: function () {
      S.load();
      this.bindChrome();
      var invite = (location.hash || '').match(/^#invite-([\w-]+)$/);
      if (!S.users.length) this.gateFirstRun();
      else if (invite) this.gateInvite(invite[1]);
      else if (S.session) this.start();
      else this.gateLogin();
    },

    start: function () {
      S.loadPrefs(S.session.userId);
      this.applyPrefs();
      document.getElementById('gate').hidden = true;
      document.getElementById('app').hidden = false;
      this.paintIcons();

      var self = this;
      this.tree = new global.TreeView({
        host: document.getElementById('treeHost'),
        canvas: document.getElementById('treeCanvas'),
        svg: document.getElementById('treeLines'),
        onSelect: function (id) { self.sheet.open(id); },
        onAdd: function (id) { self.addRelative(id); },
        onRender: function () { self.paintEmpty(); }
      });
      this.tree.mode = S.prefs.layout;
      // Пустое дерево так и остаётся пустым: образец больше не подставляется сам.
      if (S.persons().length) this.tree.setFocus(S.tree.meta.rootId || S.persons()[0].id);

      this.sheet = new global.PersonSheet({
        el: document.getElementById('sheet'),
        onChange: function () { self.tree.render(); self.renderTabs(); },
        onFocus: function (id) { self.tree.setFocus(id); },
        onOpen: function (id) { self.tree.setOpen(id); },
        toast: function (m) { self.toast(m); }
      });

      document.getElementById('who').innerHTML =
        '<b>' + esc(S.session.displayName) + '</b> · ' + (S.isAdmin() ? 'администратор' : 'пользователь');
      document.getElementById('treeName').textContent = S.tree.meta.name;
      this.renderTabs();
      this.showTab('tree');
      setTimeout(function () { self.tree.fit(true); }, 60);
      this.startSync();
    },

    /* ============ значки ============ */
    paintIcons: function () {
      var I = global.Icon;
      function put(id, name, before) {
        var el = document.getElementById(id);
        if (!el) return;
        var lbl = el.querySelector('.lbl');
        el.innerHTML = I(name) + (lbl ? lbl.outerHTML : '');
      }
      put('qIco', 'search');
      put('qClear', 'close');
      put('qMic', 'mic');
      put('btnAdd', 'addPerson');
      put('btnSync', 'sync');
      put('btnCalendar', 'calendar');
      put('btnMap', 'map');
      put('btnSettings', 'settings');
      put('btnLogout', 'logout');
      put('zoomIn', 'plus');
      put('zoomOut', 'minus');
      put('zoomFit', 'expand');
      var views = { vertical: 'down', horizontal: 'right', butterfly: 'butterfly' };
      document.querySelectorAll('#viewdock [data-view]').forEach(function (b) {
        var lbl = b.querySelector('.lbl');
        b.innerHTML = I(views[b.dataset.view]) + (lbl ? lbl.outerHTML : '');
      });
    },

    /* ============ пустое дерево ============ */
    paintEmpty: function () {
      var box = document.getElementById('treeEmpty'), self = this;
      if (!box) return;
      if (S.persons().length) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '<div>' + global.Icon('tree') +
        '<h2>Дерево пока пустое</h2>' +
        '<p>Начните с себя или с того, о ком знаете больше всех. Дальше к каждому человеку ' +
        'можно будет добавлять родителей, супругов и детей — кнопкой «+» на его окошке.</p>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary" id="emAdd">Добавить первого человека</button>' +
        '<button class="btn" id="emImport">Загрузить из файла</button>' +
        '</div>' +
        '<p class="note" style="margin:14px 0 0">Хотите сначала посмотреть, как всё устроено? ' +
        '<button class="btn btn-sm" id="emDemo">Показать пример</button></p>' +
        '</div>';
      document.getElementById('emAdd').addEventListener('click', function () { self.addPerson(); });
      document.getElementById('emImport').addEventListener('click', function () { self.openSettings('data'); });
      document.getElementById('emDemo').addEventListener('click', function () {
        self.seedDemo();
        self.tree.setFocus(S.tree.meta.rootId);
        self.afterSync();
        setTimeout(function () { self.tree.fit(true); }, 40);
        self.toast('Это пример. Удалить его целиком — Настройки → Данные → Очистить дерево');
      });
    },

    /* ============ вход ============ */
    gate: function (html) {
      var g = document.getElementById('gate');
      g.hidden = false;
      document.getElementById('app').hidden = true;
      g.innerHTML = '<div class="gate-card">' + html +
        (global.DREVO_PREVIEW ? '<p class="note" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line)">' +
          'Это витрина внутри Claude. Дерево, карточки, поиск и настройки работают полностью. ' +
          'Сохранение файлов, микрофон, карта и вход по отпечатку закрыты правилами этого окна — ' +
          'они работают в версии, установленной на телефон или компьютер.</p>' : '') +
        '</div>';
    },
    /* Вход на втором устройстве. Учётные записи лежат в дереве, поэтому
       сперва надо забрать дерево из общего хранилища, а потом входить. */
    gateJoin: function () {
      var self = this, Sy = global.Sync;
      var sync = S.sync || U.defaultSync();
      this.gate(
        '<h1>Присоединиться к дереву</h1>' +
        '<p class="lede">Укажите то же хранилище, что и на первом устройстве. ' +
        'Программа заберёт дерево вместе со списком пользователей, и вы войдёте своим логином.</p>' +
        '<label for="jMode">Где лежит дерево</label>' +
        '<select id="jMode">' +
        '<option value="supabase"' + (sync.mode === 'supabase' ? ' selected' : '') + '>Supabase</option>' +
        '<option value="server"' + (sync.mode === 'server' ? ' selected' : '') + '>Свой сервер</option>' +
        '</select>' +
        '<div id="jFields"></div>' +
        '<div class="err" id="gErr"></div>' +
        '<div class="btn-row"><button class="btn btn-primary" id="jGo">Забрать дерево</button>' +
        '<button class="btn" id="jBack">Назад</button></div>');

      function fields() {
        var m = document.getElementById('jMode').value;
        var cfg = sync[m] || {};
        document.getElementById('jFields').innerHTML = m === 'supabase'
          ? '<label for="jUrl">Адрес проекта</label><input id="jUrl" value="' + esc(cfg.url || '') +
            '" placeholder="https://xxxxx.supabase.co" autocomplete="off">' +
            '<label for="jKey">Ключ anon public</label><input id="jKey" type="password" value="' +
            esc(cfg.key || '') + '" autocomplete="off">' +
            '<label for="jTree">Имя дерева</label><input id="jTree" value="' + esc(cfg.treeId || '') +
            '" autocomplete="off">'
          : '<label for="jUrl">Адрес сервера</label><input id="jUrl" value="' + esc(cfg.url || '') +
            '" placeholder="https://drevo.мойдомен.ru" autocomplete="off">' +
            '<label for="jKey">Ключ доступа</label><input id="jKey" type="password" value="' +
            esc(cfg.key || '') + '" autocomplete="off">';
      }
      fields();
      document.getElementById('jMode').addEventListener('change', fields);
      document.getElementById('jBack').addEventListener('click', function () {
        if (S.users.length) self.gateLogin(); else self.gateFirstRun();
      });

      document.getElementById('jGo').addEventListener('click', function () {
        var m = document.getElementById('jMode').value;
        S.sync.mode = m;
        S.sync[m].url = val('jUrl');
        S.sync[m].key = val('jKey');
        if (m === 'supabase') S.sync.supabase.treeId = val('jTree');
        if (!S.sync[m].url || !S.sync[m].key) return err('Заполните адрес и ключ');
        if (m === 'supabase' && !S.sync.supabase.treeId) return err('Укажите имя дерева');
        S.saveSync();
        err('Забираем дерево…');
        Sy.peek().then(function (remote) {
          if (!remote || !remote.persons) {
            err('По этим настройкам дерева не нашлось. Проверьте адрес, ключ и имя дерева.');
            return;
          }
          if (!remote.users || !remote.users.length) {
            err('Дерево нашлось, но в нём нет учётных записей. ' +
              'Обновите программу на первом устройстве и синхронизируйте её — записи уедут вместе с деревом.');
            return;
          }
          S.tree = remote;
          S.save(true);
          // дерево только что взято целиком — переспрашивать «слить или заменить» незачем
          S.sync.lastAt = new Date().toISOString();
          S.sync.lastError = null;
          S.dirty = false;
          S.saveSync();
          self.toast('Дерево получено: ' + Object.keys(remote.persons).length + ' персон');
          self.gateLogin();
        }, function (e) { err('Не вышло: ' + e.message); });
      });
    },

    gateFirstRun: function () {
      var self = this;
      this.gate(
        '<h1>Семейное Древо</h1>' +
        '<p class="lede">Семейное древо, которое живёт на ваших устройствах. Первый вход создаёт администратора — ' +
        'того, кто раздаёт доступ остальным родственникам.</p>' +
        '<label for="gName">Как вас зовут</label><input id="gName" autocomplete="name">' +
        '<label for="gLogin">Логин</label><input id="gLogin" autocomplete="username" placeholder="admin">' +
        '<label for="gPass">Пароль</label><input id="gPass" type="password" autocomplete="new-password">' +
        '<label for="gPass2">Пароль ещё раз</label><input id="gPass2" type="password" autocomplete="new-password">' +
        '<p class="note" style="margin-top:10px">Этот же пароль открывает зашифрованные записи. ' +
        'Восстановить его нельзя — запишите в надёжном месте.</p>' +
        '<div class="err" id="gErr"></div>' +
        '<div class="btn-row"><button class="btn btn-primary" id="gGo">Создать дерево</button></div>' +
        '<p class="note" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
        'Дерево уже заведено на другом устройстве? ' +
        '<button class="btn btn-sm" id="gJoin">Присоединиться к нему</button></p>');
      document.getElementById('gJoin').addEventListener('click', function () { self.gateJoin(); });
      document.getElementById('gGo').addEventListener('click', function () {
        var name = val('gName'), login = val('gLogin'), p1 = val('gPass'), p2 = val('gPass2');
        if (!login || !p1) return err('Заполните логин и пароль');
        if (p1.length < 6) return err('Пароль короче шести знаков');
        if (p1 !== p2) return err('Пароли не совпадают');
        S.createUser(login, p1, 'admin', name || login).then(function (u) {
          S.setSession({ userId: u.id, login: u.login, role: u.role, displayName: u.displayName });
          return S.unlockCrypto(p1);
        }).then(function () { self.start(); });
      });
    },
    gateLogin: function () {
      var self = this;
      var hasBio = S.users.some(function (u) { return u.webauthn; });
      this.gate(
        '<h1>Семейное Древо</h1>' +
        '<p class="lede">Войдите, чтобы открыть семейное древо.</p>' +
        '<label for="gLogin">Логин</label><input id="gLogin" autocomplete="username">' +
        '<label for="gPass">Пароль</label><input id="gPass" type="password" autocomplete="current-password">' +
        '<div class="err" id="gErr"></div>' +
        '<div class="btn-row"><button class="btn btn-primary" id="gGo">Войти</button>' +
        (hasBio ? '<button class="btn" id="gBio">Войти по отпечатку</button>' : '') + '</div>' +
        '<p class="note" style="margin-top:14px">Нет доступа? Попросите у администратора дерева ' +
        'ссылку-приглашение.</p>' +
        '<p class="note">Это другое устройство, а дерево лежит в общем хранилище? ' +
        '<button class="btn btn-sm" id="gJoin2">Забрать его оттуда</button></p>');
      var join2 = document.getElementById('gJoin2');
      if (join2) join2.addEventListener('click', function () { self.gateJoin(); });
      function go() {
        var login = val('gLogin'), pass = val('gPass');
        S.auth(login, pass).then(function (u) {
          if (!u) return err('Логин или пароль не подходят');
          S.setSession({ userId: u.id, login: u.login, role: u.role, displayName: u.displayName });
          return S.unlockCrypto(pass).then(function () { self.start(); });
        });
      }
      document.getElementById('gGo').addEventListener('click', go);
      document.getElementById('gPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      var bio = document.getElementById('gBio');
      if (bio) bio.addEventListener('click', function () { self.bioLogin(); });
    },
    gateInvite: function (token) {
      var self = this;
      var u = S.users.filter(function (x) { return x.invite === token; })[0];
      if (!u) { this.gateLogin(); return; }
      this.gate(
        '<h1>Приглашение в дерево</h1>' +
        '<p class="lede">Администратор открыл вам доступ к дереву «' + esc(S.tree.meta.name) +
        '». Придумайте пароль — логин уже заведён: <b>' + esc(u.login) + '</b>.</p>' +
        '<label for="gPass">Пароль</label><input id="gPass" type="password" autocomplete="new-password">' +
        '<label for="gPass2">Пароль ещё раз</label><input id="gPass2" type="password" autocomplete="new-password">' +
        '<div class="err" id="gErr"></div>' +
        '<div class="btn-row"><button class="btn btn-primary" id="gGo">Принять приглашение</button></div>');
      document.getElementById('gGo').addEventListener('click', function () {
        var p1 = val('gPass'), p2 = val('gPass2');
        if (p1.length < 6) return err('Пароль короче шести знаков');
        if (p1 !== p2) return err('Пароли не совпадают');
        S.setPassword(u, p1).then(function () {
          u.invite = null;
          u.updated = new Date().toISOString();
          S.save();
          S.setSession({ userId: u.id, login: u.login, role: u.role, displayName: u.displayName });
          location.hash = '';
          return S.unlockCrypto(p1);
        }).then(function () { self.start(); });
      });
    },

    /* вход по отпечатку: ключ хранится в устройстве, пароль дерева — в защищённом поле */
    bioRegister: function () {
      var self = this;
      if (!global.PublicKeyCredential || !navigator.credentials) { this.toast('Устройство не поддерживает вход по отпечатку'); return; }
      this.prompt('Пароль дерева', 'Подтвердите пароль — он понадобится, чтобы открывать зашифрованные записи после входа по отпечатку.', '', function (pass) {
        S.auth(S.session.login, pass).then(function (u) {
          if (!u) { self.toast('Пароль не подходит'); return; }
          var challenge = crypto.getRandomValues(new Uint8Array(32));
          return navigator.credentials.create({
            publicKey: {
              challenge: challenge,
              rp: { name: 'Семейное Древо' },
              user: { id: new TextEncoder().encode(u.id), name: u.login, displayName: u.displayName },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
              authenticatorSelection: { userVerification: 'required', authenticatorAttachment: 'platform' },
              timeout: 60000
            }
          }).then(function (cred) {
            return U.encryptText(pass).then(function (packed) {
              u.webauthn = { id: U.bytesToB64(cred.rawId), wrapped: packed };
              S.saveUsers();
              self.toast('Вход по отпечатку включён');
            });
          });
        }).catch(function () { self.toast('Не удалось включить вход по отпечатку'); });
      }, 'password');
    },
    bioLogin: function () {
      var self = this;
      var u = S.users.filter(function (x) { return x.webauthn; })[0];
      if (!u) return;
      navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: U.b64ToBytes(u.webauthn.id) }],
          userVerification: 'required', timeout: 60000
        }
      }).then(function () {
        S.setSession({ userId: u.id, login: u.login, role: u.role, displayName: u.displayName });
        self.toast('Отпечаток принят. Введите пароль дерева один раз, чтобы открыть закрытые записи.');
        self.start();
      }).catch(function () { self.toast('Отпечаток не распознан'); });
    },

    /* ============ верхняя панель ============ */
    bindChrome: function () {
      var self = this;
      var q = document.getElementById('q');
      q.addEventListener('input', function () { self.runSearch(q.value); });
      q.addEventListener('focus', function () { if (q.value) self.runSearch(q.value); });
      document.getElementById('qClear').addEventListener('click', function () {
        q.value = ''; self.runSearch('');
        q.focus();
      });
      document.getElementById('qMic').addEventListener('click', function () { self.searchByVoice(this); });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.search-wrap')) document.getElementById('qResults').hidden = true;
      });
      document.getElementById('btnSettings').addEventListener('click', function () { self.openSettings(); });
      document.getElementById('btnSync').addEventListener('click', function () {
        var Sy = global.Sync;
        if (!Sy.ready()) { self.openSettings('sync'); return; }
        self.firstSync(function (rep) {
          self.afterSync();
          self.toast('Синхронизировано. ' + Sy.statsText(rep.stats) +
            (rep.down ? ' · получено файлов: ' + rep.down : ''));
        }, function (e) { self.toast('Синхронизация не прошла: ' + e.message); });
      });
      document.getElementById('btnCalendar').addEventListener('click', function () { self.openCalendar(); });
      document.getElementById('btnMap').addEventListener('click', function () { self.openMap(); });
      document.getElementById('btnAdd').addEventListener('click', function () { self.addPerson(); });
      document.getElementById('btnLogout').addEventListener('click', function () {
        var Sy = global.Sync;
        var warn = (S.sync && S.sync.mode !== 'off' && S.dirty)
          ? 'Есть правки, которые ещё не ушли в общее хранилище. Синхронизировать перед выходом?'
          : 'Дерево останется на этом устройстве. Войти снова можно будет по логину и паролю.';
        self.modal('Выйти из программы?', '<p class="note">' + warn + '</p>',
          (S.sync && S.sync.mode !== 'off' && S.dirty ? [{
            text: 'Синхронизировать и выйти', primary: true, fn: function () {
              self.closeModal();
              self.toast('Отправляем правки…');
              Sy.run({ media: true }).then(done, function () {
                self.toast('Отправить не вышло — правки останутся на устройстве');
                setTimeout(done, 1200);
              });
            }
          }] : []).concat([{
            text: 'Выйти', danger: true, fn: done
          }]));
        function done() { S.setSession(null); location.reload(); }
      });
      document.getElementById('viewdock').addEventListener('click', function (e) {
        var b = e.target.closest('[data-view]');
        if (!b) return;
        S.prefs.layout = b.dataset.view; S.savePrefs();
        self.tree.setMode(b.dataset.view);
        self.markView();
        setTimeout(function () { self.tree.fit(true); }, 30);
      });
      document.getElementById('zoomIn').addEventListener('click', function () { self.tree.zoom(1.2); });
      document.getElementById('zoomOut').addEventListener('click', function () { self.tree.zoom(1 / 1.2); });
      document.getElementById('zoomFit').addEventListener('click', function () { self.tree.fit(); });
      document.getElementById('modalBack').addEventListener('click', function (e) {
        if (e.target.id === 'modalBack') self.closeModal();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { self.closeModal(); document.getElementById('qResults').hidden = true; }
      });
    },
    markView: function () {
      document.querySelectorAll('#viewdock [data-view]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.view === S.prefs.layout ? 'true' : 'false');
      });
    },

    /* ============ поиск ============ */
    runSearch: function (q) {
      var box = document.getElementById('qResults'), self = this;
      if (!q || !q.trim()) { box.hidden = true; box.innerHTML = ''; return; }
      var res = S.search(q);
      if (!res.length) {
        box.hidden = false;
        box.innerHTML = '<div class="empty" style="padding:18px">Ничего не нашлось</div>';
        return;
      }
      box.hidden = false;
      box.innerHTML = res.map(function (r, i) {
        var p = r.person;
        var sub = r.media ? ('файл: ' + esc(r.media.name)) : esc([S.years(p), p.birth && p.birth.place].filter(Boolean).join(' · ') || '—');
        return '<button data-i="' + i + '"><span class="mini-ph" data-ph="' + (p ? p.id : '') + '">' +
          global.Icon('person') + '</span>' +
          '<span style="min-width:0"><span style="display:block">' + esc(p ? S.fullName(p) : '—') + '</span>' +
          '<span class="r-sub">' + sub + '</span></span></button>';
      }).join('');
      box.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var r = res[+b.dataset.i];
          box.hidden = true;
          if (r.person) { self.showTab('tree'); self.tree.setFocus(r.person.id); self.sheet.open(r.person.id); }
        });
      });
      box.querySelectorAll('[data-ph]').forEach(function (el) {
        var p = S.person(el.dataset.ph);
        if (!p || !p.photo) return;
        S.mediaURL(p.photo).then(function (url) {
          if (url) { el.style.backgroundImage = 'url(' + url + ')'; el.innerHTML = ''; }
        });
      });
    },
    searchByVoice: function (btn) {
      var SR = global.SpeechRecognition || global.webkitSpeechRecognition, self = this;
      if (!SR) { this.toast('Голосовой поиск работает в Chrome, Edge и Safari'); return; }
      var rec = new SR();
      rec.lang = 'ru-RU'; rec.interimResults = true;
      btn.classList.add('rec');
      rec.onresult = function (e) {
        var s = '';
        for (var i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
        document.getElementById('q').value = s;
        self.runSearch(s);
      };
      rec.onend = function () { btn.classList.remove('rec'); };
      rec.onerror = function () { btn.classList.remove('rec'); self.toast('Микрофон недоступен'); };
      try { rec.start(); } catch (e) { btn.classList.remove('rec'); }
    },

    /* ============ вкладки ============ */
    renderTabs: function () {
      var self = this, bar = document.getElementById('tabs');
      bar.innerHTML = S.tree.tabs.map(function (t) {
        return '<button role="tab" data-tab="' + t.id + '" aria-selected="' + (self.activeTab === t.id) + '">' +
          esc(t.title) + (t.builtin ? '' : ' <span class="tab-close" data-del="' + t.id +
            '" title="Убрать вкладку">' + global.Icon('close') + '</span>') + '</button>';
      }).join('') + '<button class="tab-add" id="tabAdd" title="Добавить вкладку">+</button>';
      bar.querySelectorAll('[data-tab]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          var x = e.target.closest('[data-del]');     // нажатие может попасть в рисунок внутри
          if (x) {
            e.stopPropagation();
            var id = x.dataset.del;
            var tab = S.tree.tabs.filter(function (t) { return t.id === id; })[0];
            self.confirm('Убрать вкладку «' + ((tab && tab.title) || '') + '»?',
              'Люди, фотографии и связи останутся на месте — пропадёт только сама вкладка' +
              (tab && tab.kind === 'notes' && tab.content ? ' вместе с записями на ней.' : '.'),
              function () {
                S.removeTab(id);
                if (self.activeTab === id) self.activeTab = 'tree';
                self.renderTabs();
                self.showTab(self.activeTab);
                self.toast('Вкладка убрана');
              });
            return;
          }
          self.showTab(b.dataset.tab);
        });
      });
      document.getElementById('tabAdd').addEventListener('click', function () { self.addTabDialog(); });
    },
    showTab: function (id) {
      this.activeTab = id;
      var tab = S.tree.tabs.filter(function (t) { return t.id === id; })[0] || S.tree.tabs[0];
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.remove('active'); });
      document.querySelectorAll('#tabs [data-tab]').forEach(function (b) {
        b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      });
      var kind = tab.builtin ? tab.id : tab.kind;
      var pane = document.getElementById('pane-' + (['tree', 'photos', 'changes', 'calendar', 'map', 'people'].indexOf(kind) >= 0 ? kind : 'notes'));
      pane.classList.add('active');
      if (kind === 'tree') { this.markView(); this.tree.render(); }
      if (kind === 'photos') this.renderPhotos();
      if (kind === 'changes') this.renderChanges();
      if (kind === 'calendar') this.renderCalendar(document.querySelector('#pane-calendar .pane-scroll'));
      if (kind === 'people') this.renderPeople();
      if (kind === 'map') this.renderMapPane();
      if (kind === 'notes') this.renderNotesTab(tab);
    },
    addTabDialog: function () {
      var self = this;
      this.modal('Новая вкладка',
        '<div class="row"><label for="ntTitle">Название</label><input id="ntTitle" placeholder="Например, «Документы»"></div>' +
        '<div class="row"><label for="ntKind">Что показывать</label><select id="ntKind">' +
        '<option value="notes">Свободные заметки</option>' +
        '<option value="calendar">Календарь дат</option>' +
        '<option value="map">Карта мест</option>' +
        '<option value="people">Список людей</option>' +
        '<option value="photos">Галерея</option>' +
        '<option value="changes">Журнал изменений</option>' +
        '</select></div>',
        [{ text: 'Добавить', primary: true, fn: function () {
          var title = document.getElementById('ntTitle').value.trim();
          var kind = document.getElementById('ntKind').value;
          if (!title) return;
          S.addTab(title, kind);
          self.closeModal();
          self.renderTabs();
        } }]);
    },

    /* ============ вкладка «Фото» ============ */
    renderPhotos: function () {
      var host = document.querySelector('#pane-photos .pane-scroll'), self = this;
      var all = S.allMedia().filter(function (m) { return m.kind === 'photo'; });
      if (!all.length) {
        host.innerHTML = '<div class="empty">Фотографий пока нет.<br>Откройте карточку человека и добавьте снимки — они соберутся здесь.</div>';
        return;
      }
      var order = this._photoSort || 'added';
      var sorters = {
        added: function (a, b) { return (b.added || '').localeCompare(a.added || ''); },
        person: function (a, b) {
          return S.fullName(S.person(a.personId)).localeCompare(S.fullName(S.person(b.personId)), 'ru');
        },
        name: function (a, b) { return (a.caption || a.name || '').localeCompare(b.caption || b.name || '', 'ru'); },
        size: function (a, b) { return (b.size || 0) - (a.size || 0); }
      };
      all = all.slice().sort(sorters[order] || sorters.added);
      var labels = [['added', 'по дате добавления'], ['person', 'по человеку'],
        ['name', 'по подписи'], ['size', 'по размеру']];
      host.innerHTML = '<h2 style="margin-bottom:4px">Фотографии</h2>' +
        '<p class="note" style="margin:0 0 10px">' + all.length + ' снимков' +
        (all.some(function (m) { return !S.canSee(m.acl); }) ? ' · часть скрыта правами доступа' : '') + '</p>' +
        '<div class="sort-bar"><span class="note">Порядок:</span>' +
        labels.map(function (l) {
          return '<button class="btn btn-sm" data-sort="' + l[0] + '" aria-pressed="' +
            (order === l[0]) + '">' + l[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="photo-wall">' + all.map(function (m) {
          var who = S.person(m.personId);
          return '<button class="media-tile" data-id="' + m.id + '" title="' + esc(m.name) + '">' +
            global.Icon(S.canSee(m.acl) ? 'photo' : 'lock') +
            '<span class="m-name">' + esc(who ? S.fullName(who) : m.name) + '</span></button>';
        }).join('') + '</div>';
      host.querySelectorAll('[data-sort]').forEach(function (b) {
        b.addEventListener('click', function () {
          self._photoSort = b.dataset.sort;
          self.renderPhotos();
        });
      });
      host.querySelectorAll('.media-tile').forEach(function (t) {
        var m = S.tree.media[t.dataset.id];
        t.addEventListener('click', function () { self.viewMedia(m.id); });
        if (!S.canSee(m.acl)) return;
        S.mediaURL(m.id).then(function (url) {
          if (!url) return;
          self._mediaUrls.push(url);
          t.style.backgroundImage = 'url(' + url + ')';
          var ic1 = t.querySelector('.ico');
          if (ic1) ic1.remove();
        });
      });
    },

    /* ============ вкладка «Изменения» ============ */
    renderChanges: function () {
      var host = document.querySelector('#pane-changes .pane-scroll'), self = this;
      var ch = S.tree.changes || [];
      var canEdit = S.isAdmin();
      if (!ch.length) {
        host.innerHTML = '<h2 style="margin-bottom:4px">Изменения</h2>' +
          '<div class="empty">Журнал пуст</div>';
        return;
      }
      var kinds = { add: 'добавление', edit: 'правка', delete: 'удаление', media: 'файл',
        user: 'доступ', tab: 'вкладка', import: 'загрузка' };
      var cols = [
        { key: 'ts', title: 'Когда', num: true,
          get: function (c) { return Date.parse(c.ts || '') || 0; },
          cell: function (c) { return new Date(c.ts).toLocaleString('ru-RU'); } },
        { key: 'user', title: 'Кто', get: function (c) { return c.user || ''; },
          cell: function (c) { return esc(c.user || '—'); } },
        { key: 'action', title: 'Что', get: function (c) { return kinds[c.action] || c.action || ''; },
          cell: function (c) {
            return '<span class="chip ' + esc(c.action) + '">' + esc(kinds[c.action] || c.action) + '</span>';
          } },
        { key: 'summary', title: 'Подробности', get: function (c) { return c.summary || ''; },
          cell: function (c) { return esc(c.summary || ''); } }
      ];
      if (canEdit) {
        cols.push({ key: 'del', title: '', sortable: false, get: function () { return 0; },
          cell: function (c) {
            return '<button class="c-del" data-del="' + esc(c.id) + '" type="button" ' +
              'title="Убрать эту строку" aria-label="Убрать эту строку">' + global.Icon('trash') + '</button>';
          } });
      }

      function draw() {
        var list = (S.tree.changes || []).slice(0, 500);
        var t = self.buildTable('tblChanges', cols, list, { key: 'ts', dir: -1 });
        host.innerHTML = '<h2 style="margin-bottom:4px">Изменения</h2>' +
          '<p class="note" style="margin:0 0 12px">Кто и когда что поправил. Записей: ' +
          (S.tree.changes || []).length +
          '. Заголовки столбцов сортируют список' +
          (canEdit ? '; лишние строки можно убрать — на сами данные это не влияет.' : '.') + '</p>' +
          (canEdit ? '<div class="btn-row" style="margin:0 0 12px">' +
            '<button class="btn btn-sm btn-danger" id="chClear">Очистить журнал целиком</button></div>' : '') +
          t.html +
          ((S.tree.changes || []).length > 500
            ? '<p class="note" style="margin-top:10px">Показаны последние 500 записей.</p>' : '');
        self.bindTable('tblChanges', draw);
        host.querySelectorAll('[data-del]').forEach(function (b) {
          b.addEventListener('click', function () {
            S.tree.changes = (S.tree.changes || []).filter(function (c) { return c.id !== b.dataset.del; });
            S.save(true);
            draw();
            bindClear();
          });
        });
        bindClear();
      }
      draw();
      return;

      function bindClear() {
        var clr = document.getElementById('chClear');
        if (clr) clr.addEventListener('click', function () {
          self.confirm('Очистить журнал изменений?',
            'Пропадёт только история правок — люди, фотографии и связи останутся на месте. ' +
            'У других родственников журнал восстановится при следующей синхронизации с их устройств.',
            function () {
              S.tree.changes = [];
              S.save(true);
              self.renderChanges();
              self.toast('Журнал очищен');
            });
        });
      }
    },

    /* ============ сортируемая таблица ============
       cols: [{ key, title, get(row), cell(row), num }]
       Запоминает выбранный столбец отдельно для каждой таблицы. */
    sortState: {},
    buildTable: function (tableId, cols, rows, opts) {
      opts = opts || {};
      var st = this.sortState[tableId] || (this.sortState[tableId] = {
        key: opts.key || cols[0].key, dir: opts.dir || 1
      });
      var col = cols.filter(function (c) { return c.key === st.key; })[0] || cols[0];
      var sorted = rows.slice().sort(function (a, b) {
        var x = col.get(a), y = col.get(b);
        if (x == null) x = col.num ? -Infinity : '';
        if (y == null) y = col.num ? -Infinity : '';
        var r = col.num ? (x - y) : String(x).localeCompare(String(y), 'ru');
        return r * st.dir;
      });
      var head = cols.map(function (c) {
        var on = c.key === st.key;
        return '<th' + (c.sortable === false ? '' : ' class="sortable" data-sort="' + c.key + '"') +
          (on ? ' aria-sort="' + (st.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' +
          esc(c.title) +
          (c.sortable === false ? '' : '<span class="sort-mark">' + (on ? (st.dir > 0 ? '▲' : '▼') : '⇅') + '</span>') +
          '</th>';
      }).join('');
      var body = sorted.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          return '<td' + (c.num ? ' style="font-variant-numeric:tabular-nums"' : '') + '>' + c.cell(r) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return { html: '<div class="table-wrap"><table class="data" id="' + tableId + '"><thead><tr>' +
        head + '</tr></thead><tbody>' + body + '</tbody></table></div>', rows: sorted };
    },
    bindTable: function (tableId, redraw) {
      var self = this, t = document.getElementById(tableId);
      if (!t) return;
      t.querySelectorAll('[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var st = self.sortState[tableId];
          if (st.key === th.dataset.sort) st.dir = -st.dir;
          else { st.key = th.dataset.sort; st.dir = 1; }
          redraw();
        });
      });
    },

    /* ============ список людей ============ */
    renderPeople: function () {
      var host = document.querySelector('#pane-people .pane-scroll'), self = this;
      var ps = S.persons();
      var cols = [
        { key: 'name', title: 'Имя', get: function (p) { return S.fullName(p); },
          cell: function (p) { return esc(S.fullName(p)); } },
        { key: 'sex', title: 'Пол', get: function (p) { return p.sex === 'M' ? 'Мужской' : p.sex === 'F' ? 'Женский' : 'Не указан'; },
          cell: function (p) { return p.sex === 'M' ? 'М' : p.sex === 'F' ? 'Ж' : '—'; } },
        { key: 'birth', title: 'Рождение', num: true,
          get: function (p) { return +(U.yr(p.birth && p.birth.date) || 0); },
          cell: function (p) { return esc(U.formatDate(p.birth && p.birth.date) || '—'); } },
        { key: 'death', title: 'Смерть', num: true,
          get: function (p) { return +(U.yr(p.death && p.death.date) || 0); },
          cell: function (p) { return esc(U.formatDate(p.death && p.death.date) || '—'); } },
        { key: 'place', title: 'Место рождения', get: function (p) { return (p.birth && p.birth.place) || ''; },
          cell: function (p) { return esc((p.birth && p.birth.place) || '—'); } },
        { key: 'media', title: 'Файлов', num: true, get: function (p) { return (p.media || []).length; },
          cell: function (p) { return (p.media || []).length || '—'; } },
        { key: 'updated', title: 'Изменено', num: true,
          get: function (p) { return Date.parse(p.updated || '') || 0; },
          cell: function (p) { return p.updated ? new Date(p.updated).toLocaleString('ru-RU') : '—'; } },
        { key: 'open', title: '', sortable: false, get: function () { return 0; },
          cell: function (p) { return '<button class="btn btn-sm" data-id="' + p.id + '">Открыть</button>'; } }
      ];
      function draw() {
        var t = self.buildTable('tblPeople', cols, ps, { key: 'name' });
        host.innerHTML = '<h2 style="margin-bottom:4px">Люди в дереве — ' + ps.length + '</h2>' +
          '<p class="note" style="margin:0 0 12px">Нажмите на заголовок столбца, чтобы отсортировать. ' +
          'Повторное нажатие переворачивает порядок.</p>' + t.html;
        self.bindTable('tblPeople', draw);
        host.querySelectorAll('[data-id]').forEach(function (b) {
          b.addEventListener('click', function () {
            self.showTab('tree'); self.tree.setFocus(b.dataset.id); self.sheet.open(b.dataset.id);
          });
        });
      }
      draw();
    },

    /* ============ заметки на своей вкладке ============ */
    renderNotesTab: function (tab) {
      var host = document.querySelector('#pane-notes .pane-scroll');
      host.innerHTML = '<h2 style="margin-bottom:10px">' + esc(tab.title) + '</h2>' +
        '<textarea id="tabNotes" style="width:100%;min-height:50vh;padding:12px;border:1px solid var(--line);' +
        'border-radius:12px;background:var(--paper-2);outline:none" placeholder="Записи, черновики, список того, что надо уточнить…">' +
        esc(tab.content || '') + '</textarea>' +
        '<div class="btn-row"><button class="btn btn-sm" id="tabNoteMic">' +
        global.Icon('mic') + ' Надиктовать</button>' +
        '<span class="note" id="tabNoteSaved" style="align-self:center"></span></div>';
      var ta = document.getElementById('tabNotes'), self = this;
      ta.addEventListener('input', function () {
        tab.content = ta.value;
        S.save(true);
        document.getElementById('tabNoteSaved').textContent = 'сохранено';
      });
      document.getElementById('tabNoteMic').addEventListener('click', function () {
        var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
        if (!SR) { self.toast('Голосовой ввод недоступен'); return; }
        var rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = false;
        var btn = this; btn.classList.add('rec');
        rec.onresult = function (e) {
          ta.value += (ta.value ? '\n' : '') + e.results[0][0].transcript;
          tab.content = ta.value; S.save(true);
        };
        rec.onend = function () { btn.classList.remove('rec'); };
        try { rec.start(); } catch (err) { btn.classList.remove('rec'); }
      });
    },

    /* ============ календарь ============ */
    openCalendar: function () {
      var self = this;
      this.modal('Ближайшие даты', '<div id="calHost"></div>', []);
      this.renderCalendar(document.getElementById('calHost'));
    },
    renderCalendar: function (host) {
      if (!host) return;
      var up = S.upcoming(120);
      if (!up.length) { host.innerHTML = '<div class="empty">Дат пока не задано</div>'; return; }
      var kinds = { birth: 'день рождения', memory: 'день памяти' };
      host.innerHTML = '<p class="note" style="margin:0 0 12px">Что ждёт нас в ближайшие четыре месяца. ' +
        'Разрешите уведомления, и программа напомнит за день.</p>' +
        '<div class="btn-row" style="margin:0 0 12px"><button class="btn btn-sm" id="calNotify">Включить напоминания</button></div>' +
        up.map(function (e) {
          var when = e.in === 0 ? 'сегодня' : e.in === 1 ? 'завтра' : 'через ' + e.in + ' дн.';
          return '<div class="cal-day"><div class="cal-when"><b>' + e.date.getDate() + '</b>' +
            e.date.toLocaleDateString('ru-RU', { month: 'short' }) + '</div>' +
            '<div class="li-main"><div>' + esc(S.fullName(e.person)) + '</div>' +
            '<div class="li-sub">' + esc(kinds[e.kind] || e.kind) +
            (e.age ? ' · ' + e.age + ' лет' : '') + '</div></div>' +
            '<span class="chip' + (e.in <= 3 ? ' cal-soon' : '') + '">' + when + '</span></div>';
        }).join('');
      var btn = document.getElementById('calNotify');
      if (btn) btn.addEventListener('click', function () {
        if (!global.Notification) { App.toast('Уведомления недоступны'); return; }
        Notification.requestPermission().then(function (p) {
          App.toast(p === 'granted' ? 'Напоминания включены' : 'Разрешение не получено');
          if (p === 'granted') App.scheduleReminders();
        });
      });
    },
    scheduleReminders: function () {
      if (!global.Notification || Notification.permission !== 'granted') return;
      var today = S.upcoming(1);
      today.forEach(function (e) {
        if (e.in > 1) return;
        try {
          new Notification(e.kind === 'birth' ? 'День рождения' : 'Памятная дата', {
            body: S.fullName(e.person) + (e.in === 0 ? ' — сегодня' : ' — завтра'),
            tag: 'drevo-' + e.person.id + '-' + e.date.toDateString()
          });
        } catch (err) {}
      });
    },

    /* ============ карта ============ */
    openMap: function () {
      var self = this;
      this.modal('Карта мест', '<div id="mapModalHost" style="height:58vh;position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--line)"></div>' +
        '<p class="note" style="margin-top:10px">Точки берутся из координат, указанных в карточках: место рождения, смерти и событий.</p>', []);
      var m = new global.MiniMap(document.getElementById('mapModalHost'));
      m.setPins(this.pins());
      m.fit();
    },
    renderMapPane: function () {
      var host = document.getElementById('mapCanvas');
      if (!this.map) this.map = new global.MiniMap(host);
      var pins = this.pins();
      this.map.setPins(pins);
      if (pins.length) this.map.fit(); else this.map.draw();
      var self = this;
      this.map.onPin = function (p) {
        self.showTab('tree');
        self.tree.setFocus(p.personId);
        self.sheet.open(p.personId);
      };
    },
    pins: function () {
      return S.places().map(function (x) {
        return {
          lat: x.lat, lng: x.lng, kind: x.kind, place: x.place, personId: x.person.id,
          label: S.fullName(x.person) + ' — ' + (x.kind === 'birth' ? 'рождение' : x.kind === 'death' ? 'смерть' : x.kind)
        };
      });
    },

    /* ============ новая персона ============ */
    addPerson: function () {
      var self = this;
      var near = this.tree && S.person(this.tree.focusId) ? S.person(this.tree.focusId) : null;
      var relBlock = '';
      if (near) {
        relBlock =
          '<div class="row"><label for="npRel">Это</label><select id="npRel">' +
          '<option value="">Сам по себе, без связи</option>' +
          '<option value="child">Сын или дочь ' + esc(S.callName(near)) + '</option>' +
          '<option value="spouse">Муж или жена ' + esc(S.callName(near)) + '</option>' +
          '<option value="parent">Отец или мать ' + esc(S.callName(near)) + '</option>' +
          '<option value="sibling">Брат или сестра ' + esc(S.callName(near)) + '</option>' +
          '</select></div>';
      }
      this.modal('Новый человек',
        '<div class="row"><label for="npSur">Фамилия</label><input id="npSur" autocomplete="off"></div>' +
        '<div class="row"><label for="npGiv">Имя</label><input id="npGiv" autocomplete="off"></div>' +
        '<div class="row"><label for="npPat">Отчество</label><input id="npPat" autocomplete="off"></div>' +
        '<div class="row"><label for="npSex">Пол</label><select id="npSex">' +
        '<option value="M">Мужской</option><option value="F">Женский</option>' +
        '<option value="U">Не указан</option></select></div>' +
        '<div class="row"><label for="npBirth">Дата рождения</label><input id="npBirth" type="date"></div>' +
        '<div class="row"><label for="npPlace">Место рождения</label><input id="npPlace" autocomplete="off"></div>' +
        relBlock +
        '<p class="note">Заполнять всё сразу не нужно — остальное допишете в карточке.</p>',
        [{ text: 'Добавить', primary: true, fn: function () {
          var giv = document.getElementById('npGiv').value.trim();
          var sur = document.getElementById('npSur').value.trim();
          if (!giv && !sur) { self.toast('Укажите хотя бы имя или фамилию'); return; }
          var np = S.addPerson({
            surname: sur, given: giv,
            patronymic: document.getElementById('npPat').value.trim(),
            sex: document.getElementById('npSex').value,
            birth: {
              date: document.getElementById('npBirth').value,
              place: document.getElementById('npPlace').value.trim(),
              lat: null, lng: null
            }
          });
          var rel = near && document.getElementById('npRel') ? document.getElementById('npRel').value : '';
          if (rel === 'child') S.linkChild(near.id, np.id);
          else if (rel === 'spouse') S.linkSpouse(near.id, np.id);
          else if (rel === 'parent') S.linkParent(near.id, np.id);
          else if (rel === 'sibling') {
            var f = S.childFamily(near.id) || S.addFamily({ children: [near.id] });
            f.children.push(np.id);
            S.save();
          }
          self.closeModal();
          self.tree.setFocus(np.id);
          self.renderTabs();
          self.sheet.open(np.id);
          setTimeout(function () { self.tree.fit(true); }, 40);
        } }]);
      setTimeout(function () {
        var el = document.getElementById('npSur');
        if (el) el.focus();
      }, 50);
    },

    /* ============ родственники ============ */
    addRelative: function (id) {
      var p = S.person(id), self = this;
      var who = S.callName(p);
      // Формулировка от лица НОВОГО человека: «Ребёнок Петра», а не просто «Ребёнок».
      // Иначе читается наоборот — и связь получается зеркальной.
      this.modal('Родственник для ' + who,
        '<p class="note" style="margin:0 0 12px">Новый человек — кто он для ' + esc(who) + '?</p>' +
        '<div class="row"><label for="arRel">Это</label><select id="arRel">' +
        '<option value="child">Сын или дочь ' + esc(who) + '</option>' +
        '<option value="spouse">Муж или жена ' + esc(who) + '</option>' +
        '<option value="parent">Отец или мать ' + esc(who) + '</option>' +
        '<option value="sibling">Брат или сестра ' + esc(who) + '</option>' +
        '</select></div>' +
        '<div class="row"><label for="arSur">Фамилия</label><input id="arSur" value="' + esc(p.surname) + '"></div>' +
        '<div class="row"><label for="arGiv">Имя</label><input id="arGiv"></div>' +
        '<div class="row"><label for="arPat">Отчество</label><input id="arPat"></div>' +
        '<div class="row"><label for="arSex">Пол</label><select id="arSex">' +
        '<option value="M">Мужской</option><option value="F">Женский</option><option value="U">Не указан</option></select></div>' +
        '<div class="row"><label for="arBirth">Дата рождения</label><input id="arBirth" type="date"></div>' +
        '<p class="note" id="arHint"></p>',
        [{ text: 'Добавить', primary: true, fn: function () {
          var rel = document.getElementById('arRel').value;
          var np = S.addPerson({
            surname: document.getElementById('arSur').value.trim(),
            given: document.getElementById('arGiv').value.trim(),
            patronymic: document.getElementById('arPat').value.trim(),
            sex: document.getElementById('arSex').value,
            birth: { date: document.getElementById('arBirth').value, place: '', lat: null, lng: null }
          });
          if (rel === 'child') S.linkChild(id, np.id);
          else if (rel === 'spouse') S.linkSpouse(id, np.id);
          else if (rel === 'parent') S.linkParent(id, np.id);
          else if (rel === 'sibling') {
            var f = S.childFamily(id);
            if (!f) { f = S.addFamily({ children: [id] }); }
            f.children.push(np.id);
            S.save();
          }
          self.closeModal();
          self.tree.render();
          self.sheet.open(np.id);
        } }]);
      var relSel = document.getElementById('arRel');
      var hint = document.getElementById('arHint');
      function sayHint() {
        var giv = (document.getElementById('arGiv').value || '').trim() || 'новый человек';
        var map = {
          child: giv + ' станет ребёнком, а ' + who + ' — родителем.',
          spouse: giv + ' и ' + who + ' станут супругами.',
          parent: giv + ' станет родителем, а ' + who + ' — ребёнком.',
          sibling: giv + ' и ' + who + ' станут братом и сестрой — у них будут общие родители.'
        };
        hint.textContent = map[relSel.value] || '';
      }
      relSel.addEventListener('change', function () {
        var sur = document.getElementById('arSur');
        if (relSel.value === 'spouse') sur.value = '';
        else sur.value = p.surname || '';
        sayHint();
      });
      document.getElementById('arGiv').addEventListener('input', sayHint);
      sayHint();
      setTimeout(function () {
        var el = document.getElementById('arGiv');
        if (el) el.focus();
      }, 50);
    },

    /** Кому открыта запись: отмечаем конкретных родственников. */
    pickViewers: function (acl, onDone) {
      var self = this;
      acl.allow = acl.allow || [];
      var others = S.users.filter(function (u) { return u.role !== 'admin'; });
      var admins = S.users.filter(function (u) { return u.role === 'admin'; });

      if (!others.length) {
        this.modal('Кому открыть запись',
          '<p class="note">Кроме администраторов, в дереве пока никого нет. ' +
          'Пригласите родственников — <b>Настройки → Доступ и защита → Пригласить родственника</b>, ' +
          'и они появятся в этом списке.</p>' +
          (admins.length ? '<p class="note">Администраторы видят всё и так: ' +
            esc(admins.map(function (u) { return u.displayName; }).join(', ')) + '.</p>' : ''),
          []);
        return;
      }

      var chosen = {};
      acl.allow.forEach(function (id) { chosen[id] = true; });

      this.modal('Кому открыть запись',
        '<p class="note" style="margin:0 0 12px">Отметьте тех, кому эта запись будет видна. ' +
        'Остальные её не увидят. Администраторы видят всё независимо от отметок.</p>' +
        '<div class="viewer-list" id="vwList">' +
        others.map(function (u) {
          return '<label class="viewer-row"><input type="checkbox" data-u="' + esc(u.id) + '"' +
            (chosen[u.id] ? ' checked' : '') + '>' +
            '<span class="mini-ph">' + global.Icon('person') + '</span>' +
            '<span class="li-main"><span>' + esc(u.displayName) + '</span>' +
            '<span class="li-sub">' + esc(u.login) + '</span></span></label>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn btn-sm" id="vwAll">Отметить всех</button>' +
        '<button class="btn btn-sm" id="vwNone">Снять все</button></div>' +
        (admins.length ? '<p class="note" style="margin-top:10px">Видят всегда: ' +
          esc(admins.map(function (u) { return u.displayName; }).join(', ')) + '.</p>' : ''),
        [{ text: 'Готово', primary: true, fn: function () {
          var list = [];
          document.querySelectorAll('#vwList [data-u]').forEach(function (c) {
            if (c.checked) list.push(c.dataset.u);
          });
          acl.allow = list;
          self.closeModal();
          if (onDone) onDone(list);
        } }]);

      document.getElementById('vwAll').addEventListener('click', function () {
        document.querySelectorAll('#vwList [data-u]').forEach(function (c) { c.checked = true; });
      });
      document.getElementById('vwNone').addEventListener('click', function () {
        document.querySelectorAll('#vwList [data-u]').forEach(function (c) { c.checked = false; });
      });
    },

    /* ============ медиа ============ */
    pickFiles: function (cb) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true;
      inp.accept = 'image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.rtf';
      inp.addEventListener('change', function () { if (inp.files.length) cb(inp.files); });
      inp.click();
    },
    /** Спросить, кому будут видны добавляемые файлы. */
    askAccess: function (cb, acl) {
      var self = this;
      acl = acl || { level: 'public', locked: false, allow: [] };

      this.modal('Кому показывать эти файлы?',
        '<div class="row"><label for="acLevel">Видимость</label>' +
        '<div class="acl-ctl"><select id="acLevel">' +
        global.ACL_LEVELS.map(function (l) {
          return '<option value="' + l.v + '"' + (acl.level === l.v ? ' selected' : '') + '>' + l.t + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-sm" id="acWho" hidden>' + global.Icon('person') + ' Выбрать</button>' +
        '</div><span class="note acl-names" id="acNames"></span></div>' +
        '<label class="inline"><input type="checkbox" id="acLock"' + (acl.locked ? ' checked' : '') +
        '> <span>Замок: шифровать файл при хранении и в резервной копии</span></label>' +
        '<p class="note" style="margin-top:10px">Зашифрованные файлы открываются только после входа ' +
        'с паролем дерева. Если пароль утерян, восстановить их невозможно.</p>',
        [{ text: 'Добавить', primary: true, fn: function () {
          acl.level = document.getElementById('acLevel').value;
          acl.locked = document.getElementById('acLock').checked;
          self.closeModal();
          cb(acl);
        } }]);

      var lvl = document.getElementById('acLevel');
      var who = document.getElementById('acWho');
      var names = document.getElementById('acNames');
      function paint() {
        who.hidden = lvl.value !== 'chosen';
        names.textContent = lvl.value === 'chosen'
          ? (S.allowedNames(acl).join(', ') || 'пока никто не отмечен') : '';
      }
      lvl.addEventListener('change', function () { acl.level = lvl.value; paint(); });
      who.addEventListener('click', function () {
        acl.level = lvl.value;
        acl.locked = document.getElementById('acLock').checked;
        // выбор людей идёт отдельным окном, затем возвращаемся сюда
        self.pickViewers(acl, function () { self.askAccess(cb, acl); });
      });
      paint();
    },

    viewMedia: function (id, sheet) {
      var m = S.tree.media[id], self = this;
      if (!m) return;
      if (!S.canSee(m.acl)) { this.toast('Файл закрыт правами доступа'); return; }
      var who = S.person(m.personId);
      this.modal(m.caption || m.name,
        '<div id="mvBody" class="empty">Открываем…</div>' +
        '<div class="row" style="margin-top:12px"><label for="mvCap">Подпись</label><input id="mvCap" value="' + esc(m.caption) + '"></div>' +
        '<div class="row"><label for="mvAcl">Видимость</label>' +
        '<div class="acl-ctl"><select id="mvAcl">' +
        global.ACL_LEVELS.map(function (l) {
          return '<option value="' + l.v + '"' + (m.acl.level === l.v ? ' selected' : '') + '>' + l.t + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-sm" id="mvWho"' + (m.acl.level === 'chosen' ? '' : ' hidden') + '>' +
        global.Icon('person') + ' Выбрать</button></div>' +
        '<span class="note acl-names" id="mvNames">' +
        (m.acl.level === 'chosen' ? esc(S.allowedNames(m.acl).join(', ') || 'пока никто не отмечен') : '') +
        '</span></div>' +
        '<p class="note">' + esc(who ? S.fullName(who) : '') + ' · ' + Math.round((m.size || 0) / 1024) + ' КБ' +
        (m.encrypted ? ' · зашифрован' : '') + '</p>',
        [
          { text: 'Сделать главным фото', fn: function () {
            if (m.kind !== 'photo') { self.toast('Главным может быть только снимок'); return; }
            S.updatePerson(m.personId, { photo: m.id });
            self.closeModal(); self.tree.render();
            if (sheet) sheet.render();
          } },
          { text: 'Удалить', danger: true, fn: function () {
            S.removeMedia(m.id);
            self.closeModal();
            if (sheet) sheet.render();
            self.tree.render();
            if (self.activeTab !== 'tree') self.showTab(self.activeTab);
          } },
          { text: 'Готово', primary: true, fn: function () {
            m.caption = document.getElementById('mvCap').value;
            m.acl.level = document.getElementById('mvAcl').value;
            S.save();
            self.closeModal();
            if (sheet) sheet.renderBody();
          } }
        ]);
      var mvLvl = document.getElementById('mvAcl');
      var mvWho = document.getElementById('mvWho');
      mvLvl.addEventListener('change', function () {
        m.acl.level = mvLvl.value;
        mvWho.hidden = mvLvl.value !== 'chosen';
        document.getElementById('mvNames').textContent = mvLvl.value === 'chosen'
          ? (S.allowedNames(m.acl).join(', ') || 'пока никто не отмечен') : '';
      });
      mvWho.addEventListener('click', function () {
        m.acl.allow = m.acl.allow || [];
        self.pickViewers(m.acl, function () {
          S.save();
          self.viewMedia(id, sheet);
        });
      });

      S.mediaURL(id).then(function (url) {
        var body = document.getElementById('mvBody');
        if (!body) return;
        if (!url) { body.textContent = 'Файл не открылся'; return; }
        self._mediaUrls.push(url);
        body.classList.remove('empty');
        if (m.kind === 'photo') body.innerHTML = '<img src="' + url + '" alt="" style="width:100%;border-radius:10px">';
        else if (m.kind === 'audio') body.innerHTML = '<audio controls src="' + url + '" style="width:100%"></audio>';
        else if (m.kind === 'video') body.innerHTML = '<video controls src="' + url + '" style="width:100%;border-radius:10px"></video>';
        else body.innerHTML = '<p class="note">Документ «' + esc(m.name) + '». Скачайте его из резервной копии или откройте в своей программе.</p>';
      });
    },

    /* ============ настройки ============ */
    openSettings: function (which) {
      var self = this;
      var p = S.prefs;
      var tabs = [['look', 'Оформление'], ['sync', 'Синхронизация'], ['data', 'Данные'],
        ['sec', 'Доступ и защита'], ['about', 'О программе']];
      which = which || 'look';
      var html =
        '<div class="sheet-tabs" id="setTabs">' +
        tabs.map(function (t) {
          return '<button data-s="' + t[0] + '" aria-selected="' + (t[0] === which) + '">' + t[1] + '</button>';
        }).join('') + '</div><div id="setBody"></div>';
      this.modal('Настройки', html, [], { wide: true });
      document.getElementById('setTabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-s]');
        if (!b) return;
        document.querySelectorAll('#setTabs [data-s]').forEach(function (x) {
          x.setAttribute('aria-selected', x === b ? 'true' : 'false');
        });
        self.setPane(b.dataset.s);
      });
      this.setPane(which);
    },
    setPane: function (which) {
      var host = document.getElementById('setBody'), self = this, p = S.prefs;
      if (which === 'look') {
        var bgList = ['auto', '#f6f1e6', '#ffffff', '#eef3f7', '#eef5ee', '#f6eef2', '#2a2622', '#1a1714'];
        host.innerHTML =
          '<div class="set-sticky"><div class="set-card"><h3>Как это выглядит</h3>' +
          '<div class="preview-stage" id="stStage"></div>' +
          '<p class="preview-hint">Образец меняется сразу — двигайте ползунки и смотрите.</p>' +
          '</div></div>' +

          '<div class="set-grid-2">' +
          '<div class="set-card"><h3>Тема</h3>' +
          '<div class="set-row"><span>Оформление</span><select id="stTheme">' +
          ['auto:Как в системе', 'light:Светлая', 'dark:Тёмная'].map(function (x) {
            var v = x.split(':');
            return '<option value="' + v[0] + '"' + (p.theme === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
          }).join('') + '</select></div>' +
          '<div class="set-row"><span>Цвет выделения</span><div class="swatches" id="stAccent">' +
          ['#2f7fb8', '#3f7d5a', '#9a4f2a', '#6b4f96', '#a9741f', '#9c3b52'].map(function (c) {
            return '<button class="swatch" style="background:' + c + '" data-c="' + c + '" aria-pressed="' +
              (p.accent === c) + '" title="' + c + '"></button>';
          }).join('') + '</div></div>' +
          '<div class="set-row"><span>Цвет фона древа</span><div class="color-pick">' +
          '<div class="swatches" id="stBg">' +
          bgList.map(function (c) {
            var style = c === 'auto'
              ? 'background:linear-gradient(135deg,var(--paper) 50%,var(--paper-2) 50%)'
              : 'background:' + c;
            return '<button class="swatch" style="' + style + '" data-c="' + c + '" aria-pressed="' +
              (p.treeBg === c) + '" title="' + (c === 'auto' ? 'Как у страницы' : c) + '"></button>';
          }).join('') + '</div>' +
          '<input type="color" id="stBgPick" value="' +
          (p.treeBg && p.treeBg !== 'auto' ? p.treeBg : '#f6f1e6') + '" title="Свой цвет">' +
          '</div></div>' +
          '<div class="set-row"><span>Сетка из точек на полотне</span>' +
          '<input type="checkbox" id="stGrid"' + (p.treeGrid ? ' checked' : '') + '></div>' +
          '<div class="set-row"><span>Картинка под деревом</span><span class="inline">' +
          '<button class="btn btn-sm" id="stBgImg">' + global.Icon('upload') +
          (p.treeImage ? ' Заменить' : ' Загрузить') + '</button>' +
          (p.treeImage ? '<button class="btn btn-sm btn-danger" id="stBgImgOff">Убрать</button>' : '') +
          '</span></div>' +
          (p.treeImage ?
            '<div class="set-row"><span>Как разместить</span><select id="stBgFit">' +
            ['cover:Во весь экран', 'tile:Плиткой'].map(function (x) {
              var v = x.split(':');
              return '<option value="' + v[0] + '"' +
                (p.treeImageFit === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
            }).join('') + '</select></div>' +
            rng('Приглушить картинку', 'stBgFade', 0, 90, p.treeImageFade == null ? 35 : p.treeImageFade, '%')
            : '') +
          rng('Размер текста в программе', 'stUi', 11, 20, p.ui.fontSize, 'px') +
          rng('Размер текста вкладок', 'stTab', 11, 20, p.ui.tabSize, 'px') +
          rng('Размер значков в панели', 'stIcon', 13, 30, p.ui.iconSize || 17, 'px') +
          '</div>' +

          '<div class="set-card"><h3>Окошки людей в дереве</h3>' +
          '<div class="set-row"><span>Форма</span><select id="stShape">' +
          ['rounded:Скруглённый прямоугольник', 'circle:Капсула'].map(function (x) {
            var v = x.split(':');
            return '<option value="' + v[0] + '"' + (p.card.shape === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
          }).join('') + '</select></div>' +
          rng('Скругление углов', 'stRadius', 0, 36, p.card.radius, 'px') +
          rng('Ширина окошка', 'stW', 110, 300, p.card.w, 'px') +
          rng('Высота окошка', 'stH', 50, 150, p.card.h, 'px') +
          rng('Размер фотокарточки', 'stPhoto', 0, 90, p.card.photo, 'px') +
          rng('Размер имени', 'stName', 9, 20, p.card.nameSize, 'px') +
          rng('Размер дат', 'stDate', 8, 18, p.card.dateSize, 'px') +
          '<div class="set-row"><span>Жирность дат</span><select id="stDateW">' +
          ['400:Обычная', '600:Полужирная', '700:Жирная'].map(function (x) {
            var v = x.split(':');
            return '<option value="' + v[0] + '"' +
              (String(p.card.dateWeight || 400) === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
          }).join('') + '</select></div>' +
          '<div class="set-row"><span>Показывать фото</span><input type="checkbox" id="stShowPh"' + (p.showPhotos ? ' checked' : '') + '></div>' +
          '<div class="set-row"><span>Показывать годы</span><input type="checkbox" id="stShowDt"' + (p.showDates ? ' checked' : '') + '></div>' +
          '<p class="note">Настройки оформления сохраняются отдельно для каждого пользователя — ' +
          'у остальных членов семьи дерево останется таким, каким они его настроили.</p></div>' +
          '</div>';

        bindRange('stUi', function (v) { p.ui.fontSize = v; });
        bindRange('stTab', function (v) { p.ui.tabSize = v; });
        bindRange('stIcon', function (v) { p.ui.iconSize = v; });
        bindRange('stRadius', function (v) { p.card.radius = v; });
        bindRange('stW', function (v) { p.card.w = v; });
        bindRange('stH', function (v) { p.card.h = v; });
        bindRange('stPhoto', function (v) { p.card.photo = v; });
        bindRange('stName', function (v) { p.card.nameSize = v; });
        bindRange('stDate', function (v) { p.card.dateSize = v; });
        document.getElementById('stShape').addEventListener('change', function () { p.card.shape = this.value; apply(); });
        document.getElementById('stDateW').addEventListener('change', function () { p.card.dateWeight = +this.value; apply(); });
        document.getElementById('stTheme').addEventListener('change', function () { p.theme = this.value; apply(); });
        document.getElementById('stGrid').addEventListener('change', function () { p.treeGrid = this.checked; apply(); });
        document.getElementById('stBgImg').addEventListener('click', function () {
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.addEventListener('change', function () {
            if (!inp.files[0]) return;
            if (inp.files[0].size > 12 * 1024 * 1024) {
              self.toast('Картинка тяжелее 12 МБ — возьмите поменьше');
              return;
            }
            self.setTreeImage(inp.files[0]).then(function () { self.setPane('look'); });
          });
          inp.click();
        });
        var bgOff = document.getElementById('stBgImgOff');
        if (bgOff) bgOff.addEventListener('click', function () {
          self.clearTreeImage();
          self.setPane('look');
        });
        var bgFit = document.getElementById('stBgFit');
        if (bgFit) bgFit.addEventListener('change', function () { p.treeImageFit = this.value; apply(); });
        var bgFade = document.getElementById('stBgFade');
        if (bgFade) bindRange('stBgFade', function (v) { p.treeImageFade = v; });
        document.getElementById('stShowPh').addEventListener('change', function () { p.showPhotos = this.checked; apply(); });
        document.getElementById('stShowDt').addEventListener('change', function () { p.showDates = this.checked; apply(); });
        document.getElementById('stAccent').addEventListener('click', function (e) {
          var b = e.target.closest('[data-c]');
          if (!b) return;
          p.accent = b.dataset.c;
          document.querySelectorAll('#stAccent .swatch').forEach(function (s) {
            s.setAttribute('aria-pressed', s.dataset.c === p.accent ? 'true' : 'false');
          });
          apply();
        });
        document.getElementById('stBg').addEventListener('click', function (e) {
          var b = e.target.closest('[data-c]');
          if (!b) return;
          p.treeBg = b.dataset.c;
          markBg();
          apply();
        });
        document.getElementById('stBgPick').addEventListener('input', function () {
          p.treeBg = this.value;
          markBg();
          apply();
        });
        function markBg() {
          document.querySelectorAll('#stBg .swatch').forEach(function (s) {
            s.setAttribute('aria-pressed', s.dataset.c === p.treeBg ? 'true' : 'false');
          });
        }
        function bindRange(id, fn) {
          var el = document.getElementById(id);
          el.addEventListener('input', function () {
            el.nextElementSibling.value = el.value + ' ' + (el.dataset.unit || 'px');
            fn(+el.value); apply();
          });
        }
        function apply() {
          S.savePrefs();
          self.applyPrefs();
          self.paintPreview();
          if (self.tree) self.tree.render();
        }
        this.paintPreview();

      } else if (which === 'sync') {
        this.syncPane(host);

      } else if (which === 'data') {
        host.innerHTML =
          '<div class="set-card"><h3>Название дерева</h3>' +
          '<div class="inline"><input id="stTreeName" value="' + esc(S.tree.meta.name) + '">' +
          '<button class="btn btn-sm" id="stRename">Сохранить</button></div></div>' +
          '<div class="set-card"><h3>Сохранить копию</h3>' +
          '<p class="note">Полный архив: дерево в GEDCOM, схема в SVG, все фотографии и файлы. ' +
          'Записи с замком попадают в архив зашифрованными.</p>' +
          '<div class="btn-row">' +
          '<button class="btn btn-primary btn-sm" id="exBackup">Полная копия (ZIP)</button>' +
          '<button class="btn btn-sm" id="exGed">GEDCOM</button>' +
          '<button class="btn btn-sm" id="exSvg">Схема SVG</button>' +
          '<button class="btn btn-sm" id="exPdf">Печать / PDF</button>' +
          '</div><div class="note" id="exState" style="margin-top:8px"></div></div>' +
          '<div class="set-card"><h3>Очистить дерево</h3>' +
          '<p class="note">Убирает всех людей, связи и вложенные файлы с этого устройства. ' +
          'Настройки оформления и список пользователей останутся. ' +
          'Сначала сохраните копию, если данные ещё нужны.</p>' +
          '<div class="btn-row"><button class="btn btn-sm btn-danger" id="dtWipe">Очистить дерево</button></div></div>' +
          '<div class="set-card"><h3>Загрузить данные</h3>' +
          '<p class="note">GEDCOM из MyHeritage, Ancestry или другой программы; простой текстовый список; ' +
          'или архив drevo.json из прежней копии.</p>' +
          '<div class="btn-row">' +
          '<button class="btn btn-sm" id="imGed">Из GEDCOM</button>' +
          '<button class="btn btn-sm" id="imTxt">Из текста</button>' +
          '<button class="btn btn-sm" id="imJson">Из копии JSON</button>' +
          '</div></div>';
        document.getElementById('stRename').addEventListener('click', function () {
          S.tree.meta.name = document.getElementById('stTreeName').value.trim() || 'Моё дерево';
          S.save();
          document.getElementById('treeName').textContent = S.tree.meta.name;
          self.toast('Название сохранено');
        });
        document.getElementById('exGed').addEventListener('click', function () {
          self.saveFile(new Blob([global.IO.exportGEDCOM()], { type: 'text/plain;charset=utf-8' }), fname('ged'));
        });
        document.getElementById('exSvg').addEventListener('click', function () {
          self.saveFile(new Blob([global.IO.exportSVG(self.tree)], { type: 'image/svg+xml' }), fname('svg'));
        });
        document.getElementById('exPdf').addEventListener('click', function () {
          if (!global.IO.printSVG(global.IO.exportSVG(self.tree)))
            self.toast('Браузер не дал открыть окно печати. Сохраните SVG и распечатайте его.');
        });
        document.getElementById('exBackup').addEventListener('click', function () {
          var st = document.getElementById('exState');
          st.textContent = 'Собираем архив…';
          global.IO.fullBackup(self.tree, function (i, n) { st.textContent = 'Файлы: ' + i + ' из ' + n; })
            .then(function (blob) {
              st.textContent = 'Готово, ' + Math.round(blob.size / 1024) + ' КБ';
              self.saveFile(blob, fname('zip'));
            });
        });
        document.getElementById('dtWipe').addEventListener('click', function () {
          var n = S.persons().length, f = S.allMedia().length;
          self.confirm('Очистить дерево?',
            'Будет удалено: ' + n + ' ' + plural(n, 'человек', 'человека', 'человек') +
            ' и ' + f + ' ' + plural(f, 'файл', 'файла', 'файлов') + '. Отменить нельзя.' +
            (S.sync && S.sync.mode !== 'off'
              ? ' Пустое дерево уйдёт и в общее хранилище, то есть пропадёт у всех родственников.'
              : ''),
            function () {
              S.allMedia().forEach(function (m) { S.removeMedia(m.id, true); });
              Object.keys(S.tree.persons).forEach(function (id) { S.bury(id); });
              Object.keys(S.tree.families).forEach(function (id) { S.bury(id); });
              S.tree.persons = {};
              S.tree.families = {};
              S.tree.media = {};
              S.tree.meta.rootId = null;
              delete S.tree.meta.demo;
              S.log('delete', 'Дерево очищено целиком');
              S.save();
              self.closeModal();
              if (self.sheet) self.sheet.close();
              self.tree.focusId = null;
              self.tree.render();
              self.renderTabs();
              self.showTab('tree');
              self.toast('Дерево очищено');
            });
        });
        document.getElementById('imGed').addEventListener('click', function () { self.importFile('ged'); });
        document.getElementById('imTxt').addEventListener('click', function () { self.importFile('txt'); });
        document.getElementById('imJson').addEventListener('click', function () { self.importFile('json'); });

      } else if (which === 'sec') {
        var isAdmin = S.isAdmin();
        host.innerHTML =
          '<div class="set-card"><h3>Вход по отпечатку</h3>' +
          '<p class="note">Отпечаток или Face ID заменяет ввод логина. Работает на телефоне и на компьютере ' +
          'с датчиком, если программа открыта по защищённому адресу (https) или установлена как приложение.</p>' +
          '<div class="btn-row"><button class="btn btn-sm" id="secBio">Включить на этом устройстве</button></div></div>' +
          '<div class="set-card"><h3>Шифрование</h3>' +
          '<p class="note">Ключ выводится из пароля дерева (PBKDF2, 200 000 проходов) и живёт только в памяти ' +
          'во время сеанса. Файлы с замком хранятся и выгружаются в копию зашифрованными по AES-256-GCM.</p>' +
          '<p class="note">Состояние: <b>' + (S.hasCryptoKey() ? 'ключ загружен' : 'ключ не загружен — введите пароль') + '</b></p>' +
          (S.hasCryptoKey() ? '' : '<div class="btn-row"><button class="btn btn-sm" id="secUnlock">Ввести пароль дерева</button></div>') +
          '</div>' +
          (isAdmin ?
            '<div class="set-card"><h3>Кто пользуется деревом</h3>' +
            '<div class="list" id="secUsers">' + S.users.map(function (u) {
              return '<div class="list-item"><div class="li-main"><div>' + esc(u.displayName) + '</div>' +
                '<div class="li-sub">' + esc(u.login) + ' · ' +
                (u.role === 'admin' ? 'администратор' : 'пользователь') +
                (u.invite ? ' · приглашение не принято' : '') + '</div></div>' +
                (u.invite ? '<button class="btn btn-sm" data-inv="' + u.invite + '">Ссылка</button>' : '') +
                (u.id === S.session.userId ? '' : '<button class="btn btn-sm btn-danger" data-rm="' + u.id +
                  '" title="Убрать пользователя" aria-label="Убрать пользователя">' + global.Icon('close') + '</button>') +
                '</div>';
            }).join('') + '</div>' +
            '<div class="btn-row"><button class="btn btn-primary btn-sm" id="secAdd">Пригласить родственника</button></div>' +
            '<p class="note">Приглашение — это ссылка. Отправьте её человеку любым способом; он откроет её, ' +
            'придумает пароль и получит доступ к дереву.</p></div>'
            : '<div class="set-card"><h3>Ваша роль</h3><p class="note">Вы вошли как пользователь. ' +
              'Приглашать других и снимать замки может только администратор дерева.</p></div>');
        var bio = document.getElementById('secBio');
        if (bio) bio.addEventListener('click', function () { self.bioRegister(); });
        var unl = document.getElementById('secUnlock');
        if (unl) unl.addEventListener('click', function () {
          self.prompt('Пароль дерева', 'Нужен, чтобы открыть записи с замком.', '', function (pass) {
            S.unlockCrypto(pass).then(function () { self.toast('Ключ загружен'); self.setPane('sec'); });
          }, 'password');
        });
        var add = document.getElementById('secAdd');
        if (add) add.addEventListener('click', function () { self.inviteDialog(); });
        host.querySelectorAll('[data-inv]').forEach(function (b) {
          b.addEventListener('click', function () {
            var link = location.href.split('#')[0] + '#invite-' + b.dataset.inv;
            self.modal('Ссылка-приглашение',
              '<p class="note">Передайте её родственнику. Ссылка одноразовая: после того как человек задаст пароль, она перестанет работать.</p>' +
              '<textarea id="invLink" rows="3" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--paper)">' +
              esc(link) + '</textarea>',
              [{ text: 'Скопировать', primary: true, fn: function () {
                var ta = document.getElementById('invLink');
                ta.select();
                if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () {
                  self.toast('Ссылка скопирована');
                }, function () { self.toast('Выделено — скопируйте вручную'); });
                else self.toast('Выделено — скопируйте вручную');
              } }]);
          });
        });
        host.querySelectorAll('[data-rm]').forEach(function (b) {
          b.addEventListener('click', function () {
            S.users = S.users.filter(function (u) { return u.id !== b.dataset.rm; });
            S.saveUsers();
            self.setPane('sec');
          });
        });

      } else {
        host.innerHTML =
          '<div class="set-card"><h3>Семейное Древо</h3>' +
          '<p class="note">Семейное генеалогическое дерево. Не для продажи и не для коммерческого использования.</p>' +
          '<p class="note">Персон: ' + S.persons().length + ' · семей: ' + S.families().length +
          ' · файлов: ' + S.allMedia().length + '</p>' +
          '<p class="note">Данные хранятся на устройстве. Дерево и люди общие для всех, кто получил доступ; ' +
          'оформление у каждого своё.</p></div>' +
          '<div class="set-card"><h3>Установить как приложение</h3>' +
          '<p class="note">Android и Windows: меню браузера → «Установить приложение».<br>' +
          'iPhone и iPad: «Поделиться» → «На экран «Домой»».<br>' +
          'После установки программа открывается с иконки и работает без интернета.</p></div>' +
          '<div class="set-card"><h3>Горячие клавиши</h3>' +
          '<p class="note">Колесо мыши — масштаб. Перетаскивание — сдвиг полотна. ' +
          'Двойной щелчок по человеку — поставить его в центр дерева. Esc — закрыть окно.</p></div>';
      }

      function rng(label, id, min, max, v, unit) {
        return '<div class="set-row"><span>' + label + '</span><span class="inline">' +
          '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + v +
          '" data-unit="' + unit + '">' +
          '<output>' + v + ' ' + unit + '</output></span></div>';
      }
      function fname(ext) {
        return (S.tree.meta.name || 'drevo').replace(/[^\wа-яА-ЯёЁ\- ]+/g, '') + ' ' +
          new Date().toISOString().slice(0, 10) + '.' + ext;
      }
    },

    /* ============ синхронизация ============ */
    startSync: function () {
      var self = this, Sy = global.Sync;
      Sy.on(function (state) {
        self.paintSync(state);
        if (state.state === 'ok') self.afterSync();
      });
      this.countMissing();
      Sy.restore().then(function () {
        self.paintSync();
        if (S.sync.mode === 'off' || !Sy.ready()) return;
        Sy.schedule();
        // первый проход через пару секунд, чтобы не мешать открытию программы
        setTimeout(function () {
          self.firstSync(function () {}, function () {});
        }, 2500);
      });
    },

    /** Первое подключение этого устройства. Если в общем хранилище уже есть дерево,
        а у человека своё — решает он, а не программа. Нетронутый образец уступает молча. */
    firstSync: function (then, fail) {
      var self = this, Sy = global.Sync;
      then = then || function () {};
      fail = fail || function () {};
      if (S.sync.lastAt || S.tree.meta.demo || !Object.keys(S.tree.persons).length) {
        Sy.run({ media: true }).then(then, fail);
        return;
      }
      Sy.peek().then(function (remote) {
        var n = remote && remote.persons ? Object.keys(remote.persons).length : 0;
        if (!n) { Sy.run({ media: true }).then(then, fail); return; }
        var mine = Object.keys(S.tree.persons).length;
        self.modal('В общем хранилище уже есть дерево',
          '<p class="note">Там <b>' + n + '</b> ' + plural(n, 'персона', 'персоны', 'персон') +
          ', у вас на устройстве — <b>' + mine + '</b>. Как поступить?</p>' +
          '<p class="note" style="margin-top:10px"><b>Присоединиться</b> — ваши записи добавятся к общим. ' +
          'Это нужный выбор, если вы вносили сведения, которых больше нигде нет.</p>' +
          '<p class="note"><b>Взять общее</b> — ваше местное дерево уступит место общему. ' +
          'Берите этот вариант, если вы просто смотрели образец.</p>' +
          '<p class="note"><b>Заменить общее своим</b> — ваше дерево станет общим для всех. ' +
          'Чужие записи при этом никуда не денутся: они вернутся при следующей синхронизации с их устройств.</p>',
          [
            { text: 'Присоединиться', primary: true, fn: function () {
              self.closeModal();
              Sy.run({ media: true }).then(then, fail);
            } },
            { text: 'Взять общее', fn: function () {
              self.closeModal();
              S.tree.meta.demo = true;              // уступить общему при слиянии
              Sy.run({ media: true }).then(then, fail);
            } },
            { text: 'Заменить общее своим', danger: true, fn: function () {
              self.closeModal();
              Sy.pushOnly().then(then, fail);
            } }
          ]);
      }, fail);
    },

    syncPane: function (host) {
      var self = this, Sy = global.Sync, s = S.sync;
      var modes = [
        ['off', 'Выключена', 'Дерево живёт только на этом устройстве. Обмен — через резервную копию.'],
        ['supabase', 'Supabase', 'Бесплатное облако: база данных и 1 ГБ под фотографии. Ничего ставить не надо.'],
        ['server', 'Свой сервер', 'Данные только у вас. Нужен компьютер или VPS с запущенным server.js.'],
        ['file', 'Облачный диск', 'Один файл в папке Яндекс.Диска или Google Диска. Диск разносит его по устройствам.']
      ];
      var cur = modes.filter(function (m) { return m[0] === s.mode; })[0] || modes[0];

      var html = '<div class="set-card"><h3>Способ</h3>' +
        '<div class="set-row"><span>Где хранить общее дерево</span><select id="syMode">' +
        modes.map(function (m) {
          return '<option value="' + m[0] + '"' + (s.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
        '<p class="note">' + esc(cur[2]) + '</p></div>';

      if (s.mode === 'supabase') {
        html += '<div class="set-card"><h3>Настройки Supabase</h3>' +
          fld('Адрес проекта', 'syUrl', s.supabase.url, 'https://xxxxx.supabase.co') +
          fld('Ключ anon public', 'syKey', s.supabase.key, 'eyJhbGci…', 'password') +
          fld('Имя дерева', 'syTree', s.supabase.treeId, 'nasha-semya') +
          '<p class="note">Имя дерева — любое короткое слово латиницей. Главное, чтобы у всех ' +
          'родственников оно было одинаковым: по нему программа находит общее дерево.</p>' +
          '<details style="margin-top:10px"><summary class="note" style="cursor:pointer">' +
          'Как завести Supabase — пять шагов</summary>' +
          '<ol class="note" style="padding-left:18px;line-height:1.7">' +
          '<li>Заведите бесплатный аккаунт на supabase.com, создайте проект.</li>' +
          '<li>Откройте SQL Editor, вставьте содержимое файла <b>server/supabase.sql</b> и нажмите Run.</li>' +
          '<li>Project Settings → API: скопируйте оттуда Project URL и ключ <b>anon public</b>.</li>' +
          '<li>Впишите их сюда, придумайте имя дерева, нажмите «Проверить связь».</li>' +
          '<li>Те же три значения передайте родственникам — вместе со ссылкой-приглашением.</li>' +
          '</ol></details></div>';

      } else if (s.mode === 'server') {
        html += '<div class="set-card"><h3>Настройки своего сервера</h3>' +
          fld('Адрес сервера', 'syUrl', s.server.url, 'https://drevo.мойдомен.ru') +
          fld('Ключ доступа', 'syKey', s.server.key, 'из server/data/key.txt', 'password') +
          '<p class="note">Сервер запускается командой <b>node server.js</b> из папки server. ' +
          'Подробности — в файле server/README.md.</p></div>';

      } else if (s.mode === 'file') {
        var fb = Sy.backends.file;
        html += '<div class="set-card"><h3>Файл обмена</h3>';
        if (!fb.supported()) {
          html += '<p class="note">Этот браузер не умеет открывать файл напрямую — так работают ' +
            'Chrome, Edge и Opera на компьютере. На телефоне пользуйтесь обменом через ' +
            '«Данные → Полная копия».</p>';
        } else {
          html += '<p class="note">Выберите один файл внутри папки Яндекс.Диска или Google Диска. ' +
            'Программа будет читать и писать его сама, а диск — разносить по устройствам. ' +
            'У остальных родственников тот же файл выбирается кнопкой «Открыть существующий».</p>' +
            '<div class="btn-row"><button class="btn btn-sm" id="syFileNew">Создать файл</button>' +
            '<button class="btn btn-sm" id="syFileOpen">Открыть существующий</button></div>' +
            '<p class="note" id="syFileState">' +
            (fb.handle ? 'Выбран: ' + esc(fb.handle.name) : 'Файл пока не выбран') + '</p>';
        }
        html += '</div>';
      }

      if (s.mode !== 'off') {
        html += '<div class="set-card"><h3>Когда синхронизировать</h3>' +
          '<div class="set-row"><span>Сама, в фоне</span>' +
          '<input type="checkbox" id="syAuto"' + (s.auto ? ' checked' : '') + '></div>' +
          '<div class="set-row"><span>Как часто</span><span class="inline">' +
          '<input type="range" id="syEvery" min="30" max="900" step="30" value="' + (s.interval || 120) + '">' +
          '<output>' + Math.round((s.interval || 120) / 60 * 10) / 10 + ' мин</output></span></div>' +
          '<div class="btn-row">' +
          '<button class="btn btn-primary btn-sm" id="syNow">Синхронизировать сейчас</button>' +
          '<button class="btn btn-sm" id="syCheck">Проверить связь</button>' +
          '</div><div class="note" id="syState" style="margin-top:8px"></div></div>';

        var miss = this.missingCount();
        html += '<div class="set-card"><h3>Состояние</h3>' +
          '<p class="note">Последняя синхронизация: <b>' +
          (s.lastAt ? new Date(s.lastAt).toLocaleString('ru-RU') : 'ещё не было') + '</b></p>' +
          (s.lastError ? '<p class="note" style="color:var(--bad)">Прошлая попытка не удалась: ' +
            esc(s.lastError) + '</p>' : '') +
          '<p class="note">Это устройство: <b>' + esc(S.deviceId || '—') + '</b></p>' +
          (miss ? '<p class="note">Файлов, которых тут ещё нет: <b>' + miss + '</b>. ' +
            'Они подтягиваются сами, когда вы их открываете.</p>' +
            '<div class="btn-row"><button class="btn btn-sm" id="syGetAll">Скачать все файлы сразу</button></div>' : '') +
          '<p class="note" style="margin-top:10px">Правки сливаются по записям: если двое меняли ' +
          'разных людей, сохранится и то и другое. Если одного и того же — останется правка, ' +
          'сделанная позже. Удаления расходятся по устройствам и не возвращаются обратно.</p>' +
          '</div>';
      }

      host.innerHTML = html;

      document.getElementById('syMode').addEventListener('change', function () {
        S.sync.mode = this.value;
        S.saveSync();
        Sy.schedule();
        self.setPane('sync');
        self.paintSync();
      });

      ['syUrl', 'syKey', 'syTree'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', function () {
          var cfg = S.sync[S.sync.mode];
          if (id === 'syUrl') cfg.url = el.value.trim();
          if (id === 'syKey') cfg.key = el.value.trim();
          if (id === 'syTree') cfg.treeId = el.value.trim().replace(/[^\w-]/g, '');
          if (id === 'syTree') el.value = cfg.treeId;
          S.saveSync();
          self.paintSync();
        });
      });

      var auto = document.getElementById('syAuto');
      if (auto) auto.addEventListener('change', function () {
        S.sync.auto = this.checked; S.saveSync(); Sy.schedule();
      });
      var every = document.getElementById('syEvery');
      if (every) every.addEventListener('input', function () {
        S.sync.interval = +this.value;
        this.nextElementSibling.value = Math.round(+this.value / 60 * 10) / 10 + ' мин';
        S.saveSync(); Sy.schedule();
      });

      var st = document.getElementById('syState');
      function say(msg, bad) {
        if (!st) return;
        st.textContent = msg;
        st.style.color = bad ? 'var(--bad)' : '';
      }

      var check = document.getElementById('syCheck');
      if (check) check.addEventListener('click', function () {
        say('Проверяем…');
        var b = Sy.backend();
        if (!b) { say('Способ не выбран', true); return; }
        b.check(Sy.cfg()).then(function (r) { say(r.message, !r.ok); });
      });

      /* перерисовать вкладку и оставить сообщение на виду */
      function finish(msg, bad) {
        self.countMissing().then(function () {
          self.setPane('sync');
          var el = document.getElementById('syState');
          if (el) { el.textContent = msg; el.style.color = bad ? 'var(--bad)' : ''; }
        });
      }

      var now = document.getElementById('syNow');
      if (now) now.addEventListener('click', function () {
        say('Синхронизация…');
        self.firstSync(function (rep) {
          self.afterSync();
          finish('Готово. ' + Sy.statsText(rep.stats) +
            (rep.up ? ' · отправлено файлов: ' + rep.up : '') +
            (rep.down ? ' · получено файлов: ' + rep.down : ''));
        }, function (e) { finish(e.message, true); });
      });

      var getAll = document.getElementById('syGetAll');
      if (getAll) getAll.addEventListener('click', function () {
        say('Скачиваем файлы…');
        Sy.run({ media: true }).then(function (rep) {
          self.afterSync();
          finish('Получено файлов: ' + rep.down);
        }, function (e) { finish(e.message, true); });
      });

      var fNew = document.getElementById('syFileNew');
      if (fNew) fNew.addEventListener('click', function () {
        Sy.backends.file.create(S.tree.meta.name).then(function () {
          self.setPane('sync'); self.paintSync();
        }, function () {});
      });
      var fOpen = document.getElementById('syFileOpen');
      if (fOpen) fOpen.addEventListener('click', function () {
        Sy.backends.file.open().then(function () {
          self.setPane('sync'); self.paintSync();
        }, function () {});
      });

      function fld(label, id, value, placeholder, type) {
        return '<div class="row"><label for="' + id + '">' + label + '</label>' +
          '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') +
          '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" spellcheck="false"></div>';
      }
    },

    /** сколько файлов числится в дереве, но ещё не лежит на этом устройстве */
    missingCount: function () {
      return this._missing || 0;
    },
    countMissing: function () {
      var self = this;
      var ids = Object.keys(S.tree.media).filter(function (id) { return S.tree.media[id].uploaded; });
      var i = 0, n = 0;
      function step() {
        if (i >= ids.length) { self._missing = n; return Promise.resolve(n); }
        return U.blobGet(ids[i++]).then(function (b) { if (!b) n++; }).then(step);
      }
      return step();
    },

    /** обновить вид после прихода чужих правок */
    afterSync: function () {
      if (!this.tree) return;
      if (!S.person(this.tree.focusId)) {
        this.tree.focusId = S.tree.meta.rootId || Object.keys(S.tree.persons)[0] || null;
      }
      this.tree.render();
      document.getElementById('treeName').textContent = S.tree.meta.name;
      this.renderTabs();
      if (this.sheet && this.sheet.personId) {
        if (S.person(this.sheet.personId)) this.sheet.render();
        else this.sheet.close();
      }
      if (this.activeTab !== 'tree') this.showTab(this.activeTab);
      this.countMissing();
    },

    /** значок состояния синхронизации в верхней панели */
    paintSync: function (state) {
      var btn = document.getElementById('btnSync');
      if (!btn) return;
      var Sy = global.Sync, s = S.sync || {};
      if (s.mode === 'off') {
        btn.hidden = true;
        return;
      }
      btn.hidden = false;
      var title = 'Синхронизировать';
      btn.classList.remove('spin', 'bad');
      if (state && state.state === 'run') {
        btn.classList.add('spin');
        title = state.text || 'Синхронизация…';
      } else if ((state && state.state === 'error') || s.lastError) {
        btn.classList.add('bad');
        title = (state && state.state === 'error')
          ? 'Не удалось: ' + state.text
          : 'Прошлая попытка не удалась: ' + s.lastError;
      } else if (s.lastAt) {
        title = 'Синхронизировано ' + new Date(s.lastAt).toLocaleTimeString('ru-RU',
          { hour: '2-digit', minute: '2-digit' });
      }
      btn.innerHTML = global.Icon('sync');
      btn.title = title;
      btn.setAttribute('aria-label', title);
    },

    inviteDialog: function () {
      var self = this;
      this.modal('Пригласить родственника',
        '<div class="row"><label for="ivName">Имя</label><input id="ivName"></div>' +
        '<div class="row"><label for="ivLogin">Логин</label><input id="ivLogin" autocomplete="off"></div>' +
        '<div class="row"><label for="ivRole">Роль</label><select id="ivRole">' +
        '<option value="user">Пользователь</option><option value="admin">Администратор</option></select></div>' +
        '<p class="note">Пароль человек задаст сам, перейдя по ссылке. Вы её увидите сразу после создания.</p>',
        [{ text: 'Создать приглашение', primary: true, fn: function () {
          var login = document.getElementById('ivLogin').value.trim();
          var name = document.getElementById('ivName').value.trim();
          if (!login) return;
          S.createUser(login, U.uid('tmp'), document.getElementById('ivRole').value, name || login)
            .then(function () { self.closeModal(); self.setPane('sec'); self.toast('Приглашение создано'); });
        } }]);
    },

    /* ============ импорт ============ */
    importFile: function (kind) {
      var self = this;
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = kind === 'ged' ? '.ged,.gedcom,text/plain' : kind === 'json' ? '.json,application/json' : '.txt,.csv,text/plain';
      inp.addEventListener('change', function () {
        var f = inp.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          var text = r.result;
          var incoming;
          try {
            if (kind === 'ged') incoming = global.IO.importGEDCOM(text);
            else if (kind === 'json') incoming = JSON.parse(text);
            else incoming = global.IO.importText(text);
          } catch (e) { self.toast('Файл не разобрался: ' + e.message); return; }
          var n = Object.keys(incoming.persons || {}).length;
          if (!n) { self.toast('В файле не нашлось ни одной персоны'); return; }
          self.confirm('Загрузить ' + n + ' персон?',
            'Текущее дерево (' + S.persons().length + ' персон) будет заменено. ' +
            'Сначала сохраните копию, если она ещё не сделана.', function () {
              incoming.changes = S.tree.changes || [];
              incoming.tabs = incoming.tabs || S.tree.tabs;
              incoming.meta.salt = incoming.meta.salt || S.tree.meta.salt;
              delete incoming.meta.demo;
              S.tree = incoming;
              S.log('import', 'Загружено дерево из файла «' + f.name + '» — ' + n + ' персон');
              S.save();
              self.closeModal();
              self.tree.setFocus(S.tree.meta.rootId || Object.keys(S.tree.persons)[0]);
              self.renderTabs();
              self.showTab('tree');
              self.tree.fit();
              self.toast('Загружено персон: ' + n);
            });
        };
        r.readAsText(f, 'utf-8');
      });
      inp.click();
    },

    saveFile: function (blob, name) {
      if (!global.IO.download(blob, name)) {
        this.toast('Браузер не дал сохранить файл. Откройте программу в отдельной вкладке.');
      } else {
        this.toast('Сохранено: ' + name);
      }
    },

    /* ============ оформление ============ */
    applyPrefs: function () {
      var p = S.prefs;
      var root = document.documentElement;
      if (p.theme === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', p.theme);
      root.style.setProperty('--accent', p.accent);
      root.style.setProperty('--ui-size', p.ui.fontSize + 'px');
      root.style.setProperty('--tab-size', p.ui.tabSize + 'px');
      root.style.setProperty('--icon-size', (p.ui.iconSize || 17) + 'px');
      if (p.treeBg && p.treeBg !== 'auto') root.style.setProperty('--tree-bg', p.treeBg);
      else root.style.setProperty('--tree-bg', 'var(--paper)');
      root.style.setProperty('--tree-fade', ((p.treeImageFade == null ? 35 : p.treeImageFade) / 100));
      this.paintTreeImage();
    },

    /** картинка под деревом; лежит в хранилище устройства, своя у каждого */
    paintTreeImage: function () {
      var el = document.getElementById('treeBgImage'), p = S.prefs, self = this;
      if (!el) return;
      if (!p.treeImage) {
        el.hidden = true;
        el.style.backgroundImage = '';
        if (this._bgUrl) { try { URL.revokeObjectURL(this._bgUrl); } catch (e) {} this._bgUrl = null; }
        return;
      }
      el.classList.toggle('tile', p.treeImageFit === 'tile');
      if (this._bgUrl) { el.hidden = false; return; }
      U.blobGet('__treebg_' + S.session.userId).then(function (b) {
        if (!b) { p.treeImage = false; S.savePrefs(); el.hidden = true; return; }
        self._bgUrl = URL.createObjectURL(b);
        el.style.backgroundImage = 'url(' + self._bgUrl + ')';
        el.hidden = false;
      });
    },
    setTreeImage: function (file) {
      var self = this, p = S.prefs;
      if (this._bgUrl) { try { URL.revokeObjectURL(this._bgUrl); } catch (e) {} this._bgUrl = null; }
      return U.blobPut('__treebg_' + S.session.userId, file).then(function () {
        p.treeImage = true;
        S.savePrefs();
        self.paintTreeImage();
      });
    },
    clearTreeImage: function () {
      var p = S.prefs;
      if (this._bgUrl) { try { URL.revokeObjectURL(this._bgUrl); } catch (e) {} this._bgUrl = null; }
      p.treeImage = false;
      S.savePrefs();
      U.blobDel('__treebg_' + S.session.userId);
      this.paintTreeImage();
    },

    /** Образец окошка в настройках: те же правила, что и в дереве,
        поэтому видно ровно то, что получится. */
    paintPreview: function () {
      var stage = document.getElementById('stStage');
      if (!stage) return;
      var p = S.prefs, I = global.Icon;
      stage.style.background = (p.treeBg && p.treeBg !== 'auto') ? p.treeBg : 'var(--paper)';
      stage.style.backgroundImage = p.treeGrid
        ? 'radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 0)' : '';
      stage.style.backgroundSize = p.treeGrid ? '28px 28px' : '';

      var r = p.card.shape === 'circle' ? Math.round(p.card.h / 2) : p.card.radius;
      var pr = p.card.shape === 'circle' ? '50%' : Math.max(2, p.card.radius - 4) + 'px';
      function node(cls, name, years, gone) {
        var h = '<div class="pv-node ' + cls + (gone ? ' is-gone' : '') + '" style="width:' + p.card.w +
          'px;height:' + p.card.h + 'px;border-radius:' + r + 'px">';
        if (p.showPhotos && p.card.photo > 0) {
          h += '<div class="pv-ph" style="width:' + p.card.photo + 'px;height:' + p.card.photo +
            'px;border-radius:' + pr + '">' + I(cls === 'm' ? 'personM' : 'personF') + '</div>';
        }
        h += '<div class="pv-txt"><div class="pv-name" style="font-size:' + p.card.nameSize + 'px">' +
          esc(name) + '</div>';
        if (p.showDates) {
          h += '<div class="pv-years" style="font-size:' + p.card.dateSize +
            'px;font-weight:' + (p.card.dateWeight || 400) + '">' + esc(years) + '</div>';
        }
        h += '</div>';
        if (gone) h += '<span class="node-mourn"></span>';
        return h + '</div>';
      }
      stage.innerHTML = '<div class="pv-row">' +
        node('f', 'Анна Петровна Смирнова', '1932', false) +
        node('m', 'Пётр Смирнов', '1928 – 1994', true) + '</div>' +
        '<div class="preview-hint">Слева — живой человек, справа — с траурной полосой на углу.</div>';
    },

    /* ============ окна и мелочи ============ */
    modal: function (title, body, buttons, opts) {
      opts = opts || {};
      var back = document.getElementById('modalBack');
      var foot = (buttons || []).map(function (b, i) {
        return '<button class="btn ' + (b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : '') +
          '" data-b="' + i + '">' + esc(b.text) + '</button>';
      }).join('');
      back.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
        '<button class="icon-btn" data-close="1" aria-label="Закрыть" title="Закрыть">' +
        global.Icon('close') + '</button></div>' +
        '<div class="modal-body">' + body + '</div>' +
        '<div class="modal-foot">' + foot + '<button class="btn" data-close="1">Закрыть</button></div></div>';
      back.hidden = false;
      var self = this;
      back.querySelectorAll('[data-close]').forEach(function (b) {
        b.addEventListener('click', function () { self.closeModal(); });
      });
      back.querySelectorAll('[data-b]').forEach(function (b) {
        b.addEventListener('click', function () { buttons[+b.dataset.b].fn(); });
      });
    },
    closeModal: function () {
      var back = document.getElementById('modalBack');
      back.hidden = true;
      back.innerHTML = '';
    },
    confirm: function (title, text, onYes) {
      var self = this;
      this.modal(title, '<p class="note" style="font-size:13px">' + esc(text) + '</p>',
        [{ text: 'Да, продолжить', danger: true, fn: function () { self.closeModal(); onYes(); } }]);
    },
    prompt: function (title, text, value, cb, type) {
      var self = this;
      this.modal(title,
        '<p class="note" style="margin-bottom:10px">' + esc(text) + '</p>' +
        '<input id="pmVal" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' +
        'style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--paper)">',
        [{ text: 'Готово', primary: true, fn: function () {
          var v = document.getElementById('pmVal').value;
          self.closeModal();
          cb(v);
        } }]);
      setTimeout(function () { var el = document.getElementById('pmVal'); if (el) el.focus(); }, 40);
    },
    toast: function (msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(this._tt);
      this._tt = setTimeout(function () { t.hidden = true; }, 3200);
    },

    /* ============ демонстрационное дерево ============ */
    seedDemo: function () {
      var t = S.tree;
      function P(sur, giv, pat, sex, b, d, place) {
        var p = U.newPerson({
          surname: sur, given: giv, patronymic: pat, sex: sex,
          birth: { date: b || '', place: place || '', lat: null, lng: null },
          death: { date: d || '', place: '', lat: null, lng: null },
          living: !d
        });
        t.persons[p.id] = p;
        return p;
      }
      function F(h, w, kids, marr) {
        var f = U.newFamily({
          husb: h ? h.id : null, wife: w ? w.id : null,
          children: (kids || []).map(function (k) { return k.id; }),
          marriage: { date: marr || '', place: '', lat: null, lng: null }
        });
        t.families[f.id] = f;
        return f;
      }
      t.meta.name = 'Дерево семьи';

      var grig = P('Булыгин', 'Григорий', '', 'M', '1905', '1968');
      var kalina = P('Монаков', 'Калина', '', 'M', '1902', '1971');
      var monak = P('Монакова', 'Мария', 'Калиновна', 'F', '1908', '1979');

      var nik = P('Булыгин', 'Николай', 'Григорьевич', 'M', '1935-03-14', '1977', 'с. Матур');
      var efr = P('Булыгина', 'Ефросинья', 'Калиновна', 'F', '1931-07-02', '', 'с. Матур');
      efr.maiden = 'Монакова';

      var mih = P('Буйлов', 'Михаил', 'Владимирович', 'M', '1959-11-08', '', 'Красноярский край');
      var alex = P('Буйлова', 'Александра', 'Николаевна', 'F', '1961-07-14', '', 'с. Матур, Красноярский край');
      alex.maiden = 'Булыгина';
      alex.birth.lat = 52.9; alex.birth.lng = 89.6;
      alex.note = 'Хранительница семейного архива.';
      var tat = P('Булыгина', 'Татьяна', 'Николаевна', 'F', '1963-02-20');
      var ser = P('Булыгин', 'Сергей', 'Николаевич', 'M', '1964-09-03');

      var elena = P('Завьялова', 'Елена', 'Александровна', 'F', '1988-05-19');
      elena.maiden = 'Буйлова';
      var igor = P('Завьялов', 'Игорь', '', 'M', '1986');
      var roman = P('Буйлов', 'Роман', 'Михайлович', 'M', '1982-01-11');
      var oleg = P('Буйлов', 'Олег', 'Михайлович', 'M', '1990-06-25');
      var ivan = P('Булыгин', 'Иван', 'Сергеевич', 'M', '1985-04-02');
      var svet = P('Булыгина', 'Светлана', 'Владимировна', 'F', '1981-12-30');
      var alexey = P('Булыгин', 'Алексей', 'Сергеевич', 'M', '1988-08-17');

      F(grig, null, [nik]);
      F(kalina, monak, [efr]);
      F(nik, efr, [alex, tat, ser], '1958-06-12');
      F(mih, alex, [elena, roman, oleg], '1981-09-05');
      F(ivan, svet, []);
      F(ser, null, [ivan, alexey]);
      F(igor, elena, []);

      alex.events.push({
        id: U.uid('e'), type: 'Переезд', date: '1979-08-01', place: 'Абакан',
        lat: 53.72, lng: 91.44, note: 'Поступление в техникум',
        acl: { level: 'public', locked: false }
      });
      nik.death.place = 'с. Матур';
      nik.death.lat = 52.9; nik.death.lng = 89.6;

      t.meta.rootId = alex.id;
      t.meta.demo = true;   // снимется при первой же правке руками
      S.log('add', 'Создано демонстрационное дерево — 16 персон');
      S.save(true);
    }
  };

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function val(id) { return (document.getElementById(id).value || '').trim(); }
  function err(msg) { document.getElementById('gErr').textContent = msg; }

  global.App = App;
  document.addEventListener('DOMContentLoaded', function () { App.init(); });
})(window);
