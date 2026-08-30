// ─── СПЕЦИФИКАЦИЯ ДОМА ───────────────────────────────────────────────────────
// Продавец собирает дом для клиента: берёт планировку, выбирает отделку каждой комнаты
// и общедомовые опции, и цена пересчитывается сама. Из этой же спецификации потом
// заводится договор и создаётся объект — вместо копирования фиксированного шаблона.
//
// Расчёт живёт здесь, а не в панели, потому что одни и те же числа нужны экрану,
// печатной форме для клиента, сумме договора и составу работ объекта. Разъедься они —
// клиент получит одну цену на руки и другую в договоре.
//
// Модель:
//   sheet.specs         — комнаты с размерами (КОПИЯ планировки на момент продажи)
//   sheet.rooms[roomId] = {floor:estId, wall:estId, ceil:estId}   отделка комнаты
//   sheet.global[group] = estId                                    выбор на весь дом
//   sheet.qty[key]      = number                                   ручная правка количества
//   sheet.markup        — наценка, %

// Точки раскладки: то, что на дизайн-проекте нарисовано значками, а на площадке
// монтируется поштучно. Считаются ПО ПОМЕЩЕНИЯМ, потому что и монтируются там же,
// и клиент читает проект по комнатам: «в зале шесть розеток и шесть светильников».
// Порядок в списке — порядок листов проекта: проёмы, розетки, свет, инженерия.
// `h` — высота установки от чистого пола, мм: её рисует развёртка стены и по ней же
// электрик ставит подрозетник. Числа взяты с реальных дизайн-проектов; правится
// в модели у конкретной точки, если проект говорит иначе.
export const SPEC_POINTS = [
  { k: "win",     n: "Окно",                 emoji: "🪟", note: "поворотно-откидное", h: 900 },
  { k: "door",    n: "Дверь",                emoji: "🚪", note: "H=210",             h: 0 },
  { k: "sock",    n: "Розетка",              emoji: "🔌", note: "H=30",              h: 300 },
  { k: "sockIp",  n: "Розетка влагозащ.",    emoji: "💧", note: "IP44",              h: 1100 },
  { k: "sockOut", n: "Уличная розетка",      emoji: "🌧", note: "с термозащитой",    h: 300 },
  { k: "sw",      n: "Выключатель",          emoji: "🎚", note: "H=90",              h: 900 },
  { k: "lamp",    n: "Светильник встроенный", emoji: "💡", note: "в потолке",         h: null },
  { k: "spot",    n: "Настенный спот",       emoji: "🔦", note: "H=180",             h: 1800 },
  { k: "heat",    n: "Тёплый пол",           emoji: "♨️", note: "контур",             h: 0 },
  { k: "ac",      n: "Кондиционер",          emoji: "❄️", note: "H=220",             h: 2200 },
  { k: "vent",    n: "Вытяжка",              emoji: "🌀", note: "H=220",             h: 2200 },
  { k: "rad",     n: "Радиатор",             emoji: "🔥", note: "под окном",         h: 150 },
];

export function pointMeta(k) {
  return SPEC_POINTS.find(function (x) { return x.k === k; }) || null;
}

// Сколько таких точек в помещении.
export function roomPoints(room, k) {
  return Number(((room && room.pts) || {})[k]) || 0;
}

// Раскладка всего дома: {sock: 18, lamp: 9, …}. Нули не храним — их нечего показывать.
export function pointTotals(sheet) {
  const out = {};
  (((sheet && sheet.specs) || {}).rooms || []).forEach(function (r) {
    Object.keys((r && r.pts) || {}).forEach(function (k) {
      const n = Number(r.pts[k]) || 0;
      if (n > 0) out[k] = (out[k] || 0) + n;
    });
  });
  return out;
}

// Площадь поверхности комнаты. Потолок равен полу — это же плоскость дома, а не отдельный
// размер; стены считаются от периметра и высоты (см. specRoomCalc в панели).
export function roomArea(room, height, surface) {
  const h = Number(height) || 0;
  const w = Number(room && room.w) || 0, l = Number(room && room.l) || 0;
  const floor = (w || l) ? Math.round(w * l * 100) / 100 : (Number(room && room.floor) || 0);
  if (surface === "wall") {
    const len = Number(room && room.wallLen);
    return (len || len === 0) && room.wallLen !== "" ? Math.round(len * h * 100) / 100 : (Number(room && room.wall) || 0);
  }
  return floor;   // floor и ceil — одна и та же площадь
}

// Варианты выбора: все сметы одного вида с одной группой. Пустая группа не собирается —
// такие сметы либо входят всегда, либо ещё не размечены.
export function optionGroups(estimates, kind, scope) {
  const out = [];
  const byGroup = {};
  (estimates || []).forEach(function (e) {
    if (!e || (e.kind || "banya") !== kind) return;
    if ((e.optScope || "") !== scope) return;
    const g = String(e.optGroup || "").trim();
    if (!g) return;
    if (!byGroup[g]) { byGroup[g] = { group: g, surface: e.optSurface || "", variants: [] }; out.push(byGroup[g]); }
    // Площадь-основание берём у первого варианта: в одной группе они об одном и том же.
    if (!byGroup[g].surface && e.optSurface) byGroup[g].surface = e.optSurface;
    byGroup[g].variants.push(e);
  });
  return out;
}

