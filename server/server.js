#!/usr/bin/env node
/* Сервер синхронизации «Семейного Древа».
   Чистый Node.js, без единой сторонней библиотеки — ставить нечего.

   Запуск:   node server.js
   Ключ:     DREVO_KEY=ваш-пароль node server.js
   Порт:     PORT=8080 node server.js

   Данные лежат рядом, в папке data: дерево в tree.json, файлы в data/media.
   Сервер заодно отдаёт саму программу, если положить её файлы в папку выше. */

'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var PORT = parseInt(process.env.PORT || '8080', 10);
var KEY = process.env.DREVO_KEY || '';
var ROOT = __dirname;
var DATA = path.join(ROOT, 'data');
var MEDIA = path.join(DATA, 'media');
var TREE = path.join(DATA, 'tree.json');
var APP = path.resolve(ROOT, '..');          // папка с index.html
var MAX_TREE = 64 * 1024 * 1024;             // 64 МБ на дерево
var MAX_FILE = 256 * 1024 * 1024;            // 256 МБ на один файл

[DATA, MEDIA].forEach(function (d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

if (!KEY) {
  KEY = require('crypto').randomBytes(9).toString('base64url');
  var keyFile = path.join(DATA, 'key.txt');
  if (fs.existsSync(keyFile)) KEY = fs.readFileSync(keyFile, 'utf8').trim();
  else fs.writeFileSync(keyFile, KEY);
  console.log('Ключ доступа: ' + KEY + '   (лежит в ' + keyFile + ')');
}

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Drevo-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function send(res, code, body, type) {
  cors(res);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj)); }

function authed(req) {
  var k = req.headers['x-drevo-key'];
  if (Array.isArray(k)) k = k[0];
  return String(k || '') === KEY;
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** запись через временный файл — чтобы обрыв связи не испортил дерево */
function writeAtomic(file, buf) {
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** имя файла из запроса не должно уводить из своей папки */
function safeId(id) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

var server = http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  var p = decodeURIComponent(u.pathname);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  /* ---------- синхронизация ---------- */
  if (p.indexOf('/api/') === 0) {
    if (!authed(req)) { json(res, 401, { error: 'Ключ доступа не подошёл' }); return; }

    if (p === '/api/health' && req.method === 'GET') {
      var count = null, when = null;
      try {
        var t = JSON.parse(fs.readFileSync(TREE, 'utf8'));
        count = Object.keys(t.persons || {}).length;
        when = t.meta && t.meta.updated;
      } catch (e) {}
      var files = 0;
      try { files = fs.readdirSync(MEDIA).length; } catch (e) {}
      json(res, 200, { ok: true, persons: count, files: files, updated: when });
      return;
    }

    if (p === '/api/tree' && req.method === 'GET') {
      if (!fs.existsSync(TREE)) { json(res, 404, { error: 'Дерева ещё нет' }); return; }
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(TREE).pipe(res);
      return;
    }

    if (p === '/api/tree' && req.method === 'PUT') {
      readBody(req, MAX_TREE).then(function (buf) {
        var tree;
        try { tree = JSON.parse(buf.toString('utf8')); }
        catch (e) { json(res, 400, { error: 'Это не JSON' }); return; }
        if (!tree || typeof tree.persons !== 'object') {
          json(res, 400, { error: 'В данных нет персон' }); return;
        }
        // перед заменой откладываем предыдущую версию — на случай ошибки
        try {
          if (fs.existsSync(TREE)) {
            var hist = path.join(DATA, 'history');
            if (!fs.existsSync(hist)) fs.mkdirSync(hist);
            var stamp = new Date().toISOString().replace(/[:.]/g, '-');
            fs.copyFileSync(TREE, path.join(hist, 'tree-' + stamp + '.json'));
            var old = fs.readdirSync(hist).sort();
            while (old.length > 40) fs.unlinkSync(path.join(hist, old.shift()));
          }
        } catch (e) { console.warn('История не сохранилась:', e.message); }
        writeAtomic(TREE, buf);
        json(res, 200, { ok: true, persons: Object.keys(tree.persons).length });
      }).catch(function (e) { json(res, 413, { error: e.message }); });
      return;
    }

    var m = p.match(/^\/api\/media\/(.+)$/);
    if (m) {
      var id = safeId(m[1]);
      if (!id) { json(res, 400, { error: 'Недопустимое имя файла' }); return; }
      var file = path.join(MEDIA, id);
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) { json(res, 404, { error: 'Файла нет' }); return; }
        cors(res);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(file).size
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (req.method === 'PUT') {
        readBody(req, MAX_FILE).then(function (buf) {
          writeAtomic(file, buf);
          json(res, 200, { ok: true, size: buf.length });
        }).catch(function (e) { json(res, 413, { error: e.message }); });
        return;
      }
      if (req.method === 'DELETE') {
        try { fs.unlinkSync(file); } catch (e) {}
        json(res, 200, { ok: true });
        return;
      }
    }

    json(res, 404, { error: 'Нет такого запроса' });
    return;
  }

  /* ---------- сама программа ---------- */
  if (req.method !== 'GET') { json(res, 405, { error: 'Так нельзя' }); return; }
  var rel = p === '/' ? '/index.html' : p;
  var file = path.join(APP, rel);
  if (file.indexOf(APP) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, 'Не найдено', 'text/plain; charset=utf-8');
    return;
  }
  cors(res);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, function () {
  console.log('Семейное Древо — сервер синхронизации');
  console.log('  адрес:  http://localhost:' + PORT);
  console.log('  данные: ' + DATA);
  console.log('');
  console.log('В настройках программы: Синхронизация → Свой сервер,');
  console.log('адрес сервера и ключ доступа, указанный выше.');
});
