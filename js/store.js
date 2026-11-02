/* Семейное Древо — слой данных.
   Дерево и люди общие для всех пользователей; оформление — у каждого своё.
   Медиафайлы лежат в IndexedDB, приватные — в зашифрованном виде (AES-GCM). */
(function (global) {
  'use strict';

  var DB_NAME = 'drevo';
  var DB_VER = 1;
  var LS_TREE = 'drevo.tree';
  var LS_USERS = 'drevo.users';
  var LS_SESSION = 'drevo.session';
  var LS_PREFS = 'drevo.prefs.';
  var LS_DEVICE = 'drevo.device';
  var LS_SYNC = 'drevo.sync';

  /* ---------- маленькие помощники ---------- */
  function uid(prefix) {
    return (prefix || 'x') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowISO() { return new Date().toISOString(); }
  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBytes(s) {
    var bin = atob(s), b = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  /* ---------- IndexedDB для медиа ---------- */
  var dbp = null;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!global.indexedDB) { rej(new Error('IndexedDB недоступна')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    return dbp;
  }
  function blobPut(key, blob) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(blob, key);
        tx.oncomplete = function () { res(key); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function blobGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('blobs', 'readonly');
        var rq = tx.objectStore('blobs').get(key);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function blobDel(key) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(key);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
      });
    });
  }

  /* ---------- шифрование приватных файлов и записей ---------- */
  var cryptoKey = null;          // CryptoKey текущего дерева
  var subtle = global.crypto && global.crypto.subtle ? global.crypto.subtle : null;

  function deriveKey(passphrase, saltB64) {
    if (!subtle) return Promise.resolve(null);
    var salt = b64ToBytes(saltB64);
    return subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function encryptBlob(blob) {
    if (!cryptoKey) return Promise.resolve({ blob: blob, enc: false });
    return blob.arrayBuffer().then(function (buf) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, buf).then(function (ct) {
        var out = new Uint8Array(12 + ct.byteLength);
        out.set(iv, 0); out.set(new Uint8Array(ct), 12);
        return { blob: new Blob([out], { type: 'application/octet-stream' }), enc: true };
      });
    });
  }
  function decryptBlob(blob, mime) {
    if (!cryptoKey) return Promise.reject(new Error('Нет ключа расшифровки'));
    return blob.arrayBuffer().then(function (buf) {
      var all = new Uint8Array(buf);
      var iv = all.slice(0, 12), ct = all.slice(12);
      return subtle.decrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, ct).then(function (pt) {
        return new Blob([pt], { type: mime || 'application/octet-stream' });
      });
    });
  }
  function encryptText(str) {
    if (!cryptoKey) return Promise.resolve(null);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, new TextEncoder().encode(str))
      .then(function (ct) { return bytesToB64(iv) + '.' + bytesToB64(ct); });
  }
  function decryptText(packed) {
    if (!cryptoKey || !packed) return Promise.resolve('');
    var parts = String(packed).split('.');
    if (parts.length !== 2) return Promise.resolve('');
    return subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[0]) }, cryptoKey, b64ToBytes(parts[1]))
      .then(function (pt) { return new TextDecoder().decode(pt); })
      .catch(function () { return ''; });
  }
  /* Пароль хранится свёрткой PBKDF2 с личной солью. Раньше это был простой
     SHA-256; такие записи ещё проверяются, но при первом же удачном входе
     пересчитываются по-новому. Список пользователей едет вместе с деревом,
     поэтому свёртка должна быть дорогой для подбора. */
  var KDF_ITERS = 210000;

  function hashPassword(password, saltB64, iters) {
    saltB64 = saltB64 || bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    iters = iters || KDF_ITERS;
    if (!subtle) {
      return sha256hex(password + '::' + saltB64).then(function (h) {
        return { algo: 'sha256-plain', salt: saltB64, iters: 1, hash: h };
      });
    }
    return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return subtle.deriveBits(
          { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: iters, hash: 'SHA-256' },
          base, 256);
      })
      .then(function (bits) {
        return { algo: 'pbkdf2-sha256', salt: saltB64, iters: iters, hash: bytesToB64(bits) };
      });
  }

  /** одинаковы ли две строки — без подсказок по времени сравнения */
  function sameSecret(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function verifyPassword(user, password) {
    if (!user) return Promise.resolve(false);
    if (user.kdf && user.kdf.algo === 'pbkdf2-sha256') {
      return hashPassword(password, user.kdf.salt, user.kdf.iters)
        .then(function (r) { return sameSecret(r.hash, user.kdf.hash); });
    }
    if (user.kdf && user.kdf.algo === 'sha256-plain') {
      return sha256hex(password + '::' + user.kdf.salt)
        .then(function (h) { return sameSecret(h, user.kdf.hash); });
    }
    // записи старого образца
    return sha256hex(password + '::' + user.login)
      .then(function (h) { return sameSecret(h, user.hash); });
  }

  function sha256hex(str) {
    if (!subtle) return Promise.resolve('plain:' + str);
    return subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) {
        return ('0' + x.toString(16)).slice(-2);
      }).join('');
    });
  }

  /* ---------- структура дерева ---------- */
  function emptyTree() {
    return {
      meta: {
        id: uid('tree'),
        name: 'Моё дерево',
        created: nowISO(),
        salt: bytesToB64(crypto.getRandomValues(new Uint8Array(16))),
        rootId: null,
        version: 1
      },
      persons: {},
      families: {},
      media: {},
      changes: [],
      tabs: [
        { id: 'tree', title: 'Дерево', icon: 'tree', builtin: true },
        { id: 'photos', title: 'Фото', icon: 'photo', builtin: true },
        { id: 'changes', title: 'Изменения', icon: 'clock', builtin: true }
      ],
      /* Учётные записи лежат в самом дереве, а не на устройстве: иначе
         логин, заведённый на компьютере, не существовал бы на телефоне.
         Пароли хранятся только как PBKDF2-свёртка с личной солью. */
      users: [],
      /* следы удалённых записей: id -> когда удалили.
         Без них удаление, сделанное на одном устройстве, вернулось бы
         обратно при первой же синхронизации с другого. */
      tombstones: {}
    };
  }

  function newPerson(patch) {
    var p = {
      id: uid('I'),
      sex: 'U',
      surname: '', given: '', patronymic: '', maiden: '',
      birth: { date: '', place: '', lat: null, lng: null },
      death: { date: '', place: '', lat: null, lng: null },
      living: true,
      photo: null,          // id медиа, которое показывается в окошке
      note: '',
      fields: [],           // произвольные строки {id,label,value,type,acl}
      events: [],           // {id,type,date,place,lat,lng,note,acl}
      media: [],            // id медиа
      acl: { level: 'public', locked: false },
      updated: nowISO()
    };
    if (patch) for (var k in patch) p[k] = patch[k];
    return p;
  }

  /** настройки синхронизации; хранятся отдельно от дерева — у каждого устройства свои */
  function defaultSync() {
    return {
      mode: 'off',            // off | supabase | server | file
      auto: true,             // синхронизировать самостоятельно
      interval: 120,          // как часто, секунд
      lastAt: null,           // когда прошла последняя
      lastError: null,
      supabase: { url: '', key: '', treeId: '' },
      server: { url: '', key: '' },
      file: { handleName: '' }
    };
  }

  function newFamily(patch) {
    var f = {
      id: uid('F'), husb: null, wife: null, children: [],
      marriage: { date: '', place: '', lat: null, lng: null },
      divorced: false, updated: nowISO()
    };
    if (patch) for (var k in patch) f[k] = patch[k];
    return f;
  }

  /* ---------- Store ---------- */
  var Store = {
    tree: emptyTree(),
    session: null,
    prefs: null,
    listeners: [],

    on: function (fn) { this.listeners.push(fn); },
    emit: function (what) {
      var self = this;
      this.listeners.forEach(function (fn) { try { fn(what, self); } catch (e) { console.error(e); } });
    },

    /* --- загрузка/сохранение --- */
    load: function () {
      try {
        var raw = localStorage.getItem(LS_TREE);
        if (raw) this.tree = JSON.parse(raw);
      } catch (e) { console.warn('Дерево не прочиталось', e); }
      if (!this.tree || !this.tree.persons) this.tree = emptyTree();
      if (!this.tree.tabs) this.tree.tabs = emptyTree().tabs;
      if (!this.tree.tombstones) this.tree.tombstones = {};
      if (!this.tree.meta.updated) this.tree.meta.updated = nowISO();
      try {
        this.deviceId = localStorage.getItem(LS_DEVICE);
        if (!this.deviceId) {
          this.deviceId = uid('dev');
          localStorage.setItem(LS_DEVICE, this.deviceId);
        }
        this.sync = JSON.parse(localStorage.getItem(LS_SYNC) || 'null') || defaultSync();
      } catch (e) { this.deviceId = uid('dev'); this.sync = defaultSync(); }
      if (!Array.isArray(this.tree.users)) this.tree.users = [];
      // перенос со старых версий, где список лежал отдельно на устройстве
      try {
        var old = localStorage.getItem(LS_USERS);
        if (old && !this.tree.users.length) {
          var list = JSON.parse(old);
          if (Array.isArray(list) && list.length) {
            this.tree.users = list.map(function (u) {
              u.updated = u.updated || u.created || nowISO();
              return u;
            });
            this.save(true);
          }
        }
        if (old) localStorage.removeItem(LS_USERS);
      } catch (e) {}
      try {
        var s = localStorage.getItem(LS_SESSION);
        this.session = s ? JSON.parse(s) : null;
      } catch (e) { this.session = null; }
      return this;
    },
    save: function (silent) {
      this.tree.meta.version = (this.tree.meta.version || 1) + 1;
      this.tree.meta.updated = nowISO();
      // первая же правка руками снимает метку «это образец»
      if (!silent && this.tree.meta.demo) delete this.tree.meta.demo;
      this.dirty = true;
      try { localStorage.setItem(LS_TREE, JSON.stringify(this.tree)); }
      catch (e) { console.error('Не удалось сохранить дерево', e); }
      if (!silent) this.emit('tree');
    },
    saveUsers: function () { this.save(true); },
    saveSync: function () {
      try { localStorage.setItem(LS_SYNC, JSON.stringify(this.sync)); } catch (e) {}
      this.emit('sync');
    },
    /** пометить запись удалённой, чтобы удаление разошлось по устройствам */
    bury: function (id) {
      this.tree.tombstones = this.tree.tombstones || {};
      this.tree.tombstones[id] = nowISO();
    },
    setSession: function (s) {
      this.session = s;
      try {
        if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s));
        else localStorage.removeItem(LS_SESSION);
      } catch (e) {}
    },

    /* --- настройки оформления (у каждого пользователя свои) --- */
    defaultPrefs: function () {
      return {
        theme: 'auto',
        accent: '#2f7fb8',
        layout: 'vertical',
        card: { w: 168, h: 76, radius: 10, photo: 44, nameSize: 12, dateSize: 11,
                shape: 'rounded', dateWeight: 400 },
        ui: { fontSize: 14, tabSize: 14, iconSize: 17 },
        treeBg: 'auto',      // 'auto' — как у страницы, иначе цвет
        treeGrid: false,     // точечная сетка на полотне
        treeImage: false,    // своя картинка под деревом
        treeImageFit: 'cover',   // cover | tile
        treeImageFade: 35,   // насколько приглушить, %
        showPhotos: true,
        showDates: true
      };
    },
    loadPrefs: function (userId) {
      var d = this.defaultPrefs();
      try {
        var raw = localStorage.getItem(LS_PREFS + userId);
        if (raw) {
          var p = JSON.parse(raw);
          for (var k in p) {
            if (p[k] && typeof p[k] === 'object' && d[k]) { for (var j in p[k]) d[k][j] = p[k][j]; }
            else d[k] = p[k];
          }
        }
      } catch (e) {}
      this.prefs = d;
      return d;
    },
    savePrefs: function () {
      if (!this.session) return;
      try { localStorage.setItem(LS_PREFS + this.session.userId, JSON.stringify(this.prefs)); } catch (e) {}
      this.emit('prefs');
    },

    /* --- журнал изменений --- */
    log: function (action, summary, targetId) {
      this.tree.changes.unshift({
        id: uid('c'), ts: nowISO(),
        user: this.session ? this.session.displayName : 'система',
        userId: this.session ? this.session.userId : null,
        action: action, summary: summary, target: targetId || null
      });
      if (this.tree.changes.length > 1000) this.tree.changes.length = 1000;
    },

    /* --- персоны --- */
    persons: function () {
      var t = this.tree, out = [];
      for (var id in t.persons) out.push(t.persons[id]);
      return out;
    },
    person: function (id) { return this.tree.persons[id] || null; },
    addPerson: function (patch) {
      var p = newPerson(patch);
      this.tree.persons[p.id] = p;
      if (!this.tree.meta.rootId) this.tree.meta.rootId = p.id;
      this.log('add', 'Добавлена персона: ' + this.fullName(p), p.id);
      this.save();
      return p;
    },
    updatePerson: function (id, patch, quiet) {
      var p = this.tree.persons[id];
      if (!p) return null;
      for (var k in patch) p[k] = patch[k];
      p.updated = nowISO();
      if (!quiet) this.log('edit', 'Изменена карточка: ' + this.fullName(p), id);
      this.save();
      return p;
    },
    removePerson: function (id) {
      var p = this.tree.persons[id];
      if (!p) return;
      var name = this.fullName(p);
      var self = this;
      (p.media || []).forEach(function (mid) { self.removeMedia(mid, true); });
      delete this.tree.persons[id];
      this.bury(id);
      for (var fid in this.tree.families) {
        var f = this.tree.families[fid];
        var hit = false;
        if (f.husb === id) { f.husb = null; hit = true; }
        if (f.wife === id) { f.wife = null; hit = true; }
        if (f.children.indexOf(id) >= 0) {
          f.children = f.children.filter(function (c) { return c !== id; });
          hit = true;
        }
        if (hit) f.updated = nowISO();
        if (!f.husb && !f.wife && !f.children.length) { delete this.tree.families[fid]; this.bury(fid); }
      }
      if (this.tree.meta.rootId === id) {
        var rest = Object.keys(this.tree.persons);
        this.tree.meta.rootId = rest.length ? rest[0] : null;
      }
      this.log('delete', 'Удалена персона: ' + name, null);
      this.save();
    },
    fullName: function (p) {
      if (!p) return '';
      var parts = [p.surname, p.given, p.patronymic].filter(Boolean);
      var n = parts.join(' ').trim();
      return n || 'Без имени';
    },
    shortName: function (p) {
      if (!p) return '';
      var n = [p.given, p.patronymic].filter(Boolean).join(' ');
      return (n + ' ' + (p.surname || '')).trim() || 'Без имени';
    },
    /** имя для обращения в окнах: имя и фамилия, без отчества */
    callName: function (p) {
      if (!p) return '';
      return [p.given, p.surname].filter(Boolean).join(' ') || this.fullName(p);
    },
    years: function (p) {
      if (!p) return '';
      var b = yr(p.birth && p.birth.date), d = yr(p.death && p.death.date);
      if (b && d) return b + ' – ' + d;
      if (b) return b;
      if (d) return '? – ' + d;
      return '';
    },

    /* --- семьи и связи --- */
    families: function () {
      var out = [];
      for (var id in this.tree.families) out.push(this.tree.families[id]);
      return out;
    },
    family: function (id) { return this.tree.families[id] || null; },
    addFamily: function (patch) {
      var f = newFamily(patch);
      this.tree.families[f.id] = f;
      return f;
    },
    /** семья, где человек — супруг */
    spouseFamilies: function (id) {
      return this.families().filter(function (f) { return f.husb === id || f.wife === id; });
    },
    /** семья, где человек — ребёнок */
    childFamily: function (id) {
      var all = this.families();
      for (var i = 0; i < all.length; i++) if (all[i].children.indexOf(id) >= 0) return all[i];
      return null;
    },
    parentsOf: function (id) {
      var f = this.childFamily(id);
      if (!f) return [];
      return [f.husb, f.wife].filter(Boolean).map(this.person.bind(this)).filter(Boolean);
    },
    childrenOf: function (id) {
      var self = this, out = [];
      this.spouseFamilies(id).forEach(function (f) {
        f.children.forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
      });
      return out.map(function (c) { return self.person(c); }).filter(Boolean);
    },
    spousesOf: function (id) {
      var self = this, out = [];
      this.spouseFamilies(id).forEach(function (f) {
        var other = f.husb === id ? f.wife : f.husb;
        if (other && out.indexOf(other) < 0) out.push(other);
      });
      return out.map(function (c) { return self.person(c); }).filter(Boolean);
    },
    siblingsOf: function (id) {
      var f = this.childFamily(id);
      if (!f) return [];
      var self = this;
      return f.children.filter(function (c) { return c !== id; })
        .map(function (c) { return self.person(c); }).filter(Boolean);
    },
    linkChild: function (parentId, childId) {
      var fams = this.spouseFamilies(parentId), f;
      if (fams.length) f = fams[0];
      else {
        var p = this.person(parentId);
        f = this.addFamily(p && p.sex === 'F' ? { wife: parentId } : { husb: parentId });
      }
      if (f.children.indexOf(childId) < 0) f.children.push(childId);
      f.updated = nowISO();
      var old = this.childFamily(childId);
      if (old && old.id !== f.id) {
        old.children = old.children.filter(function (c) { return c !== childId; });
        old.updated = nowISO();
      }
      this.save();
      return f;
    },
    linkSpouse: function (aId, bId) {
      var a = this.person(aId), b = this.person(bId);
      if (!a || !b) return null;
      var fams = this.spouseFamilies(aId);
      var free = fams.filter(function (f) { return !f.husb || !f.wife; })[0];
      var f = free || this.addFamily({});
      if (a.sex === 'F') { f.wife = aId; f.husb = bId; }
      else { f.husb = aId; f.wife = bId; }
      f.updated = nowISO();
      this.save();
      return f;
    },
    linkParent: function (childId, parentId) {
      var f = this.childFamily(childId);
      var p = this.person(parentId);
      if (!f) f = this.addFamily({ children: [childId] });
      if (p && p.sex === 'F') f.wife = parentId; else f.husb = parentId;
      f.updated = nowISO();
      this.save();
      return f;
    },
    unlink: function (aId, bId) {
      var self = this;
      this.families().forEach(function (f) {
        var pair = (f.husb === aId && f.wife === bId) || (f.husb === bId && f.wife === aId);
        var hit = false;
        if (pair) { f.husb = null; f.wife = null; hit = true; }
        if ((f.husb === aId || f.wife === aId) && f.children.indexOf(bId) >= 0) {
          f.children = f.children.filter(function (c) { return c !== bId; }); hit = true;
        }
        if ((f.husb === bId || f.wife === bId) && f.children.indexOf(aId) >= 0) {
          f.children = f.children.filter(function (c) { return c !== aId; }); hit = true;
        }
        if (hit) f.updated = nowISO();
        if (!f.husb && !f.wife && !f.children.length) { delete self.tree.families[f.id]; self.bury(f.id); }
      });
      this.save();
    },

    /* --- медиа --- */
    addMedia: function (personId, file, opts) {
      var self = this;
      opts = opts || {};
      var id = uid('M');
      var acl = opts.acl || { level: 'public', locked: false };
      var isPrivate = acl.locked || acl.level === 'admin' || acl.level === 'owner';
      var step = isPrivate ? encryptBlob(file) : Promise.resolve({ blob: file, enc: false });
      return step.then(function (r) {
        return blobPut(id, r.blob).then(function () {
          var m = {
            id: id, personId: personId, kind: opts.kind || kindOf(file.type, file.name),
            name: file.name || 'файл', mime: file.type || 'application/octet-stream',
            size: file.size || 0, caption: opts.caption || '', date: opts.date || '',
            acl: acl, encrypted: r.enc, added: nowISO(),
            addedBy: self.session ? self.session.displayName : '',
            updated: nowISO(),
            uploaded: false,      // файл ещё не ушёл в общее хранилище
            origin: self.deviceId
          };
          self.tree.media[id] = m;
          var p = self.person(personId);
          if (p) {
            p.media = p.media || [];
            p.media.push(id);
            if (!p.photo && m.kind === 'photo') p.photo = id;
          }
          self.log('media', 'Добавлен файл «' + m.name + '» к ' + self.fullName(p), personId);
          self.save();
          return m;
        });
      });
    },
    removeMedia: function (id, quiet) {
      var m = this.tree.media[id];
      if (!m) return;
      var p = this.person(m.personId);
      if (p) {
        p.media = (p.media || []).filter(function (x) { return x !== id; });
        if (p.photo === id) p.photo = (p.media || []).filter(function (x) {
          return (this.tree.media[x] || {}).kind === 'photo';
        }.bind(this))[0] || null;
      }
      delete this.tree.media[id];
      this.bury(id);
      blobDel(id);
      if (p) p.updated = nowISO();
      if (!quiet) { this.log('media', 'Удалён файл «' + m.name + '»', m.personId); this.save(); }
    },
    mediaOf: function (personId) {
      var t = this.tree, out = [];
      (this.person(personId) || { media: [] }).media.forEach(function (id) {
        if (t.media[id]) out.push(t.media[id]);
      });
      return out;
    },
    allMedia: function () {
      var out = [];
      for (var id in this.tree.media) out.push(this.tree.media[id]);
      return out.sort(function (a, b) { return (b.added || '').localeCompare(a.added || ''); });
    },
    /** достать файл с диска, а если его тут нет — из общего хранилища */
    rawBlob: function (id) {
      var self = this;
      return blobGet(id).then(function (b) {
        if (b) return b;
        if (typeof self.fetchRemote === 'function') return self.fetchRemote(id);
        return null;
      });
    },
    /** URL для показа; расшифровывает приватные файлы на лету */
    mediaURL: function (id) {
      var m = this.tree.media[id];
      if (!m) return Promise.resolve(null);
      if (!this.canSee(m.acl)) return Promise.resolve(null);
      return this.rawBlob(id).then(function (b) {
        if (!b) return null;
        if (!m.encrypted) return URL.createObjectURL(b);
        return decryptBlob(b, m.mime).then(function (d) { return URL.createObjectURL(d); })
          .catch(function () { return null; });
      });
    },
    mediaBlob: function (id) {
      var m = this.tree.media[id];
      if (!m) return Promise.resolve(null);
      return this.rawBlob(id).then(function (b) {
        if (!b) return null;
        if (!m.encrypted) return b;
        return decryptBlob(b, m.mime).catch(function () { return null; });
      });
    },

    /* --- права доступа --- */
    isAdmin: function () { return !!(this.session && this.session.role === 'admin'); },
    canSee: function (acl) {
      if (!acl) return true;
      if (this.isAdmin()) return true;
      if (acl.level === 'admin' || acl.level === 'owner') return false;
      // «только выбранным»: поимённый список тех, кому запись открыта
      if (acl.level === 'chosen') {
        return !!(this.session && (acl.allow || []).indexOf(this.session.userId) >= 0);
      }
      if (acl.level === 'group') return !!this.session;
      return true;
    },
    canEdit: function (acl) {
      if (this.isAdmin()) return true;
      if (!acl) return !!this.session;
      if (acl.locked) return false;
      if (acl.level === 'admin' || acl.level === 'owner') return false;
      if (acl.level === 'chosen') return this.canSee(acl);
      return !!this.session;
    },
    /** имена тех, кому открыта запись */
    allowedNames: function (acl) {
      var self = this;
      return ((acl && acl.allow) || []).map(function (id) {
        var u = self.users.filter(function (x) { return x.id === id; })[0];
        return u ? u.displayName : null;
      }).filter(Boolean);
    },

    /* --- пользователи --- */
    createUser: function (login, password, role, displayName) {
      var self = this;
      return hashPassword(password).then(function (kdf) {
        var u = {
          id: uid('U'), login: String(login).toLowerCase().trim(), kdf: kdf,
          role: role || 'user', displayName: displayName || login,
          created: nowISO(), updated: nowISO(),
          invite: uid('inv'), active: true, webauthn: null
        };
        self.users.push(u);
        self.log('user', 'Создан пользователь ' + u.displayName + ' (' +
          (u.role === 'admin' ? 'администратор' : 'пользователь') + ')');
        self.save();
        return u;
      });
    },
    /** задать новый пароль (приглашение, смена) */
    setPassword: function (user, password) {
      var self = this;
      return hashPassword(password).then(function (kdf) {
        user.kdf = kdf;
        delete user.hash;
        user.updated = nowISO();
        self.save();
        return user;
      });
    },
    auth: function (login, password) {
      var self = this;
      var u = this.users.filter(function (x) {
        return x.login === String(login).toLowerCase().trim();
      })[0];
      if (!u || !u.active) return Promise.resolve(null);
      return verifyPassword(u, password).then(function (ok) {
        if (!ok) return null;
        // запись старого образца — пересчитать по-новому
        if (!u.kdf || u.kdf.algo !== 'pbkdf2-sha256') {
          return self.setPassword(u, password).then(function () { return u; });
        }
        return u;
      });
    },
    unlockCrypto: function (passphrase) {
      var self = this;
      return deriveKey(passphrase + '::' + this.tree.meta.id, this.tree.meta.salt).then(function (k) {
        cryptoKey = k;
        return !!k;
      });
    },
    hasCryptoKey: function () { return !!cryptoKey; },

    /* --- вкладки --- */
    addTab: function (title, kind) {
      var t = {
        id: uid('tab'), title: title, kind: kind || 'notes',
        builtin: false, content: '', updated: nowISO()
      };
      this.tree.tabs.push(t);
      this.log('tab', 'Добавлена вкладка «' + title + '»');
      this.save();
      return t;
    },
    removeTab: function (id) {
      var had = this.tree.tabs.some(function (t) { return t.id === id && !t.builtin; });
      this.tree.tabs = this.tree.tabs.filter(function (t) { return t.id !== id || t.builtin; });
      if (had) this.bury(id);
      this.save();
    },

    /* --- поиск --- */
    search: function (q) {
      q = String(q || '').trim().toLowerCase();
      if (!q) return [];
      var self = this, res = [];
      this.persons().forEach(function (p) {
        var hay = [p.surname, p.given, p.patronymic, p.maiden, p.note,
          p.birth && p.birth.place, p.death && p.death.place,
          p.birth && p.birth.date, p.death && p.death.date].filter(Boolean).join(' ').toLowerCase();
        (p.fields || []).forEach(function (f) {
          if (self.canSee(f.acl)) hay += ' ' + (f.label || '') + ' ' + (f.value || '');
        });
        (p.events || []).forEach(function (e) {
          hay += ' ' + (e.type || '') + ' ' + (e.place || '') + ' ' + (e.note || '');
        });
        var i = hay.indexOf(q);
        if (i >= 0) res.push({ person: p, score: (self.fullName(p).toLowerCase().indexOf(q) === 0 ? 0 : 1) + i / 1000 });
      });
      this.allMedia().forEach(function (m) {
        if (!self.canSee(m.acl)) return;
        var hay = ((m.name || '') + ' ' + (m.caption || '')).toLowerCase();
        if (hay.indexOf(q) >= 0) res.push({ media: m, person: self.person(m.personId), score: 2 });
      });
      return res.sort(function (a, b) { return a.score - b.score; }).slice(0, 60);
    },

    /* --- календарь --- */
    upcoming: function (days) {
      days = days || 60;
      var self = this, today = new Date(), out = [];
      function push(p, kind, dateStr) {
        var d = parseDate(dateStr);
        if (!d || !d.m || !d.d) return;
        var year = today.getFullYear();
        var next = new Date(year, d.m - 1, d.d);
        if (next < new Date(year, today.getMonth(), today.getDate())) next = new Date(year + 1, d.m - 1, d.d);
        var diff = Math.round((next - new Date(year, today.getMonth(), today.getDate())) / 86400000);
        if (diff <= days) out.push({ person: p, kind: kind, date: next, in: diff, age: d.y ? next.getFullYear() - d.y : null });
      }
      this.persons().forEach(function (p) {
        if (p.living !== false && !(p.death && p.death.date)) push(p, 'birth', p.birth && p.birth.date);
        else push(p, 'memory', p.death && p.death.date);
        (p.events || []).forEach(function (e) {
          if (self.canSee(e.acl) && e.date) push(p, e.type || 'event', e.date);
        });
      });
      return out.sort(function (a, b) { return a.in - b.in; });
    },

    /* --- точки для карты --- */
    places: function () {
      var self = this, out = [];
      function add(p, kind, obj) {
        if (!obj || obj.lat == null || obj.lng == null) return;
        out.push({ person: p, kind: kind, lat: +obj.lat, lng: +obj.lng, place: obj.place || '', date: obj.date || '' });
      }
      this.persons().forEach(function (p) {
        add(p, 'birth', p.birth);
        add(p, 'death', p.death);
        (p.events || []).forEach(function (e) { if (self.canSee(e.acl)) add(p, e.type || 'event', e); });
      });
      return out;
    }
  };

  function kindOf(mime, name) {
    mime = mime || ''; name = (name || '').toLowerCase();
    if (mime.indexOf('image/') === 0) return 'photo';
    if (mime.indexOf('audio/') === 0) return 'audio';
    if (mime.indexOf('video/') === 0) return 'video';
    if (/\.(jpg|jpeg|png|gif|webp|heic)$/.test(name)) return 'photo';
    if (/\.(mp3|m4a|ogg|wav|opus)$/.test(name)) return 'audio';
    if (/\.(mp4|mov|webm|avi)$/.test(name)) return 'video';
    return 'doc';
  }

  function yr(s) {
    if (!s) return '';
    var m = String(s).match(/(\d{4})/);
    return m ? m[1] : '';
  }
  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (m) return { y: +m[3], m: +m[2], d: +m[1] };
    m = s.match(/^(\d{4})$/);
    if (m) return { y: +m[1], m: 0, d: 0 };
    var d = new Date(s);
    if (!isNaN(d)) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
    return null;
  }
  function formatDate(s) {
    var d = parseDate(s);
    if (!d) return s || '';
    if (!d.m || !d.d) return String(d.y);
    var mon = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return d.d + ' ' + mon[d.m - 1] + ' ' + d.y;
  }

  // список пользователей — это всегда tree.users, какое бы дерево ни подставили
  Object.defineProperty(Store, 'users', {
    get: function () {
      if (!Array.isArray(this.tree.users)) this.tree.users = [];
      return this.tree.users;
    },
    set: function (v) { this.tree.users = Array.isArray(v) ? v : []; }
  });

  Store.util = {
    uid: uid, clone: clone, nowISO: nowISO, parseDate: parseDate, formatDate: formatDate,
    yr: yr, kindOf: kindOf, sha256hex: sha256hex,
    hashPassword: hashPassword, verifyPassword: verifyPassword,
    encryptText: encryptText, decryptText: decryptText,
    encryptBlob: encryptBlob, decryptBlob: decryptBlob,
    blobPut: blobPut, blobGet: blobGet, blobDel: blobDel,
    newPerson: newPerson, newFamily: newFamily, emptyTree: emptyTree,
    defaultSync: defaultSync,
    bytesToB64: bytesToB64, b64ToBytes: b64ToBytes
  };

  global.Store = Store;
})(window);