// Обязательные позиции вида: входят в дом всегда, выбирать нечего.
export function baseEstimates(estimates, kind) {
  return (estimates || []).filter(function (e) { return e && (e.kind || "banya") === kind && !(e.optScope || ""); });
}

// Количество материала под площадь. Повторяет логику кнопки «подставить площадь» в
// сборщике шаблонов: м² идут как есть, листы и пачки — через фасовку, остальное не трогаем.
export function matQtyForArea(mat, area) {
  const a = Number(area) || 0;
  if (!mat || a <= 0) return Number(mat && mat.qty) || 0;
  const mode = mat.mode || "piece";
  if (mode === "m2") return Math.round(a * 100) / 100;
  if ((mode === "pack" || mode === "sheet") && mat.packBase === "м²" && Number(mat.packPer) > 0) {
    return Math.ceil(a / Number(mat.packPer) * 100) / 100;
  }
  return Number(mat.qty) || 0;
}

// Чем меряется вариант в конкретном месте: площадью поверхности комнаты, числом
// точек раскладки или ничем. Вынесено отдельно, потому что этим же контекстом считается
// цена ЕЩЁ НЕ выбранного варианта — та самая подпись «+64 200» на кнопке выбора.
// У комнатной сметы точки считаются по ЭТОЙ комнате: розетки зала не переезжают
// в спальню оттого, что их посчитали на весь дом.
function roomCtx(est, room, H, group) {
  return {
    key: "room:" + room.id + ":" + group,
    area: (!est.optPoint && est.optSurface) ? roomArea(room, H, est.optSurface) : 0,
    roomId: room.id, roomName: room.name || "", surface: est.optSurface || "",
    count: est.optPoint ? roomPoints(room, est.optPoint) : 0, point: est.optPoint || "",
  };
}

// Общедомовая опция может считаться от суммарной площади дома — тогда у неё задана
// поверхность, и площадь берётся по всем комнатам сразу.
function globalCtx(est, specs, H, totals, group) {
  let area = 0;
  if (!est.optPoint && est.optSurface) {
    ((specs && specs.rooms) || []).forEach(function (r) { area += roomArea(r, H, est.optSurface); });
  }
  return {
    key: "global:" + group, area: Math.round(area * 100) / 100, surface: est.optSurface || "",
    count: est.optPoint ? (totals[est.optPoint] || 0) : 0, point: est.optPoint || "",
  };
}

// Позиция спецификации: работа из сметы с посчитанным количеством и ценой.
// key — устойчивый адрес позиции: по нему хранится ручная правка количества и по нему
// же собирается объект, поэтому он не должен зависеть от порядка комнат.
function position(est, ctx, prodById, qtyOverride) {
  const mats = (est.lines || []).map(function (l) {
    const p = prodById[l.pid] || {};
    const base = {
      pid: l.pid || "", n: p.name || "", store: p.store || "", url: p.url || "",
      cost: Number(p.unitCost) || 0, mode: p.mode || "piece",
      packBase: p.packBase, packPer: p.packPer, lenPer: p.lenPer, sheetM2: p.sheetM2,
      qty: Number(l.qty) || 0,
    };
    // Смета считается либо от площади, либо от числа точек — но не от обоих сразу:
    // «монтаж розетки» меряется штуками, «обшивка стен» квадратами.
    if (ctx.count > 0) base.qty = Math.round((Number(l.qty) || 0) * ctx.count * 100) / 100;
    else if (ctx.area > 0) base.qty = matQtyForArea(base, ctx.area);
    return base;
  });
  const cost = mats.reduce(function (a, m) { return a + (Number(m.cost) || 0) * (Number(m.qty) || 0); }, 0);
  const factor = (qtyOverride != null && isFinite(qtyOverride) && qtyOverride > 0) ? Number(qtyOverride) : 1;
  return {
    key: ctx.key, estId: est.id, name: est.name || "", stage: Number(est.stage) || 0,
    room: ctx.roomName || "", roomId: ctx.roomId || "", surface: ctx.surface || "",
    group: est.optGroup || "", label: est.optLabel || "",
    area: Math.round((ctx.area || 0) * 100) / 100,
    point: ctx.point || "", count: Number(ctx.count) || 0,
    mats: mats, cost: Math.round(cost * factor), factor: factor,
  };
}

