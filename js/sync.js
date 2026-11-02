/* Семейное Древо — синхронизация.

   Дерево у всех родственников общее, поэтому правки сливаются, а не затирают
   друг друга: каждая персона, семья, файл и вкладка живут отдельно и имеют
   время последней правки. При встрече двух копий по каждой записи побеждает
   та, что правилась позже. Удаления помечаются «следами» (tombstones), иначе
   запись, стёртая на телефоне, вернулась бы с компьютера.

   Порядок: забрать общее → слить со своим → отдать обратно → разобраться
   с файлами. Слияние идемпотентно: если чья-то отправка перебила чужую,
   следующая синхронизация вернёт потерянное обратно.

   Три способа хранения общих данных — Supabase, свой сервер, файл в облачном
   диске — отличаются только четырьмя действиями: pull, push, putMedia, getMedia. */
(function (global) {
  'use strict';
  var S = global.Store, U = S.util;

  /* ===================== слияние ===================== */

  function ts(x) { return x ? Date.parse(x) || 0 : 0; }

  /** позже ли a, чем b */
  function newer(a, b) { return ts(a) > ts(b); }

  /** слить два дерева. Возвращает { tree, stats } */
  function merge(local, remote) {
    if (!remote || !remote.persons) return { tree: local, stats: zeroStats() };

    // Человек присоединяется к общему дереву, а у него на устройстве ещё лежит
    // нетронутый образец. Сливать их нельзя — вышли бы двойники.
    if (local.meta && local.meta.demo && Object.keys(remote.persons).length) {
      var taken = JSON.parse(JSON.stringify(remote));
      var zs = zeroStats();
      zs.persons.added = Object.keys(remote.persons).length;
      zs.families.added = Object.keys(remote.families || {}).length;
      zs.media.added = Object.keys(remote.media || {}).length;
      return { tree: taken, stats: zs, replaced: true };
    }

    var out = JSON.parse(JSON.stringify(local));
    var st = zeroStats();

    out.tombstones = out.tombstones || {};
    var rt = remote.tombstones || {};
    for (var tid in rt) {
      if (!out.tombstones[tid] || newer(rt[tid], out.tombstones[tid])) out.tombstones[tid] = rt[tid];
    }
    var graves = out.tombstones;

    /* --- словари записей: персоны, семьи, медиа --- */
    ['persons', 'families', 'media'].forEach(function (kind) {
      out[kind] = out[kind] || {};
      var mine = out[kind], theirs = remote[kind] || {};
      var stampField = kind === 'media' ? 'updated' : 'updated';

      for (var id in theirs) {
        var r = theirs[id], l = mine[id];
        var rStamp = r[stampField] || r.added || r.updated;
        if (graves[id] && !newer(rStamp, graves[id])) continue;      // удалено позже, чем правилось
        if (!l) { mine[id] = r; st[kind].added++; continue; }
        var lStamp = l[stampField] || l.added || l.updated;
        if (newer(rStamp, lStamp)) { mine[id] = r; st[kind].updated++; }
      }
      // применить чужие удаления к своим записям
      for (var id2 in mine) {
        var m = mine[id2];
        var mStamp = m[stampField] || m.added || m.updated;
        if (graves[id2] && !newer(mStamp, graves[id2])) { delete mine[id2]; st[kind].removed++; }
      }
    });

    /* --- вкладки: по id, встроенные не трогаем --- */
    var tabs = {}, order = [];
    (out.tabs || []).concat(remote.tabs || []).forEach(function (t) {
      if (graves[t.id] && !t.builtin && !newer(t.updated, graves[t.id])) return;
      if (!tabs[t.id]) { tabs[t.id] = t; order.push(t.id); }
      else if (newer(t.updated, tabs[t.id].updated)) tabs[t.id] = t;
    });
    out.tabs = order.map(function (id) { return tabs[id]; });

    /* --- журнал изменений: объединение без повторов --- */
    var seen = {}, log = [];
    (out.changes || []).concat(remote.changes || []).forEach(function (c) {
      if (!c || seen[c.id]) return;
      seen[c.id] = 1;
      log.push(c);
    });
    log.sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
    out.changes = log.slice(0, 1000);
    st.changes = log.length - (local.changes || []).length;

    /* --- шапка дерева --- */
    // Имя берём у того, кто правил позже; личность дерева (id и соль шифрования)
    // всегда остаётся за общим хранилищем, иначе зашифрованные файлы перестанут открываться.
    if (remote.meta) {
      if (newer(remote.meta.updated, out.meta.updated)) {
        out.meta.name = remote.meta.name;
        if (remote.meta.rootId && out.persons[remote.meta.rootId]) out.meta.rootId = remote.meta.rootId;
      }
      out.meta.id = remote.meta.id || out.meta.id;
      out.meta.salt = remote.meta.salt || out.meta.salt;
      out.meta.updated = newer(remote.meta.updated, out.meta.updated) ? remote.meta.updated : out.meta.updated;
    }
    if (!out.meta.rootId || !out.persons[out.meta.rootId]) {
      out.meta.rootId = Object.keys(out.persons)[0] || null;
    }

    /* --- ссылки, оставшиеся в пустоту --- */
    cleanup(out);
    return { tree: out, stats: st };
  }

  function zeroStats() {
    return {
      persons: { added: 0, updated: 0, removed: 0 },
      families: { added: 0, updated: 0, removed: 0 },
      media: { added: 0, updated: 0, removed: 0 },
      changes: 0
    };
  }

  /** убрать ссылки на исчезнувшие записи */
  function cleanup(t) {
    for (var fid in t.families) {
      var f = t.families[fid];
      if (f.husb && !t.persons[f.husb]) f.husb = null;
      if (f.wife && !t.persons[f.wife]) f.wife = null;
      f.children = (f.children || []).filter(function (c) { return !!t.persons[c]; });
      if (!f.husb && !f.wife && !f.children.length) delete t.families[fid];
    }
    for (var pid in t.persons) {
      var p = t.persons[pid];
      p.media = (p.media || []).filter(function (m) { return !!t.media[m]; });
      if (p.photo && !t.media[p.photo]) p.photo = p.media[0] || null;
    }
    for (var mid in t.media) {
      var m = t.media[mid];
      if (m.personId && !t.persons[m.personId]) delete t.media[mid];
    }
  }

  function statsText(st) {
    var bits = [];
    function part(label, s) {
      var x = [];
      if (s.added) x.push('+' + s.added);
      if (s.updated) x.push('обновлено ' + s.updated);
      if (s.removed) x.push('убрано ' + s.removed);
      if (x.length) bits.push(label + ': ' + x.join(', '));
    }
    part('люди', st.persons);
    part('связи', st.families);
    part('файлы', st.media);
    return bits.length ? bits.join(' · ') : 'изменений нет';
  }

  /* ===================== ZIP для файлового режима ===================== */

  function unzip(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    // найти конец центрального каталога
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Это не ZIP-файл'));
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');
    var entries = [], p = cdOff;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      var lNameLen = dv.getUint16(lho + 26, true);
      var lExtraLen = dv.getUint16(lho + 28, true);
      var dataAt = lho + 30 + lNameLen + lExtraLen;
      entries.push({ name: name, method: method, data: u8.subarray(dataAt, dataAt + csize) });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    // разжать всё, что сжато
    return Promise.all(entries.map(function (e) {
      if (e.method === 0) return Promise.resolve(e);
      if (!global.DecompressionStream) return Promise.reject(new Error('Браузер не умеет распаковывать этот архив'));
      var ds = new DecompressionStream('deflate-raw');
      return new Response(new Blob([e.data]).stream().pipeThrough(ds)).arrayBuffer()
        .then(function (b) { return { name: e.name, method: 0, data: new Uint8Array(b) }; });
    })).then(function (list) {
      var map = {};
      list.forEach(function (e) { map[e.name] = e.data; });
      return map;
    });
  }

  /* ===================== способы хранения ===================== */

  function httpErr(r, what) {
    return r.text().then(function (t) {
      throw new Error(what + ': ' + r.status + (t ? ' — ' + t.slice(0, 160) : ''));
    });
  }

  var backends = {

    /* ---------- Supabase ---------- */
    supabase: {
      label: 'Supabase',
      needs: ['url', 'key', 'treeId'],
      head: function (cfg) {
        return { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key };
      },
      check: function (cfg) {
        var b = backends.supabase;
        return fetch(b.base(cfg) + '/rest/v1/trees?select=id&limit=1', { headers: b.head(cfg) })
          .then(function (r) {
            if (r.ok) return { ok: true, message: 'Связь есть, таблица найдена' };
            if (r.status === 404) return { ok: false, message: 'Таблица trees не создана — выполните SQL из инструкции' };
            if (r.status === 401 || r.status === 403) return { ok: false, message: 'Ключ не подошёл' };
            return { ok: false, message: 'Ответ сервера: ' + r.status };
          }, function (e) { return { ok: false, message: 'Сервер не отвечает: ' + e.message }; });
      },
      base: function (cfg) { return String(cfg.url || '').replace(/\/+$/, ''); },
      pull: function (cfg) {
        var b = backends.supabase;
        return fetch(b.base(cfg) + '/rest/v1/trees?id=eq.' + encodeURIComponent(cfg.treeId) + '&select=data',
          { headers: b.head(cfg) }).then(function (r) {
            if (!r.ok) return httpErr(r, 'Чтение дерева');
            return r.json();
          }).then(function (rows) { return rows && rows[0] ? rows[0].data : null; });
      },
      push: function (cfg, tree) {
        var b = backends.supabase;
        return fetch(b.base(cfg) + '/rest/v1/trees', {
          method: 'POST',
          headers: Object.assign(b.head(cfg), {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          }),
          body: JSON.stringify({ id: cfg.treeId, data: tree, updated_at: new Date().toISOString() })
        }).then(function (r) { if (!r.ok) return httpErr(r, 'Запись дерева'); });
      },
      putMedia: function (cfg, id, blob) {
        var b = backends.supabase;
        var path = '/storage/v1/object/drevo/' + encodeURIComponent(cfg.treeId) + '/' + encodeURIComponent(id);
        return fetch(b.base(cfg) + path, {
          method: 'POST',
          headers: Object.assign(b.head(cfg), { 'x-upsert': 'true', 'Content-Type': 'application/octet-stream' }),
          body: blob
        }).then(function (r) { if (!r.ok) return httpErr(r, 'Отправка файла'); });
      },
      getMedia: function (cfg, id) {
        var b = backends.supabase;
        var path = '/storage/v1/object/drevo/' + encodeURIComponent(cfg.treeId) + '/' + encodeURIComponent(id);
        return fetch(b.base(cfg) + path, { headers: b.head(cfg) })
          .then(function (r) { return r.ok ? r.blob() : null; });
      }
    },

    /* ---------- свой сервер ---------- */
    server: {
      label: 'Свой сервер',
      needs: ['url', 'key'],
      base: function (cfg) { return String(cfg.url || '').replace(/\/+$/, ''); },
      head: function (cfg) { return { 'X-Drevo-Key': cfg.key }; },
      check: function (cfg) {
        var b = backends.server;
        return fetch(b.base(cfg) + '/api/health', { headers: b.head(cfg) }).then(function (r) {
          if (r.ok) return r.json().then(function (j) {
            return { ok: true, message: 'Сервер отвечает, персон в хранилище: ' + (j.persons != null ? j.persons : '—') };
          });
          if (r.status === 401) return { ok: false, message: 'Ключ доступа не подошёл' };
          return { ok: false, message: 'Ответ сервера: ' + r.status };
        }, function (e) { return { ok: false, message: 'Сервер не отвечает: ' + e.message }; });
      },
      pull: function (cfg) {
        var b = backends.server;
        return fetch(b.base(cfg) + '/api/tree', { headers: b.head(cfg) }).then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) return httpErr(r, 'Чтение дерева');
          return r.json();
        }).then(function (j) { return j && j.persons ? j : null; });
      },
      push: function (cfg, tree) {
        var b = backends.server;
        return fetch(b.base(cfg) + '/api/tree', {
          method: 'PUT',
          headers: Object.assign(b.head(cfg), { 'Content-Type': 'application/json' }),
          body: JSON.stringify(tree)
        }).then(function (r) { if (!r.ok) return httpErr(r, 'Запись дерева'); });
      },
      putMedia: function (cfg, id, blob) {
        var b = backends.server;
        return fetch(b.base(cfg) + '/api/media/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: Object.assign(b.head(cfg), { 'Content-Type': 'application/octet-stream' }),
          body: blob
        }).then(function (r) { if (!r.ok) return httpErr(r, 'Отправка файла'); });
      },
      getMedia: function (cfg, id) {
        var b = backends.server;
        return fetch(b.base(cfg) + '/api/media/' + encodeURIComponent(id), { headers: b.head(cfg) })
          .then(function (r) { return r.ok ? r.blob() : null; });
      }
    },

    /* ---------- файл в облачном диске ----------
       Работает через File System Access API: программа один раз получает
       разрешение на файл внутри папки Яндекс.Диска или Google Диска,
       дальше читает и пишет его сама. Диск разносит файл по устройствам. */
    file: {
      label: 'Облачный диск',
      needs: [],
      supported: function () {
        return typeof global.showOpenFilePicker === 'function' && typeof global.showSaveFilePicker === 'function';
      },
      handle: null,
      check: function () {
        if (!backends.file.supported()) {
          return Promise.resolve({
            ok: false,
            message: 'Этот браузер не умеет работать с файлом напрямую. На телефоне пользуйтесь обменом через «Данные → Полная копия».'
          });
        }
        if (!backends.file.handle) return Promise.resolve({ ok: false, message: 'Файл не выбран' });
        return backends.file.handle.getFile().then(function (f) {
          return { ok: true, message: 'Файл «' + f.name + '», ' + Math.round(f.size / 1024) + ' КБ' };
        }, function () { return { ok: false, message: 'Файл стал недоступен — выберите заново' }; });
      },
      /** выбрать существующий файл обмена */
      open: function () {
        return global.showOpenFilePicker({
          types: [{ description: 'Семейное Древо', accept: { 'application/zip': ['.drevo', '.zip'] } }],
          multiple: false
        }).then(function (hs) {
          backends.file.handle = hs[0];
          return saveHandle(hs[0]);
        });
      },
      /** создать новый файл обмена */
      create: function (name) {
        return global.showSaveFilePicker({
          suggestedName: (name || 'Семейное Древо') + '.drevo',
          types: [{ description: 'Семейное Древо', accept: { 'application/zip': ['.drevo'] } }]
        }).then(function (h) {
          backends.file.handle = h;
          return saveHandle(h);
        });
      },
      _cache: null,
      pull: function () {
        var b = backends.file;
        if (!b.handle) return Promise.reject(new Error('Файл обмена не выбран'));
        return b.handle.getFile().then(function (f) {
          if (!f.size) { b._cache = {}; return null; }
          return f.arrayBuffer().then(unzip).then(function (map) {
            b._cache = map;
            var j = map['drevo.json'];
            if (!j) return null;
            return JSON.parse(new TextDecoder().decode(j));
          });
        });
      },
      push: function (cfg, tree) {
        var b = backends.file;
        if (!b.handle) return Promise.reject(new Error('Файл обмена не выбран'));
        var files = [{ name: 'drevo.json', data: new TextEncoder().encode(JSON.stringify(tree)) }];
        var pend = b._pending || {};
        // всё, что уже лежало в файле, кроме перезаписанного
        var keep = b._cache || {};
        Object.keys(keep).forEach(function (n) {
          if (n === 'drevo.json') return;
          var id = n.replace(/^media\//, '');
          if (pend[id]) return;
          if (!tree.media[id]) return;                 // файл удалили — не переносим
          files.push({ name: n, data: keep[n] });
        });
        var ids = Object.keys(pend);
        return Promise.all(ids.map(function (id) {
          return pend[id].arrayBuffer().then(function (ab) {
            files.push({ name: 'media/' + id, data: new Uint8Array(ab) });
          });
        })).then(function () {
          var blob = global.IO.zip(files);
          return b.handle.createWritable().then(function (w) {
            return w.write(blob).then(function () { return w.close(); });
          });
        }).then(function () {
          b._pending = {};
          // обновить представление о содержимом файла
          var map = {};
          files.forEach(function (f) { map[f.name] = f.data; });
          b._cache = map;
        });
      },
      putMedia: function (cfg, id, blob) {
        var b = backends.file;
        b._pending = b._pending || {};
        b._pending[id] = blob;
        return Promise.resolve();
      },
      getMedia: function (cfg, id) {
        var b = backends.file;
        var d = b._cache && b._cache['media/' + id];
        return Promise.resolve(d ? new Blob([d]) : null);
      }
    }
  };

  /* запомнить выбранный файл между запусками */
  function saveHandle(h) {
    return U.blobPut('__sync_handle', h).catch(function () {});
  }
  function loadHandle() {
    return U.blobGet('__sync_handle').then(function (h) {
      if (!h || !h.queryPermission) return null;
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') { backends.file.handle = h; return h; }
        return h;         // разрешение спросим при первой записи
      }).catch(function () { return null; });
    }).catch(function () { return null; });
  }

  /* ===================== запуск ===================== */

  var Sync = {
    backends: backends,
    merge: merge,
    unzip: unzip,
    statsText: statsText,
    busy: false,
    listeners: [],

    on: function (fn) { this.listeners.push(fn); },
    emit: function (state) {
      this.listeners.forEach(function (f) { try { f(state); } catch (e) {} });
    },

    cfg: function () {
      var s = S.sync || {};
      return s[s.mode] || {};
    },
    backend: function () {
      var s = S.sync || {};
      return backends[s.mode] || null;
    },
    ready: function () {
      var b = this.backend();
      if (!b) return false;
      if (b === backends.file) return !!backends.file.handle;
      var cfg = this.cfg();
      return b.needs.every(function (k) { return !!String(cfg[k] || '').trim(); });
    },

    restore: function () { return loadHandle(); },

    /** полный проход: забрать → слить → отдать → файлы */
    run: function (opts) {
      opts = opts || {};
      var self = this;
      var b = this.backend(), cfg = this.cfg();
      if (!b) return Promise.reject(new Error('Способ синхронизации не выбран'));
      if (!this.ready()) return Promise.reject(new Error('Синхронизация настроена не до конца'));
      if (this.busy) return Promise.reject(new Error('Синхронизация уже идёт'));

      this.busy = true;
      this.emit({ state: 'run', text: 'Синхронизация…' });
      var report = { pulled: null, stats: null, up: 0, down: 0 };

      return b.pull(cfg)
        .then(function (remote) {
          report.pulled = remote;
          var res = merge(S.tree, remote);
          report.stats = res.stats;
          // сохранить слияние у себя
          S.tree = res.tree;
          S.save(true);
          return b.push(cfg, S.tree);
        })
        .then(function () { return self.syncMedia(b, cfg, opts, report); })
        .then(function () {
          S.sync.lastAt = new Date().toISOString();
          S.sync.lastError = null;
          S.dirty = false;
          S.saveSync();
          self.busy = false;
          var txt = statsText(report.stats) +
            (report.up ? ' · отправлено файлов: ' + report.up : '') +
            (report.down ? ' · получено файлов: ' + report.down : '');
          self.emit({ state: 'ok', text: txt, report: report });
          return report;
        })
        .catch(function (e) {
          self.busy = false;
          S.sync.lastError = e.message;
          S.saveSync();
          self.emit({ state: 'error', text: e.message });
          throw e;
        });
    },

    /** отправить свои новые файлы; забрать чужие, если велено */
    syncMedia: function (b, cfg, opts, report) {
      var self = this;
      var mine = [], theirs = [];
      Object.keys(S.tree.media).forEach(function (id) {
        var m = S.tree.media[id];
        if (!m.uploaded) mine.push(id);
      });

      function upload() {
        if (!mine.length) return Promise.resolve();
        var i = 0;
        function step() {
          if (i >= mine.length) return Promise.resolve();
          var id = mine[i++];
          self.emit({ state: 'run', text: 'Отправка файлов ' + i + ' из ' + mine.length });
          return U.blobGet(id).then(function (blob) {
            if (!blob) { return; }                      // файла нет на этом устройстве
            return b.putMedia(cfg, id, blob).then(function () {
              if (S.tree.media[id]) {
                S.tree.media[id].uploaded = true;
                S.tree.media[id].updated = new Date().toISOString();
              }
              report.up++;
            });
          }).catch(function (e) { console.warn('Файл не ушёл', id, e); }).then(step);
        }
        return step();
      }

      function findMissing() {
        var ids = Object.keys(S.tree.media).filter(function (id) { return S.tree.media[id].uploaded; });
        var i = 0, missing = [];
        function step() {
          if (i >= ids.length) return Promise.resolve(missing);
          var id = ids[i++];
          return U.blobGet(id).then(function (bl) { if (!bl) missing.push(id); }).then(step);
        }
        return step();
      }

      function download(list) {
        if (!list.length) return Promise.resolve();
        var i = 0;
        function step() {
          if (i >= list.length) return Promise.resolve();
          var id = list[i++];
          self.emit({ state: 'run', text: 'Загрузка файлов ' + i + ' из ' + list.length });
          return b.getMedia(cfg, id).then(function (blob) {
            if (blob) return U.blobPut(id, blob).then(function () { report.down++; });
          }).catch(function (e) { console.warn('Файл не пришёл', id, e); }).then(step);
        }
        return step();
      }

      return upload()
        .then(function () { return mine.length ? b.push(cfg, S.tree) : null; })  // отметки «отправлено»
        .then(findMissing)
        .then(function (missing) {
          report.missing = missing.length;
          if (opts.media === false) return null;      // откладываем до открытия файла
          return download(missing);
        })
        .then(function () { S.save(true); });
    },

    /** заглянуть в общее хранилище, ничего не меняя у себя */
    peek: function () {
      var b = this.backend();
      if (!b || !this.ready()) return Promise.resolve(null);
      return b.pull(this.cfg());
    },

    /** отдать своё дерево, не принимая чужого (для «заменить общее моим») */
    pushOnly: function () {
      var self = this, b = this.backend(), cfg = this.cfg();
      if (!b) return Promise.reject(new Error('Способ синхронизации не выбран'));
      this.busy = true;
      this.emit({ state: 'run', text: 'Отправка дерева…' });
      var report = { stats: zeroStats(), up: 0, down: 0 };
      return b.push(cfg, S.tree)
        .then(function () { return self.syncMedia(b, cfg, { media: false }, report); })
        .then(function () {
          S.sync.lastAt = new Date().toISOString();
          S.sync.lastError = null;
          S.dirty = false;
          S.saveSync();
          self.busy = false;
          self.emit({ state: 'ok', text: 'Дерево отправлено', report: report });
          return report;
        })
        .catch(function (e) {
          self.busy = false;
          S.sync.lastError = e.message;
          S.saveSync();
          self.emit({ state: 'error', text: e.message });
          throw e;
        });
    },

    /** подтянуть один файл по требованию — когда его открывают, а локально его нет */
    fetchOne: function (id) {
      var b = this.backend(), cfg = this.cfg();
      var m = S.tree.media[id];
      if (!b || !m || !m.uploaded || !this.ready()) return Promise.resolve(null);
      return b.getMedia(cfg, id).then(function (blob) {
        if (!blob) return null;
        return U.blobPut(id, blob).then(function () { return blob; });
      }).catch(function () { return null; });
    },

    /* автоматический проход по таймеру */
    timer: null,
    schedule: function () {
      var self = this;
      clearInterval(this.timer);
      if (!S.sync || !S.sync.auto || S.sync.mode === 'off') return;
      var every = Math.max(30, S.sync.interval || 120) * 1000;
      this.timer = setInterval(function () {
        if (self.busy || !self.ready()) return;
        if (global.navigator && navigator.onLine === false) return;
        self.run({ media: true }).catch(function () {});
      }, every);
    },
    stop: function () { clearInterval(this.timer); this.timer = null; }
  };

  // дать хранилищу способ подтянуть недостающий файл
  S.fetchRemote = function (id) { return Sync.fetchOne(id); };

  global.Sync = Sync;
})(window);
