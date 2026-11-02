/* Семейное Древо — импорт, экспорт и резервные копии.
   GEDCOM 5.5.1 (UTF-8), простой текст, SVG, PDF (через печать), ZIP с фотографиями. */
(function (global) {
  'use strict';
  var S = global.Store;
  var U = S.util;

  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /* ---------------- GEDCOM: выгрузка ---------------- */
  function gedDate(s) {
    var d = U.parseDate(s);
    if (!d) return s || '';
    if (!d.m || !d.d) return String(d.y);
    return d.d + ' ' + MON[d.m - 1] + ' ' + d.y;
  }
  function exportGEDCOM() {
    var t = S.tree, L = [];
    L.push('0 HEAD');
    L.push('1 SOUR SEMDREVO');
    L.push('2 NAME Семейное Древо');
    L.push('2 VERS 1.0');
    L.push('1 DATE ' + gedDate(new Date().toISOString().slice(0, 10)));
    L.push('1 CHAR UTF-8');
    L.push('1 GEDC');
    L.push('2 VERS 5.5.1');
    L.push('2 FORM LINEAGE-LINKED');
    L.push('1 FILE ' + (t.meta.name || 'tree') + '.ged');

    var pid = {}, fid = {}, n = 1;
    S.persons().forEach(function (p) { pid[p.id] = '@I' + (n++) + '@'; });
    n = 1;
    S.families().forEach(function (f) { fid[f.id] = '@F' + (n++) + '@'; });

    S.persons().forEach(function (p) {
      L.push('0 ' + pid[p.id] + ' INDI');
      var given = [p.given, p.patronymic].filter(Boolean).join(' ');
      L.push('1 NAME ' + given + ' /' + (p.surname || '') + '/');
      if (given) L.push('2 GIVN ' + given);
      if (p.surname) L.push('2 SURN ' + p.surname);
      if (p.maiden) { L.push('1 NAME /' + p.maiden + '/'); L.push('2 TYPE maiden'); }
      L.push('1 SEX ' + (p.sex === 'M' || p.sex === 'F' ? p.sex : 'U'));
      if (p.birth && (p.birth.date || p.birth.place)) {
        L.push('1 BIRT');
        if (p.birth.date) L.push('2 DATE ' + gedDate(p.birth.date));
        if (p.birth.place) L.push('2 PLAC ' + p.birth.place);
        if (p.birth.lat != null && p.birth.lng != null) {
          L.push('2 MAP'); L.push('3 LATI ' + mapCoord(p.birth.lat, 'N', 'S')); L.push('3 LONG ' + mapCoord(p.birth.lng, 'E', 'W'));
        }
      }
      if (p.death && (p.death.date || p.death.place)) {
        L.push('1 DEAT');
        if (p.death.date) L.push('2 DATE ' + gedDate(p.death.date));
        if (p.death.place) L.push('2 PLAC ' + p.death.place);
      }
      (p.events || []).forEach(function (e) {
        if (!S.canSee(e.acl)) return;
        L.push('1 EVEN' + (e.note ? ' ' + oneLine(e.note) : ''));
        L.push('2 TYPE ' + (e.type || 'событие'));
        if (e.date) L.push('2 DATE ' + gedDate(e.date));
        if (e.place) L.push('2 PLAC ' + e.place);
      });
      (p.fields || []).forEach(function (f) {
        if (!S.canSee(f.acl)) return;
        if (f.type === 'phone') L.push('1 PHON ' + oneLine(f.value));
        else if (f.type === 'email') L.push('1 EMAIL ' + oneLine(f.value));
        else if (f.type === 'addr') L.push('1 ADDR ' + oneLine(f.value));
        else { L.push('1 FACT ' + oneLine(f.value)); L.push('2 TYPE ' + oneLine(f.label || 'сведения')); }
      });
      if (p.note) pushNote(L, 1, p.note);
      var cf = S.childFamily(p.id);
      if (cf) L.push('1 FAMC ' + fid[cf.id]);
      S.spouseFamilies(p.id).forEach(function (f) { L.push('1 FAMS ' + fid[f.id]); });
      (p.media || []).forEach(function (mid) {
        var m = S.tree.media[mid];
        if (!m || !S.canSee(m.acl)) return;
        L.push('1 OBJE');
        L.push('2 FILE media/' + mid + '_' + safeName(m.name));
        L.push('2 FORM ' + (m.mime || '').split('/').pop());
        if (m.caption) L.push('2 TITL ' + oneLine(m.caption));
      });
      L.push('1 CHAN');
      L.push('2 DATE ' + gedDate((p.updated || '').slice(0, 10)));
    });

    S.families().forEach(function (f) {
      L.push('0 ' + fid[f.id] + ' FAM');
      if (f.husb && pid[f.husb]) L.push('1 HUSB ' + pid[f.husb]);
      if (f.wife && pid[f.wife]) L.push('1 WIFE ' + pid[f.wife]);
      f.children.forEach(function (c) { if (pid[c]) L.push('1 CHIL ' + pid[c]); });
      if (f.marriage && (f.marriage.date || f.marriage.place)) {
        L.push('1 MARR');
        if (f.marriage.date) L.push('2 DATE ' + gedDate(f.marriage.date));
        if (f.marriage.place) L.push('2 PLAC ' + f.marriage.place);
      }
      if (f.divorced) L.push('1 DIV Y');
    });

    L.push('0 TRLR');
    return L.join('\r\n') + '\r\n';
  }
  function mapCoord(v, pos, neg) { return (v >= 0 ? pos : neg) + Math.abs(v).toFixed(6); }
  function oneLine(s) { return String(s || '').replace(/\s*\n\s*/g, ' ').trim(); }
  function safeName(s) { return String(s || 'file').replace(/[^\wа-яА-ЯёЁ.\-]+/g, '_'); }
  function pushNote(L, lvl, text) {
    var lines = String(text).split(/\r?\n/);
    L.push(lvl + ' NOTE ' + lines[0]);
    for (var i = 1; i < lines.length; i++) L.push((lvl + 1) + ' CONT ' + lines[i]);
  }

  /* ---------------- GEDCOM: загрузка ---------------- */
  function parseGedDate(s) {
    if (!s) return '';
    s = s.replace(/^(ABT|EST|CAL|BEF|AFT|FROM|TO)\s+/i, '').trim();
    var m = s.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/i);
    if (m) {
      var mi = MON.indexOf(m[2].toUpperCase());
      if (mi >= 0) return m[3] + '-' + pad(mi + 1) + '-' + pad(+m[1]);
    }
    m = s.match(/^([A-Z]{3})\s+(\d{4})$/i);
    if (m) { var k = MON.indexOf(m[1].toUpperCase()); if (k >= 0) return m[2] + '-' + pad(k + 1); }
    m = s.match(/(\d{4})/);
    return m ? m[1] : s;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function importGEDCOM(text) {
    var lines = String(text).replace(/﻿/g, '').split(/\r?\n/);
    var recs = [], cur = null, stack = [];
    lines.forEach(function (raw) {
      var m = raw.match(/^\s*(\d+)\s+(@[^@]+@\s+)?(\w+)\s?(.*)$/);
      if (!m) return;
      var lvl = +m[1], xref = (m[2] || '').trim(), tag = m[3], val = m[4] || '';
      var node = { lvl: lvl, xref: xref, tag: tag, val: val, kids: [] };
      if (lvl === 0) { cur = node; recs.push(node); stack = [node]; return; }
      if (!stack.length) return;
      stack.length = Math.min(stack.length, lvl);
      var parent = stack[lvl - 1];
      if (!parent) return;
      if (tag === 'CONT') { parent.val += '\n' + val; return; }
      if (tag === 'CONC') { parent.val += val; return; }
      parent.kids.push(node);
      stack[lvl] = node;
    });

    var tree = U.emptyTree();
    tree.meta.name = 'Импортированное дерево';
    var byXref = {}, famXref = {};
    function kid(node, tag) { return node.kids.filter(function (k) { return k.tag === tag; })[0]; }
    function kids(node, tag) { return node.kids.filter(function (k) { return k.tag === tag; }); }

    recs.forEach(function (r) {
      if (r.tag === 'INDI') {
        var p = U.newPerson();
        var nameNode = kid(r, 'NAME');
        if (nameNode) {
          var nm = nameNode.val || '';
          var sur = (nm.match(/\/([^\/]*)\//) || [])[1] || '';
          var giv = nm.replace(/\/[^\/]*\//, '').trim();
          var gn = kid(nameNode, 'GIVN'), sn = kid(nameNode, 'SURN');
          p.surname = (sn && sn.val) || sur;
          var parts = ((gn && gn.val) || giv).split(/\s+/).filter(Boolean);
          p.given = parts[0] || '';
          p.patronymic = parts.slice(1).join(' ');
        }
        var sx = kid(r, 'SEX');
        p.sex = sx && /^[MF]/.test(sx.val) ? sx.val[0] : 'U';
        var b = kid(r, 'BIRT');
        if (b) {
          p.birth.date = parseGedDate((kid(b, 'DATE') || {}).val);
          p.birth.place = ((kid(b, 'PLAC') || {}).val || '').trim();
        }
        var d = kid(r, 'DEAT');
        if (d) {
          p.death.date = parseGedDate((kid(d, 'DATE') || {}).val);
          p.death.place = ((kid(d, 'PLAC') || {}).val || '').trim();
          p.living = false;
        }
        var note = kid(r, 'NOTE');
        if (note) p.note = note.val;
        kids(r, 'PHON').forEach(function (x) {
          p.fields.push({ id: U.uid('f'), label: 'Телефон', value: x.val, type: 'phone', acl: { level: 'group', locked: false } });
        });
        kids(r, 'EMAIL').forEach(function (x) {
          p.fields.push({ id: U.uid('f'), label: 'Почта', value: x.val, type: 'email', acl: { level: 'group', locked: false } });
        });
        kids(r, 'EVEN').forEach(function (x) {
          p.events.push({
            id: U.uid('e'), type: ((kid(x, 'TYPE') || {}).val) || 'Событие',
            date: parseGedDate((kid(x, 'DATE') || {}).val), place: ((kid(x, 'PLAC') || {}).val || ''),
            note: x.val || '', lat: null, lng: null, acl: { level: 'public', locked: false }
          });
        });
        tree.persons[p.id] = p;
        byXref[r.xref] = p.id;
      }
    });
    recs.forEach(function (r) {
      if (r.tag === 'FAM') {
        var f = U.newFamily();
        var h = kid(r, 'HUSB'), w = kid(r, 'WIFE');
        if (h) f.husb = byXref[(h.val || '').trim()] || null;
        if (w) f.wife = byXref[(w.val || '').trim()] || null;
        kids(r, 'CHIL').forEach(function (c) {
          var id = byXref[(c.val || '').trim()];
          if (id) f.children.push(id);
        });
        var mr = kid(r, 'MARR');
        if (mr) {
          f.marriage.date = parseGedDate((kid(mr, 'DATE') || {}).val);
          f.marriage.place = ((kid(mr, 'PLAC') || {}).val || '');
        }
        if (kid(r, 'DIV')) f.divorced = true;
        tree.families[f.id] = f;
        famXref[r.xref] = f.id;
      }
    });
    var ids = Object.keys(tree.persons);
    tree.meta.rootId = ids[0] || null;
    return tree;
  }

  /* ---------------- импорт обычного текста ----------------
     Поддержаны строки вида:
       Фамилия Имя Отчество | м | 1935-05-12 | 1977 | с. Матур
       + ребёнок: Фамилия Имя Отчество
       = супруг: Фамилия Имя Отчество
     и простой отступ табуляцией — отступ означает «ребёнок предыдущего». */
  function importText(text) {
    var tree = U.emptyTree();
    tree.meta.name = 'Дерево из текста';
    var stack = [];
    String(text).split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var indent = (raw.match(/^[\t ]*/)[0] || '').replace(/ {2}/g, '\t').length;
      var line = raw.trim();
      var rel = null;
      if (/^[+•-]\s*(ребен|ребён|сын|доч)/i.test(line)) { rel = 'child'; line = line.replace(/^[+•-]\s*\S+\s*:?\s*/i, ''); }
      else if (/^=\s*(супруг|жена|муж)/i.test(line)) { rel = 'spouse'; line = line.replace(/^=\s*\S+\s*:?\s*/i, ''); }
      else if (/^[+•-]\s+/.test(line)) { rel = 'child'; line = line.replace(/^[+•-]\s+/, ''); }

      var cells = line.split(/\s*[|;]\s*/);
      var nameParts = (cells[0] || '').split(/\s+/).filter(Boolean);
      var p = U.newPerson({
        surname: nameParts[0] || '', given: nameParts[1] || '', patronymic: nameParts.slice(2).join(' ')
      });
      for (var i = 1; i < cells.length; i++) {
        var c = cells[i].trim();
        if (/^(м|муж|m|male)$/i.test(c)) p.sex = 'M';
        else if (/^(ж|жен|f|female)$/i.test(c)) p.sex = 'F';
        else if (/^\d{4}([-.\/]\d{1,2}([-.\/]\d{1,2})?)?$/.test(c)) {
          if (!p.birth.date) p.birth.date = norm(c); else { p.death.date = norm(c); p.living = false; }
        } else if (!p.birth.place) p.birth.place = c;
        else p.note = (p.note ? p.note + '\n' : '') + c;
      }
      tree.persons[p.id] = p;
      if (rel === 'spouse' && stack.length) {
        var f = U.newFamily();
        var prev = stack[stack.length - 1].id;
        var pr = tree.persons[prev];
        if (pr.sex === 'F') { f.wife = prev; f.husb = p.id; } else { f.husb = prev; f.wife = p.id; }
        tree.families[f.id] = f;
        return;
      }
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      var parent = stack[stack.length - 1];
      if (parent || rel === 'child') {
        var par = parent ? parent.id : null;
        if (par) {
          var fam = null;
          for (var fid in tree.families) {
            var ff = tree.families[fid];
            if (ff.husb === par || ff.wife === par) { fam = ff; break; }
          }
          if (!fam) {
            fam = U.newFamily();
            if (tree.persons[par].sex === 'F') fam.wife = par; else fam.husb = par;
            tree.families[fam.id] = fam;
          }
          fam.children.push(p.id);
        }
      }
      stack.push({ id: p.id, indent: indent });
    });
    tree.meta.rootId = Object.keys(tree.persons)[0] || null;
    return tree;
    function norm(c) { return c.replace(/[.\/]/g, '-'); }
  }

  /* ---------------- SVG дерева ---------------- */
  function exportSVG(treeView) {
    var res = treeView.compute();
    var W = res.w, H = res.h;
    var css = [
      '.n{stroke-width:1}',
      '.m{fill:url(#gm);stroke:#6aa9d4}',
      '.f{fill:url(#gf);stroke:#dd8fae}',
      '.u{fill:url(#gu);stroke:#bdb3a1}',
      '.mourn{fill:#15120f}',
      '.nm{font:700 12px "PT Sans",Arial,sans-serif;fill:#241f1a}',
      '.yr{font:11px "PT Mono",monospace;fill:#5d554a}',
      '.ln{fill:none;stroke:#bdb3a1;stroke-width:1.5}',
      '.cp{fill:none;stroke:#2f7fb8;stroke-width:2;opacity:.55}',
      '.ttl{font:700 20px "PT Serif",Georgia,serif;fill:#241f1a}',
      '.sub{font:12px "PT Sans",Arial,sans-serif;fill:#8d8577}'
    ].join('');
    var out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + (H + 60) + '" viewBox="0 0 ' + W + ' ' + (H + 60) + '">',
      '<style>' + css + '</style>',
      '<defs>' +
      grad('gm', '#eaf5fd', '#cde6f7', '#afd4ee') +
      grad('gf', '#fdeef4', '#fbd3e2', '#f4b8ce') +
      grad('gu', '#f7f4ec', '#ece7dc', '#ded7c8') +
      '</defs>',
      '<rect width="100%" height="100%" fill="#f6f1e6"/>',
      '<text class="ttl" x="30" y="34">' + xml(S.tree.meta.name) + '</text>',
      '<text class="sub" x="30" y="52">Выгружено ' + new Date().toLocaleDateString('ru-RU') +
      ' · персон: ' + S.persons().length + '</text>',
      '<g transform="translate(0,60)">'];

    // линии
    var map = res.map, mode = treeView.mode;
    res.links.forEach(function (L) {
      if (L.kind === 'couple') {
        var a = map[L.a], b = map[L.b];
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return;
        var p1 = mode === 'horizontal' ? [a.x + a.w / 2, a.y + a.h] : [a.x + a.w, a.y + a.h / 2];
        var p2 = mode === 'horizontal' ? [b.x + b.w / 2, b.y] : [b.x, b.y + b.h / 2];
        out.push('<path class="cp" d="M' + p1 + ' L' + p2 + '"/>');
      } else {
        var kidc = map[L.to];
        if (!kidc || typeof kidc !== 'object') return;
        var ps = L.from.map(function (id) { return map[id]; }).filter(function (c) { return c && typeof c === 'object'; });
        if (!ps.length) return;
        if (mode === 'horizontal') {
          var cy = ps.reduce(function (s, p) { return s + p.y + p.h / 2; }, 0) / ps.length;
          var sx = Math.max.apply(null, ps.map(function (p) { return p.x + p.w; }));
          var mx = (sx + kidc.x) / 2;
          out.push('<path class="ln" d="M' + sx + ',' + cy + ' H' + mx + ' V' + (kidc.y + kidc.h / 2) + ' H' + kidc.x + '"/>');
        } else {
          var cx = ps.reduce(function (s, p) { return s + p.x + p.w / 2; }, 0) / ps.length;
          var sy = Math.max.apply(null, ps.map(function (p) { return p.y + p.h; }));
          var my = (sy + kidc.y) / 2;
          out.push('<path class="ln" d="M' + cx + ',' + sy + ' V' + my + ' H' + (kidc.x + kidc.w / 2) + ' V' + kidc.y + '"/>');
        }
      }
    });
    // карточки
    var r = S.prefs.card.radius;
    res.cards.forEach(function (c) {
      var cls = c.person.sex === 'M' ? 'm' : c.person.sex === 'F' ? 'f' : 'u';
      out.push('<rect class="n ' + cls + '" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h +
        '" rx="' + r + '" ry="' + r + '"/>');
      var pr = c.person;
      if ((pr.death && pr.death.date) || pr.living === false) {
        out.push('<path class="mourn" d="M' + c.x + ',' + (c.y + 13) + ' L' + c.x + ',' + (c.y + r) +
          ' Q' + c.x + ',' + c.y + ' ' + (c.x + r) + ',' + c.y +
          ' L' + (c.x + 13) + ',' + c.y + ' Z"/>');
      }
      var tx = c.x + 10, ty = c.y + 20;
      var name = S.shortName(c.person);
      wrap(name, Math.floor((c.w - 18) / 6.6)).forEach(function (ln, i) {
        out.push('<text class="nm" x="' + tx + '" y="' + (ty + i * 14) + '">' + xml(ln) + '</text>');
      });
      var years = S.years(c.person);
      if (years) out.push('<text class="yr" x="' + tx + '" y="' + (c.y + c.h - 9) + '">' + xml(years) + '</text>');
    });
    out.push('</g></svg>');
    return out.join('\n');

    function wrap(s, max) {
      var words = String(s).split(' '), lines = [], cur = '';
      words.forEach(function (w) {
        if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; }
        else cur = (cur ? cur + ' ' : '') + w;
      });
      if (cur) lines.push(cur);
      return lines.slice(0, 3);
    }
  }
  function grad(id, a, b, c) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0.18" y2="1">' +
      '<stop offset="0" stop-color="' + a + '"/>' +
      '<stop offset="0.58" stop-color="' + b + '"/>' +
      '<stop offset="1" stop-color="' + c + '"/></linearGradient>';
  }
  function xml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  /* ---------------- печать / PDF ---------------- */
  function printSVG(svgText) {
    var w = global.open('', '_blank');
    if (!w) return false;
    w.document.write('<!doctype html><meta charset="utf-8"><title>' + xml(S.tree.meta.name) +
      '</title><style>@page{size:auto;margin:8mm}body{margin:0}svg{width:100%;height:auto}</style>' +
      svgText.replace(/^<\?xml[^>]*\?>/, ''));
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
    return true;
  }

  /* ---------------- ZIP (без сжатия) ---------------- */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {       // files: [{name, data: Uint8Array}]
    var parts = [], central = [], offset = 0;
    var enc = new TextEncoder();
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var crc = crc32(f.data), size = f.data.length;
      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, f.data);
      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + size;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  /* полная резервная копия: GEDCOM + JSON + фото + SVG */
  function fullBackup(treeView, onStep) {
    var enc = new TextEncoder();
    var files = [];
    files.push({ name: 'tree.ged', data: enc.encode(exportGEDCOM()) });
    files.push({ name: 'tree.svg', data: enc.encode(exportSVG(treeView)) });
    files.push({ name: 'drevo.json', data: enc.encode(JSON.stringify(S.tree, null, 1)) });
    files.push({ name: 'ЧИТАТЬ.txt', data: enc.encode(readme()) });

    var media = S.allMedia();
    var i = 0;
    function next() {
      if (i >= media.length) return Promise.resolve();
      var m = media[i++];
      if (onStep) onStep(i, media.length);
      var isPrivate = m.encrypted;
      // приватные файлы кладём как есть — то есть зашифрованными
      var get = isPrivate ? U.blobGet(m.id) : S.mediaBlob(m.id);
      return get.then(function (b) {
        if (!b) return;
        return b.arrayBuffer().then(function (buf) {
          var folder = m.kind === 'photo' ? 'photo' : m.kind === 'audio' ? 'audio' : m.kind === 'video' ? 'video' : 'doc';
          var ext = isPrivate ? '.enc' : '';
          files.push({
            name: folder + '/' + m.id + '_' + safeName(m.name) + ext,
            data: new Uint8Array(buf)
          });
        });
      }).then(next);
    }
    return next().then(function () { return zip(files); });
  }
  function readme() {
    return [
      'Резервная копия «Семейное Древо»',
      'Создана: ' + new Date().toLocaleString('ru-RU'),
      'Дерево: ' + S.tree.meta.name,
      'Персон: ' + S.persons().length + ', семей: ' + S.families().length + ', файлов: ' + S.allMedia().length,
      '',
      'Что внутри:',
      '  tree.ged      — дерево в формате GEDCOM 5.5.1, открывается любой генеалогической программой',
      '  tree.svg      — схема дерева, открывается браузером, печатается в PDF без потери качества',
      '  drevo.json    — полная копия для возврата в «Семейное Древо» (Настройки → Данные)',
      '  photo/ audio/ video/ doc/ — вложенные файлы',
      '',
      'Файлы с расширением .enc зашифрованы (AES-256-GCM) — это записи,',
      'для которых был включён запрет просмотра. Они открываются только',
      'в «Семейном Древе» после ввода пароля дерева. Без пароля их не прочитать —',
      'в том числе и разработчику программы.'
    ].join('\n');
  }

  /* ---------------- сохранение файла ---------------- */
  function download(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      return true;
    } catch (e) { return false; }
  }

  global.IO = {
    exportGEDCOM: exportGEDCOM, importGEDCOM: importGEDCOM, importText: importText,
    exportSVG: exportSVG, printSVG: printSVG, fullBackup: fullBackup, zip: zip,
    download: download, gedDate: gedDate, xml: xml
  };
})(window);
