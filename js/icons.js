/* Семейное Древо — значки.
   Рисованные, одним цветом, тянутся за размером шрифта кнопки.
   Эмодзи тут не годятся: на разных телефонах они выглядят по-разному,
   а часть из них вообще не читается как действие. */
(function (global) {
  'use strict';

  var P = {
    /* шестерёнку заменяем на ползунки — её узнают увереннее */
    settings: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/>' +
      '<line x1="4" y1="17" x2="20" y2="17"/>' +
      '<circle cx="9" cy="7" r="2.3"/><circle cx="15" cy="12" r="2.3"/><circle cx="8" cy="17" r="2.3"/>',

    /* дверь со стрелкой наружу — «выйти», а не «выключить» */
    logout: '<path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/>' +
      '<polyline points="17 8 21 12 17 16"/><line x1="21" y1="12" x2="10" y2="12"/>',

    /* микрофон с подставкой — ни с чем не спутать */
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/>' +
      '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/>' +
      '<line x1="12" y1="18" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/>',

    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '<line x1="3" y1="10" x2="21" y2="10"/>' +
      '<line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>' +
      '<circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>',

    map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>' +
      '<line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',

    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',

    search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>',

    /* человек с плюсом — «добавить персону» */
    addPerson: '<circle cx="9" cy="8" r="3.6"/>' +
      '<path d="M2.6 20a6.4 6.4 0 0 1 12.8 0"/>' +
      '<line x1="18.5" y1="6" x2="18.5" y2="13"/><line x1="15" y1="9.5" x2="22" y2="9.5"/>',

    person: '<circle cx="12" cy="8" r="3.8"/><path d="M5 20a7 7 0 0 1 14 0"/>',

    sync: '<path d="M20.5 11a8.5 8.5 0 0 0-14.8-5"/><polyline points="4 3 4 7 8 7"/>' +
      '<path d="M3.5 13a8.5 8.5 0 0 0 14.8 5"/><polyline points="20 21 20 17 16 17"/>',

    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    expand: '<polyline points="9 3 3 3 3 9"/><polyline points="15 21 21 21 21 15"/>' +
      '<line x1="3" y1="3" x2="10" y2="10"/><line x1="21" y1="21" x2="14" y2="14"/>',
    trash: '<polyline points="4 7 20 7"/><path d="M9 7V4.5h6V7"/>' +
      '<path d="M6 7l1 13h10l1-13"/><line x1="10" y1="11" x2="10" y2="17"/>' +
      '<line x1="14" y1="11" x2="14" y2="17"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.8"/>' +
      '<polyline points="4 17 9.5 12 13 15 16.5 12 20 15.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><polyline points="12 7 12 12 15.5 14"/>',
    tree: '<circle cx="12" cy="4.6" r="2.4"/><circle cx="5.5" cy="19.4" r="2.4"/>' +
      '<circle cx="18.5" cy="19.4" r="2.4"/><path d="M12 7v4H5.5v6M12 11h6.5v6"/>',
    down: '<line x1="12" y1="4" x2="12" y2="18"/><polyline points="6 13 12 19 18 13"/>',
    right: '<line x1="4" y1="12" x2="18" y2="12"/><polyline points="13 6 19 12 13 18"/>',
    butterfly: '<path d="M12 5v14"/><path d="M11 7C8 3.5 3 4.5 3 9c0 3.5 4.5 4 8 3"/>' +
      '<path d="M13 7c3-3.5 8-2.5 8 2 0 3.5-4.5 4-8 3"/>' +
      '<path d="M11 13c-3 0-6 1.5-6 4.5 0 2 3 2.5 6-1"/>' +
      '<path d="M13 13c3 0 6 1.5 6 4.5 0 2-3 2.5-6-1"/>',
    note: '<path d="M5 3h9l5 5v13H5z"/><polyline points="14 3 14 8 19 8"/>' +
      '<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/>' +
      '<path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/>',
    list: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/>' +
      '<line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/>' +
      '<circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>' +
      '<circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/>'
  };

  /** Значок как строка SVG. size — в em, чтобы тянулся за шрифтом кнопки. */
  function icon(name, opts) {
    opts = opts || {};
    var body = P[name];
    if (!body) return '';
    var cls = 'ico' + (opts.cls ? ' ' + opts.cls : '');
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' +
      'fill="none" stroke="currentColor" stroke-width="' + (opts.weight || 1.7) + '" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  icon.has = function (name) { return !!P[name]; };
  icon.paths = P;
  global.Icon = icon;
})(window);