// Полный состав спецификации: обязательные позиции, отделка комнат, общедомовые опции.
export function sheetPositions(sheet, estimates, products) {
  const kind = (sheet && sheet.kind) || "banya";
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  const byId = {};
  (estimates || []).forEach(function (e) { if (e && e.id) byId[e.id] = e; });
  const specs = (sheet && sheet.specs) || {};
  const H = Number(specs.height) || 0;
  const qty = (sheet && sheet.qty) || {};
  const out = [];
  const totals = pointTotals(sheet);

  // Смета, помеченная точкой (`optPoint`), считается по раскладке: «монтаж розетки» ×18.
  // Точек в доме нет — позиции нет: платить за монтаж того, чего не заложили, не за что.
  baseEstimates(estimates, kind).forEach(function (e) {
    const cnt = e.optPoint ? (totals[e.optPoint] || 0) : 0;
    if (e.optPoint && !cnt) return;
    out.push(position(e, { key: "base:" + e.id, area: 0, count: cnt, point: e.optPoint || "" },
      prodById, qty["base:" + e.id]));
  });

  // Выбор по комнате хранится ПО ГРУППЕ, а не по трём поверхностям: «Стены черновые» и
  // «Стены чистовые» — разные решения об одной стене, и в трёх ячейках они бы столкнулись.
  // Площадь берётся из самой сметы (optSurface), поэтому группа сама знает, чем меряется.
  ((specs.rooms) || []).forEach(function (r) {
    const picks = ((sheet.rooms || {})[r.id]) || {};
    Object.keys(picks).forEach(function (group) {
      const e = picks[group] && byId[picks[group]];
      if (!e) return;
      const ctx = roomCtx(e, r, H, group);
      if (e.optPoint && !ctx.count) return;
      out.push(position(e, ctx, prodById, qty[ctx.key]));
    });
  });

  Object.keys((sheet && sheet.global) || {}).forEach(function (group) {
    const estId = sheet.global[group];
    const e = estId && byId[estId];
    if (!e) return;
    const ctx = globalCtx(e, specs, H, totals, group);
    if (e.optPoint && !ctx.count) return;
    out.push(position(e, ctx, prodById, qty[ctx.key]));
  });

  return out;
}

// Сколько стоит ОДИН вариант в этом месте. Нужно там, где выбор ещё не сделан:
// подпись «+64 200» на кнопке, цена ячейки матрицы, цена комплектации. Считается
// тем же position(), что и попавшая в спецификацию позиция, — иначе кнопка обещала бы
// одно, а итог показывал другое. `room` = null для общедомовой опции.
export function optionCost(sheet, est, room, products) {
  if (!est) return 0;
  const specs = (sheet && sheet.specs) || {};
  const H = Number(specs.height) || 0;
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  const ctx = room
    ? roomCtx(est, room, H, est.optGroup || "")
    : globalCtx(est, specs, H, pointTotals(sheet), est.optGroup || "");
  if (est.optPoint && !ctx.count) return 0;
  return position(est, ctx, prodById, ((sheet && sheet.qty) || {})[ctx.key]).cost;
}

// Итоги: себестоимость, цена клиенту и разбивка по этапам. Наценка одна на спецификацию —
// продавец должен понимать, что он назвал клиенту, а не собирать сумму из сорока процентов.
export function sheetTotals(sheet, estimates, products) {
  const pos = sheetPositions(sheet, estimates, products);
  const cost = pos.reduce(function (a, p) { return a + p.cost; }, 0);
  const markup = Number(sheet && sheet.markup);
  const mk = isFinite(markup) && markup >= 0 ? markup : 0;
  const price = Math.round(cost * (1 + mk / 100));
  const byStage = {};
  pos.forEach(function (p) { byStage[p.stage] = (byStage[p.stage] || 0) + p.cost; });
  return { positions: pos, cost: cost, markup: mk, price: price, byStage: byStage, count: pos.length };
}

// Чего не хватает, чтобы спецификацию можно было продавать. Продавец должен видеть это
// ДО клиента, а не узнавать из вопроса «а почему тут ноль».
export function sheetIssues(sheet, estimates, products) {
  const out = [];
  const specs = (sheet && sheet.specs) || {};
  const rooms = specs.rooms || [];
  if (!rooms.length) out.push("Нет помещений — выберите планировку или внесите размеры вручную");
  if (!Number(specs.height)) out.push("Не задана высота потолка — площадь стен будет нулевой");
  rooms.forEach(function (r) {
    if (!roomArea(r, specs.height, "floor")) out.push("«" + (r.name || "помещение") + "»: не заданы размеры");
  });
  optionGroups(estimates, (sheet && sheet.kind) || "banya", "global").forEach(function (g) {
    if (!((sheet.global || {})[g.group])) out.push("Не выбран вариант: " + g.group);
  });
  const roomGroups = optionGroups(estimates, (sheet && sheet.kind) || "banya", "room");
  rooms.forEach(function (r) {
    const picks = ((sheet.rooms || {})[r.id]) || {};
    roomGroups.forEach(function (g) {
      if (!picks[g.group]) out.push("«" + (r.name || "помещение") + "»: не выбрано — " + g.group);
    });
  });
  const t = sheetTotals(sheet, estimates, products);
  if (!t.cost) out.push("Себестоимость нулевая — ничего не выбрано или у материалов нет цены");
  return out;
}
