// ─── МОДЕЛЬ КОНТЕЙНЕРА ───────────────────────────────────────────────────────
// Дом из морского контейнера — это коробка фиксированного размера, разделённая
// перегородками, с проёмами в стенах. Больше в нём ничего нет, и этого достаточно,
// чтобы считать площади, а из площадей — смету.
//
// Поэтому модель здесь не «BIM» в смысле IFC, а ровно то, что меняет деньги:
// длины помещений вдоль контейнера и проёмы на стенах. Всё остальное (розетки,
// отделка, этапы) уже умеет спецификация и берёт отсюда готовые площади.
//
//   model = {
//     type: "40hc",                  // типоразмер, см. CONTAINERS
//     l, w, h,                       // внутренние габариты, мм
//     rooms:    [{id, name, len, pts, sub}],   // ОТСЕКИ поперёк контейнера
//     openings: [{id, side, pos, sill, typeId}],   // проёмы на стенах
//     wallThick, finish               // перегородка и толщина отделки, мм
//   }
//
// Отсек — поперечный кусок контейнера. Обычно это одно помещение во всю ширину,
// но санузел стоит в углу, поэтому отсек умеет делиться ещё и вдоль:
// `sub = {id, name, pts, at}` — вторая комната, `at` = ширина ПЕРВОЙ (от верхней
// стены). Дальше двух комнат в отсеке не идём: в контейнере шириной 2,35 м
// третья полоса — это уже не помещение.
//
// Помещения хранятся ДЛИНАМИ, а не координатами границ: перетаскивание границы —
// это перенос миллиметров из одного помещения в соседнее, и в таком виде сумма
// длин не может разъехаться с длиной контейнера из-за округления.

export const CONTAINERS = [
  { k: "20",    n: "20 футов",        l: 5898,  w: 2352, h: 2393 },
  { k: "40",    n: "40 футов",        l: 12032, w: 2352, h: 2393 },
  { k: "40hc",  n: "40 футов HC",     l: 12032, w: 2352, h: 2698 },
  { k: "45hc",  n: "45 футов HC",     l: 13556, w: 2352, h: 2698 },
];

export const MIN_ROOM = 900;      // меньше — уже не помещение, а шкаф
export const WALL_THICK = 100;    // каркасная перегородка с обшивкой
// Обрешётка с утеплителем и обшивкой съедает по стене сантиметров восемь. Без этого
// модель считает по железу контейнера и даёт лишний квадрат на комнату — а это уже
// материалы и деньги: в проекте №7640467 при ширине контейнера 2352 комнаты 2200.
export const FINISH_THICK = 76;

export function containerMeta(k) {
  return CONTAINERS.find(function (c) { return c.k === k; }) || CONTAINERS[1];
}

export function emptyModel(k) {
  const c = containerMeta(k || "40hc");
  return {
    type: c.k, l: c.l, w: c.w, h: c.h, wallThick: WALL_THICK, finish: FINISH_THICK,
    rooms: [{ id: "rm1", name: "Помещение", len: c.l, pts: {} }],
    openings: [],
  };
}

// ─── ГОТОВЫЕ ПЛАНИРОВКИ ──────────────────────────────────────────────────────
// Заготовка — уже начерченный дом: отсеки со своими длинами и проёмы в стенах.
// Типовой контейнер продают повторно, и собирать его перегородку за перегородкой
// с нуля каждому клиенту незачем: тап — и дальше это обычная модель, которую
// двигают как любую другую.
//
// Длины тут ПО КОРОБКЕ (то, что модель хранит в rooms[].len), а не чистовые: у
// крайних отсеков отделка съедает ещё и торец, поэтому чистовым 2000 мм на чертеже
// соответствует 2076 по коробке. Считать наоборот нельзя — площади разъедутся с
// чертежом ровно на толщину обшивки.
//
// Проём ссылается на изделие не по id, а по НОМЕРУ в `needs`: заготовка живёт в
// коде, справочник изделий — в данных портала, и связать их можно только размером.
export const MODEL_PRESETS = [
  {
    k: "c12-san-liv-bed",
    n: "12 м · санузел / кухня-гостиная / спальня",
    note: "По чертежу 1200 × 247 см: 4,40 + 14,08 + 7,04 м²",
    // Обмер — docs/plan-container-1200.svg (чертёж заказчика, переведённый в размеры).
    // Высота — ЧИСТОВАЯ (2500 в 40HC после пирога пола и потолка): спецификация
    // берёт h как высоту помещения, и по ней же считается площадь стен.
    type: "40hc", l: 11952, w: 2352, h: 2500, wallThick: WALL_THICK, finish: FINISH_THICK,
    rooms: [
      { name: "Санузел",        len: 2076, pts: {} },
      { name: "Кухня-гостиная", len: 6400, pts: {} },
      { name: "Спальня",        len: 3276, pts: {} },
    ],
    needs: [
      { kind: "win",  n: "Окно 1500×2100 поворотно-откидное", w: 1500, h: 2100, cost: 0 },
      { kind: "door", n: "Дверь входная 1000×2100",           w: 1000, h: 2100, cost: 0 },
      { kind: "win",  n: "Витраж 2000×2200 панорамный",       w: 2000, h: 2200, cost: 0 },
      { kind: "door", n: "Дверь межкомнатная 700×2100",       w: 700,  h: 2100, cost: 0 },
    ],
    // Проём на перегородке ссылается на отсек НОМЕРОМ (`afterRoom`) — id отсека
    // заготовка знать не может, он рождается при сборке модели.
    // Отметки межкомнатных дверей — от чистовой стены, как на чертеже: 750 · 700 · 750
    // у санузла и 1450 · 700 · 50 у спальни (плюс обшивка 76).
    openings: [
      { side: "s", pos: 2976, sill: 0,   need: 0 },   // окно: 800 от стены санузла
      { side: "s", pos: 5276, sill: 0,   need: 1 },   // вход: 800 от окна
      { side: "e", pos: 176,  sill: 200, need: 2 },   // витраж в торце спальни
      { side: "part", afterRoom: 0, pos: 826,  need: 3, into: 1, hinge: "start" },   // санузел
      { side: "part", afterRoom: 1, pos: 1526, need: 3, into: 1, hinge: "end" },     // спальня
    ],
  },
];

export function modelPreset(k) {
  return MODEL_PRESETS.find(function (p) { return p.k === k; }) || null;
}

// Заготовка → модель плюс изделия, которых для неё не хватает в справочнике.
// Изделие ищем по РАЗМЕРУ и виду, а не по имени: имена правят и дублируют, а окно
// 1500×2100 остаётся тем же окном. Нашлось — берём вместе с его ценой, чужую цену
// заготовка не навязывает; не нашлось — заводим с нулевой, чтобы её вписал человек.
export function presetModel(preset, winTypes, newId) {
  const p = (typeof preset === "string") ? modelPreset(preset) : preset;
  if (!p) return null;
  let seq = 0;
  const gen = (typeof newId === "function") ? newId : function () { return p.k + "-" + (++seq); };
  const types = (winTypes || []).slice();
  const ids = (p.needs || []).map(function (nd) {
    const has = types.find(function (t) {
      return t && (t.kind || "win") === (nd.kind || "win") &&
        Number(t.w) === Number(nd.w) && Number(t.h) === Number(nd.h);
    });
    if (has) return has.id;
    const t = { id: gen(), kind: nd.kind || "win", n: nd.n, w: nd.w, h: nd.h, cost: Number(nd.cost) || 0 };
    types.push(t);
    return t.id;
  });
  const model = {
    type: p.type, l: p.l, w: p.w, h: p.h,
    wallThick: p.wallThick, finish: p.finish,
    rooms: (p.rooms || []).map(function (r) {
      return { id: gen(), name: r.name, len: r.len, pts: Object.assign({}, r.pts || {}) };
    }),
    openings: [],
  };
  model.openings = (p.openings || []).map(function (o) {
    const op = { id: gen(), side: o.side, pos: o.pos, sill: o.sill, typeId: ids[o.need] };
    if (o.side === "part") {
      const bay = model.rooms[o.afterRoom];
      if (!bay) return null;
      op.after = bay.id;
      op.into = o.into;
      op.hinge = o.hinge;
      delete op.sill;
    }
    return op;
  }).filter(function (o) { return o && o.typeId; });
  return { model: model, winTypes: types };
}

// Габариты по типоразмеру. Свои размеры остаются, если тип «свой».
export function applyContainer(model, k) {
  const c = containerMeta(k);
  const m = Object.assign({}, model, { type: c.k, w: c.w, h: c.h });
  m.rooms = scaleRooms(model.rooms || [], c.l);
  m.l = c.l;
  return m;
}

// Растянуть/сжать помещения под новую длину пропорционально: смена типоразмера
// не должна ломать раскладку — соотношение комнат обычно и есть решение планировки.
function scaleRooms(rooms, total) {
  const src = (rooms || []).filter(function (r) { return r; });
  if (!src.length) return [{ id: "rm1", name: "Помещение", len: total, pts: {} }];
  const sum = src.reduce(function (a, r) { return a + (Number(r.len) || 0); }, 0) || 1;
  let left = total;
  return src.map(function (r, i) {
    const len = (i === src.length - 1) ? left : Math.round((Number(r.len) || 0) / sum * total);
    left -= len;
    return Object.assign({}, r, { len: len });
  });
}

// Помещения с координатами: x0/x1 — от начала контейнера, мм.
export function modelRooms(model) {
  const m = model || {};
  const fin = (m.finish == null) ? FINISH_THICK : (Number(m.finish) || 0);
  const th = Number(m.wallThick) || 0;
  const W = Number(m.w) || 0;
  const src = m.rooms || [];
  const out = [];
  let x = 0;
  src.forEach(function (bay, i) {
    const len = Math.max(0, Number(bay.len) || 0);
    const endL = (i === 0 ? fin : 0), endR = (i === src.length - 1 ? fin : 0);
    const fl = Math.max(0, len - endL - endR);
    const mk = function (r, y0, y1, sub) {
      const fw = Math.max(0, (y1 - y0) - fin * 2);
      out.push({
        id: r.id, name: r.name || "Помещение", bayId: bay.id, sub: !!sub,
        len: len, x0: x, x1: x + len, y0: y0, y1: y1,
        pts: r.pts || {}, finW: fw, finL: fl,
        area: Math.round(fl * fw / 1000 / 1000 * 100) / 100,
        wallLen: Math.round((fl + fw) * 2) / 1000,
      });
    };
    if (bay.sub) {
      const at = Math.min(Math.max(Number(bay.sub.at) || 0, MIN_ROOM), W - th - MIN_ROOM);
      mk(bay, 0, at, false);
      mk(bay.sub, at + th, W, true);
    } else {
      mk(bay, 0, W, false);
    }
    x += len + th;
  });
  return out;
}

// Отсеки с координатами — нужны плану и переносу границ.
export function modelBays(model) {
  const m = model || {};
  const th = Number(m.wallThick) || 0;
  let x = 0;
  return (m.rooms || []).map(function (bay) {
    const len = Math.max(0, Number(bay.len) || 0);
    const out = { id: bay.id, len: len, x0: x, x1: x + len, sub: bay.sub || null };
    x += len + th;
    return out;
  });
}

// Длина стены, вдоль которой ставятся проёмы. Длинные стены идут по всему
// контейнеру, торцы — по его ширине.
export function sideLength(model, side) {
  const m = model || {};
  // Перегородка идёт поперёк контейнера, как и торец: проём на ней меряется по ширине.
  return (side === "w" || side === "e" || side === "part") ? (Number(m.w) || 0) : totalLength(m);
}

// Перегородка, названная проёмом: `after` — отсек, СРАЗУ ЗА которым она стоит.
// Ссылаемся на отсек, а не на номер стены: номера съезжают при делении и слиянии,
// а id отсека их переживает.
export function partitionAt(model, afterBayId) {
  const bays = modelBays(model);
  const i = bays.findIndex(function (b) { return b.id === afterBayId; });
  if (i < 0 || i >= bays.length - 1) return null;
  return { bay: bays[i], x: bays[i].x1, w: Number((model || {}).wallThick) || 0 };
}

export function totalLength(model) {
  const m = model || {};
  const rooms = m.rooms || [];
  const walls = Math.max(0, rooms.length - 1) * (Number(m.wallThick) || 0);
  return rooms.reduce(function (a, r) { return a + (Number(r.len) || 0); }, 0) + walls;
}

// В каком помещении оказался проём. У торцов ответ известен заранее: первое и
// последнее помещение. У длинных стен — то, в чьи границы попала позиция.
export function openingRoom(model, op) {
  const rooms = modelRooms(model);
  if (!rooms.length) return null;
  const W = Number((model || {}).w) || 0;
  const side = op.side;
  // Дверь в перегородке принадлежит двум помещениям сразу, и выбрать надо ОДНО:
  // иначе «монтаж двери» посчитается дважды и бригада закажет лишнюю. Считаем её
  // за отсеком, который она закрывает (`after`) — правило простое и не зависит от
  // того, в какую сторону створка открыта.
  if (side === "part") {
    const p = partitionAt(model, op.after);
    if (!p) return null;
    const pos = Number(op.pos) || 0;
    const inBay = rooms.filter(function (r) { return r.bayId === p.bay.id; });
    return inBay.find(function (r) { return pos >= r.y0 && pos <= r.y1; }) || inBay[0] || null;
  }
  // Стена принадлежит той комнате, которая её касается: у отсека с продольной
  // перегородкой северная стена у одной комнаты, южная — у другой.
  const touches = function (r) {
    if (side === "n") return r.y0 === 0;
    if (side === "s") return r.y1 === W;
    return true;
  };
  if (side === "w" || side === "e") {
    const bays = modelBays(model);
    const bay = (side === "w") ? bays[0] : bays[bays.length - 1];
    if (!bay) return null;
    const pos = Number(op.pos) || 0;
    const inBay = rooms.filter(function (r) { return r.bayId === bay.id; });
    return inBay.find(function (r) { return pos >= r.y0 && pos <= r.y1; }) || inBay[0] || null;
  }
  const pos = Number(op.pos) || 0;
  return rooms.filter(touches).find(function (r) { return pos >= r.x0 && pos <= r.x1; }) || null;
}

// Перенос границы между помещениями i и i+1. Двигаем не «границу», а миллиметры
// из одного помещения в другое: так сумма длин остаётся равной контейнеру.
export function moveBoundary(model, i, deltaMm) {
  const rooms = (model.rooms || []).map(function (r) { return Object.assign({}, r); });
  const a = rooms[i], b = rooms[i + 1];
  if (!a || !b) return model;
  let d = Math.round(Number(deltaMm) || 0);
  d = Math.max(d, MIN_ROOM - (Number(a.len) || 0));
  d = Math.min(d, (Number(b.len) || 0) - MIN_ROOM);
  if (!d) return model;
  a.len = (Number(a.len) || 0) + d;
  b.len = (Number(b.len) || 0) - d;
  return Object.assign({}, model, { rooms: rooms });
}

// Проёмы в перегородках при правке отсеков. Перегородка названа отсеком ПЕРЕД ней,
// поэтому деление и слияние её переименовывают — и без этого дверь молча уезжала бы
// на соседнюю стену или висела бы на перегородке, которой уже нет.
function repointParts(model, from, to) {
  const ops = (model.openings || []).map(function (o) {
    return (o.side === "part" && o.after === from) ? Object.assign({}, o, { after: to }) : o;
  }).filter(function (o) { return !(o.side === "part" && o.after == null); });
  return ops;
}

// Разделить помещение перегородкой пополам. Новое помещение получает свой id —
// раскладка и отделка привязаны к id, и делить их пополам было бы враньём.
export function splitRoom(model, roomId, newId, newSubId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0) return model;
  const r = rooms[i];
  const len = Number(r.len) || 0;
  const half = Math.round((len - (Number(model.wallThick) || 0)) / 2);
  if (half < MIN_ROOM) return model;   // делить нечего
  const left = Object.assign({}, r, { len: half });
  const right = { id: newId, name: "Помещение", len: len - half - (Number(model.wallThick) || 0), pts: {} };
  // Отсек с продольной перегородкой делится вместе с ней: иначе санузел в углу
  // при добавлении поперечной стены молча превращался бы в комнату во всю ширину.
  if (r.sub) right.sub = { id: newSubId || (newId + "s"), name: "Помещение", pts: {}, at: r.sub.at };
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([left, right], rooms.slice(i + 1)),
    openings: repointParts(model, roomId, newId),
  });
}

// Убрать перегородку справа от помещения: соседи сливаются, длина перегородки
// возвращается в помещение. Раскладка соседа переезжает — точки никуда не делись.
export function mergeRoom(model, roomId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0 || i + 1 >= rooms.length) return model;
  const a = rooms[i], b = rooms[i + 1];
  // Отсеки с разным делением по ширине не сливаются: получившуюся П-образную
  // комнату модель не умеет описать, а врать про площади нельзя.
  if (!!a.sub !== !!b.sub) return model;
  const addPts = function (x, y) {
    const pts = Object.assign({}, (x && x.pts) || {});
    Object.keys((y && y.pts) || {}).forEach(function (k) { pts[k] = (pts[k] || 0) + y.pts[k]; });
    return pts;
  };
  const merged = Object.assign({}, a, {
    len: (Number(a.len) || 0) + (Number(b.len) || 0) + (Number(model.wallThick) || 0),
    pts: addPts(a, b),
  });
  if (a.sub) merged.sub = Object.assign({}, a.sub, { pts: addPts(a.sub, b.sub) });
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([merged], rooms.slice(i + 2)),
    // Перегородки больше нет — висевшая на ней дверь вместе с ней и уходит.
    openings: repointParts(model, a.id, null),
  });
}

// Поставить продольную перегородку в отсеке: санузел в углу — это она.
// Дальше двух комнат не идём: третья полоса в контейнере уже не помещение.
export function splitLengthwise(model, bayId, newId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  if (W - th < MIN_ROOM * 2) return model;   // делить нечего
  const at = Math.round((W - th) / 2);
  const bay = Object.assign({}, rooms[i], { sub: { id: newId, name: "Помещение", pts: {}, at: at } });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Отсек, в который попала координата вдоль контейнера.
export function bayAt(model, x) {
  const bays = modelBays(model);
  return bays.find(function (b) { return x >= b.x0 && x <= b.x1; }) ||
    (x < 0 ? bays[0] : bays[bays.length - 1]) || null;
}

// Поперечная стена ровно там, где её нарисовали. Это то же деление отсека, но
// не пополам: рисуя стену, человек показывает место, а не факт деления.
export function splitAt(model, x, newId, newSubId) {
  const bay = bayAt(model, x);
  if (!bay) return model;
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bay.id; });
  if (i < 0) return model;
  const th = Number(model.wallThick) || 0;
  const left = Math.round(x - bay.x0);
  const right = (Number(rooms[i].len) || 0) - left - th;
  if (left < MIN_ROOM || right < MIN_ROOM) return model;   // слишком близко к соседу
  const a = Object.assign({}, rooms[i], { len: left });
  const b = { id: newId, name: "Помещение", len: right, pts: {} };
  if (rooms[i].sub) b.sub = { id: newSubId || (newId + "s"), name: "Помещение", pts: {}, at: rooms[i].sub.at };
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([a, b], rooms.slice(i + 1)),
    openings: repointParts(model, rooms[i].id, newId),
  });
}

// Продольная стена на заданной отметке по ширине — тем же жестом, что и поперечная.
export function splitLengthwiseAt(model, bayId, y, newId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  const at = Math.round(Math.max(MIN_ROOM, Math.min(W - th - MIN_ROOM, y)));
  if (W - th < MIN_ROOM * 2) return model;
  const bay = Object.assign({}, rooms[i], { sub: { id: newId, name: "Помещение", pts: {}, at: at } });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// К какой стене ближе точка. Проём ставят тапом рядом со стеной, а не выбором
// из списка: на плане видно, куда он встанет.
export function nearestSide(model, x, y) {
  const L = totalLength(model), W = Number(model.w) || 0;
  const d = [["n", y], ["s", W - y], ["w", x], ["e", L - x]];
  d.sort(function (a, b) { return a[1] - b[1]; });
  return d[0][0];
}

// Позиция проёма на стене по точке клика, с учётом его ширины и границ стены.
export function opPosAt(model, side, x, y, widthMm) {
  const along = (side === "n" || side === "s");
  const span = sideLength(model, side);
  const c = along ? x : y;
  return Math.max(0, Math.min(Math.max(0, span - (Number(widthMm) || 0)), Math.round(c - (Number(widthMm) || 0) / 2)));
}

// Убрать продольную перегородку. Раскладка второй комнаты переезжает в первую —
// розетки никуда не делись, их всё равно монтировать.
export function mergeLengthwise(model, bayId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || !rooms[i].sub) return model;
  const bay = Object.assign({}, rooms[i]);
  const pts = Object.assign({}, bay.pts || {});
  Object.keys((bay.sub.pts) || {}).forEach(function (k) { pts[k] = (pts[k] || 0) + bay.sub.pts[k]; });
  bay.pts = pts;
  delete bay.sub;
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Перенос продольной перегородки: та же арифметика, что у поперечной, но по ширине.
export function moveLengthwise(model, bayId, deltaMm) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || !rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  const cur = Number(rooms[i].sub.at) || 0;
  const at = Math.max(MIN_ROOM, Math.min(W - th - MIN_ROOM, cur + Math.round(Number(deltaMm) || 0)));
  if (at === cur) return model;
  const bay = Object.assign({}, rooms[i], { sub: Object.assign({}, rooms[i].sub, { at: at }) });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Проёмы, посчитанные по помещениям: окна и двери попадают в раскладку сами,
// поэтому «монтаж окна ×3» считается той же машинкой, что розетки.
export function openingCounts(model, winTypes) {
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const out = {};
  (model.openings || []).forEach(function (op) {
    const room = openingRoom(model, op);
    if (!room) return;
    const t = byType[op.typeId] || {};
    const key = (t.kind === "door") ? "door" : "win";
    if (!out[room.id]) out[room.id] = {};
    out[room.id][key] = (out[room.id][key] || 0) + 1;
  });
  return out;
}

// Модель → характеристики помещений, с которыми уже умеет работать спецификация.
// Это и есть смысл модели: двигаешь перегородку — меняются площади, а значит и смета.
export function modelToSpecs(model, winTypes) {
  const m = model || {};
  const counts = openingCounts(m, winTypes);
  return {
    height: Math.round((Number(m.h) || 0) / 10) / 100,
    rooms: modelRooms(m).map(function (r) {
      const pts = Object.assign({}, r.pts || {}, counts[r.id] || {});
      return {
        id: r.id, name: r.name, pts: pts,
        w: Math.round(r.finW / 10) / 100,
        l: Math.round(r.finL / 10) / 100,
        wallLen: r.wallLen,
      };
    }),
    openings: [],
  };
}

// Стоимость самих изделий (окна и двери из справочника) и метраж перегородок.
export function modelTotals(model, winTypes) {
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  let openings = 0, area = 0;
  (model.openings || []).forEach(function (op) {
    const t = byType[op.typeId];
    if (!t) return;
    openings += Number(t.cost) || 0;
    area += (Number(t.w) || 0) * (Number(t.h) || 0) / 1000000;
  });
  const walls = Math.max(0, (model.rooms || []).length - 1) +
    (model.rooms || []).filter(function (b) { return b.sub; }).length;
  return {
    openingsCost: Math.round(openings),
    openingsArea: Math.round(area * 100) / 100,
    partitions: walls,
    partitionArea: Math.round(walls * (Number(model.w) || 0) * (Number(model.h) || 0) / 1000000 * 100) / 100,
    floorArea: Math.round(modelRooms(model).reduce(function (a, r) { return a + r.area; }, 0) * 100) / 100,
  };
}

// Развёртка стены: то, что в дизайн-проекте называется «развёртки стен». Показывает,
// на какой высоте что стоит — по этим числам электрик ставит подрозетники, а бригада
// вешает споты. План сверху высоту показать не может в принципе.
//
// points — каталог точек (SPEC_POINTS): модель не знает, что такое розетка, и не
// должна знать; она знает только, сколько их в комнате и где стена.
export function elevation(model, side, winTypes, points) {
  const m = model || {};
  const H = Number(m.h) || 0;
  const len = sideLength(m, side);
  const rooms = modelRooms(m);
  const W = Number(m.w) || 0;
  const along = (side === "n" || side === "s");
  // Какие комнаты выходят на эту стену и каким куском.
  const bays = modelBays(m);
  let wallRooms;
  if (along) {
    wallRooms = rooms.filter(function (r) { return side === "n" ? r.y0 === 0 : r.y1 === W; })
      .map(function (r) { return { room: r, a: r.x0, b: r.x1 }; });
  } else {
    const bay = (side === "w") ? bays[0] : bays[bays.length - 1];
    wallRooms = rooms.filter(function (r) { return bay && r.bayId === bay.id; })
      .map(function (r) { return { room: r, a: r.y0, b: r.y1 }; });
  }

  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const ops = (m.openings || []).filter(function (o) { return o.side === side; }).map(function (o) {
    const t = byType[o.typeId] || { n: "Проём", w: 0, h: 0, kind: "win" };
    const sill = (o.sill == null) ? ((t.kind === "door") ? 0 : 900) : (Number(o.sill) || 0);
    return {
      id: o.id, name: t.n || "Проём", kind: t.kind || "win",
      x0: Number(o.pos) || 0, x1: (Number(o.pos) || 0) + (Number(t.w) || 0),
      y0: sill, y1: sill + (Number(t.h) || 0), sill: sill,
    };
  });

  // Точки раскладки расставляем равномерно по своей комнате: точных координат
  // модель не хранит, а высота — хранит, и именно её тут и показывают.
  const marks = [];
  (points || []).forEach(function (pt) {
    if (pt.h == null) return;                       // потолочные на развёртке не рисуем
    wallRooms.forEach(function (wr) {
      const n = Number((wr.room.pts || {})[pt.k]) || 0;
      if (!n) return;
      const step = (wr.b - wr.a) / (n + 1);
      for (let i = 1; i <= n; i++) {
        marks.push({ k: pt.k, emoji: pt.emoji, n: pt.n, h: pt.h, x: Math.round(wr.a + step * i), room: wr.room.name });
      }
    });
  });

  return { side: side, len: len, height: H, rooms: wallRooms, openings: ops, marks: marks };
}

// ─── ПЛОЩАДИ ПОМЕЩЕНИЙ ───────────────────────────────────────────────────────
// Пол, потолок и стены по каждому помещению — то, из чего считается отделка, и то,
// что человек хочет видеть, пока двигает перегородку: подвинул — увидел новые числа.
//
// Потолок равен полу: это одна плоскость дома, а не отдельный размер.
// Стены даём ДВУМЯ числами. Полная (`wallGross`) — периметр × высота: по ней считают
// обрешётку и утеплитель, которые идут и за окном тоже. Чистая (`wallNet`) — за
// вычетом проёмов: по ней красят и обшивают. Одно число вместо двух врало бы одному
// из двух расчётов, а какому — зависит от материала.
export function modelAreas(model, winTypes) {
  const m = model || {};
  const H = Number(m.h) || 0;
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const r2 = function (v) { return Math.round(v * 100) / 100; };

  // Проёмы считаем по тому же правилу, что и всё остальное: у каждого ОДНО помещение.
  const opArea = {};
  (m.openings || []).forEach(function (op) {
    const t = byType[op.typeId]; if (!t) return;
    const room = openingRoom(m, op); if (!room) return;
    opArea[room.id] = (opArea[room.id] || 0) + (Number(t.w) || 0) * (Number(t.h) || 0) / 1000000;
  });

  const rooms = modelRooms(m).map(function (r) {
    const gross = r2(r.wallLen * H / 1000);
    const ops = r2(opArea[r.id] || 0);
    return {
      id: r.id, name: r.name,
      w: r2(r.finW / 1000), l: r2(r.finL / 1000), h: r2(H / 1000),
      perimeter: r.wallLen,
      floor: r.area, ceil: r.area,
      wallGross: gross, openings: ops, wallNet: Math.max(0, r2(gross - ops)),
    };
  });
  const sum = function (k) { return r2(rooms.reduce(function (a, r) { return a + r[k]; }, 0)); };
  return {
    height: r2(H / 1000), rooms: rooms,
    total: { floor: sum("floor"), ceil: sum("ceil"), wallGross: sum("wallGross"),
      openings: sum("openings"), wallNet: sum("wallNet") },
  };
}

// ─── СХЕМА ПЛАНА ─────────────────────────────────────────────────────────────
// Чертёж в том виде, в каком его читают на площадке: несущие стены, перегородки,
// проёмы и размерные цепочки. Мебели, сантехники и площадей здесь нет намеренно —
// это разные документы. Мебель на плане отвечает на вопрос «как жить», схема — на
// вопрос «что строить», и смешанные вместе они мешают обоим.
//
// Геометрия считается здесь, а не в панели: те же числа нужны экрану, печати и
// проверке, и разъехаться им нельзя. Панель из этого рисует SVG, и только.
//
// Стена коробки на схеме — это ОБШИВКА (`finish`): своей толщины у железа
// контейнера модель не знает, а обрешётка с утеплителем — знает, и именно она
// съедает те сантиметры, из-за которых площади не сходятся с чертежом.
export function modelScheme(model, winTypes) {
  const m = model || {};
  const fin = (m.finish == null) ? FINISH_THICK : (Number(m.finish) || 0);
  const th = Number(m.wallThick) || 0;
  const W = Number(m.w) || 0;
  const L = totalLength(m);
  const bays = modelBays(m);
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });

  const walls = [
    { kind: "shell", x: 0, y: 0, w: L, h: fin },
    { kind: "shell", x: 0, y: W - fin, w: L, h: fin },
    { kind: "shell", x: 0, y: fin, w: fin, h: Math.max(0, W - fin * 2) },
    { kind: "shell", x: L - fin, y: fin, w: fin, h: Math.max(0, W - fin * 2) },
  ];
  bays.forEach(function (b, i) {
    if (i < bays.length - 1) walls.push({ kind: "part", x: b.x1, y: fin, w: th, h: Math.max(0, W - fin * 2) });
    // Продольная перегородка (санузел в углу) идёт по чистовой длине своего отсека.
    if (b.sub) {
      const x0 = Math.max(b.x0, fin), x1 = Math.min(b.x1, L - fin);
      walls.push({ kind: "part", x: x0, y: Number(b.sub.at) || 0, w: Math.max(0, x1 - x0), h: th });
    }
  });

  // Створка двери: петли на одном откосе, полотно поперёк стены, дуга — путь створки.
  // Считаем её здесь, а не в панели: куда открывается дверь — свойство проёма, а не
  // картинки, и по этим же точкам потом проверяют, не бьётся ли створка о стену.
  const swingOf = function (box, along, out, hinge) {
    const face = { x: box.x + (out[0] > 0 ? box.w : 0), y: box.y + (out[1] > 0 ? box.h : 0) };
    const A = along ? { x: box.x, y: face.y } : { x: face.x, y: box.y };
    const B = along ? { x: box.x + box.w, y: face.y } : { x: face.x, y: box.y + box.h };
    const H = (hinge === "start") ? A : B;
    const J = (hinge === "start") ? B : A;
    const len = along ? box.w : box.h;
    return { hinge: H, jamb: J, tip: { x: H.x + out[0] * len, y: H.y + out[1] * len } };
  };

  const openings = (m.openings || []).map(function (op) {
    const t = byType[op.typeId] || { n: "Проём", w: 0, h: 0, kind: "win" };
    const wd = Number(t.w) || 0, pos = Number(op.pos) || 0;
    const sill = (op.sill == null) ? ((t.kind === "door") ? 0 : 900) : (Number(op.sill) || 0);
    let box = null, out = null, along = true;
    if (op.side === "part") {
      const p = partitionAt(m, op.after);
      if (!p) return null;
      box = { x: p.x, y: pos, w: p.w, h: wd };
      // Куда открывается: +1 — в сторону конца контейнера. Модель хранит это у проёма,
      // потому что угадать нельзя, а нарисовать створку не в ту комнату — соврать.
      out = [(Number(op.into) || 1) >= 0 ? 1 : -1, 0];
      along = false;
    } else {
      box = (op.side === "n") ? { x: pos, y: 0, w: wd, h: fin }
        : (op.side === "s") ? { x: pos, y: W - fin, w: wd, h: fin }
          : (op.side === "w") ? { x: 0, y: pos, w: fin, h: wd }
            : { x: L - fin, y: pos, w: fin, h: wd };
      out = (op.side === "n") ? [0, -1] : (op.side === "s") ? [0, 1] : (op.side === "w") ? [-1, 0] : [1, 0];
      along = (op.side === "n" || op.side === "s");
    }
    const kind = t.kind || "win";
    return {
      id: op.id, side: op.side, after: op.after || "", kind: kind, name: t.n || "Проём",
      pos: pos, width: wd, height: Number(t.h) || 0, sill: sill,
      x: box.x, y: box.y, w: box.w, h: box.h,
      swing: (kind === "door") ? swingOf(box, along, out, op.hinge || (along ? "end" : "start")) : null,
    };
  }).filter(function (o) { return o && o.width > 0; });

  // Марки проёмов, как на чертеже: Д-1, Д-2… по дверям и О-1, О-2… по окнам.
  let nd = 0, nw = 0;
  openings.forEach(function (o) { o.mark = (o.kind === "door") ? ("Д-" + (++nd)) : ("О-" + (++nw)); });

  // Имена помещений: без них чертёж читают, водя пальцем по цепочкам. Площадей и
  // мебели на схеме по-прежнему нет — это разные документы.
  const labels = modelRooms(m).map(function (r) {
    return { id: r.id, name: r.name, x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  });

  // Размерная цепочка — набор отметок и длин между ними. Считаем отсюда, чтобы
  // подпись на чертеже не могла разойтись с моделью: сумма цепочки равна габариту.
  // bounds — от какой отметки до какой идёт цепочка. По умолчанию весь габарит, но
  // дверь в перегородке меряют от ЧИСТОВЫХ стен: обшивка в этой цепочке — шум.
  const chain = function (side, span, marks, name, at, bounds) {
    const lo = bounds ? bounds[0] : 0, hi = bounds ? bounds[1] : span;
    const seen = {};
    const ticks = marks.concat([lo, hi])
      .map(function (v) { return Math.round(Math.max(lo, Math.min(hi, v))); })
      .filter(function (v) { if (seen[v]) return false; seen[v] = 1; return true; })
      .sort(function (a, b) { return a - b; });
    const segs = [];
    for (let i = 0; i < ticks.length - 1; i++) segs.push(ticks[i + 1] - ticks[i]);
    const out = { side: side, name: name, span: span, ticks: ticks, segs: segs };
    if (at != null) { out.at = at; out.inner = true; }
    return out;
  };
  const along = function (sd) {
    return openings.filter(function (o) { return o.side === sd; })
      .reduce(function (a, o) { return a.concat([o.pos, o.pos + o.width]); }, []);
  };

  const bayMarks = [fin];
  bays.forEach(function (b, i) {
    bayMarks.push((i === bays.length - 1) ? (b.x1 - fin) : b.x1);
    if (i < bays.length - 1) bayMarks.push(b.x1 + th);
  });

  const dims = [
    chain("top", L, bayMarks, "Помещения и перегородки"),
    chain("top", L, [], "Габарит"),
    chain("left", W, [fin, W - fin], "Ширина"),
  ];
  if (along("s").length) dims.push(chain("bottom", L, along("s"), "Проёмы"));
  if (along("n").length) dims.push(chain("top", L, along("n"), "Проёмы"));
  if (along("e").length) dims.push(chain("right", W, along("e"), "Проёмы"));
  if (along("w").length) dims.push(chain("left", W, along("w"), "Проёмы"));
  // Дверь в перегородке меряется от чистовых стен, как на чертеже: 75 · 70 · 75.
  // Цепочка стоит у своей перегородки, поэтому у неё есть `at` — отметка по длине.
  openings.filter(function (o) { return o.side === "part"; }).forEach(function (o) {
    dims.push(chain("part", W, [o.pos, o.pos + o.width], o.mark, o.x, [fin, W - fin]));
  });

  return { l: L, w: W, finish: fin, wallThick: th,
    walls: walls, openings: openings, labels: labels, dims: dims };
}

// Что мешает считать по модели. Продавец должен видеть это до клиента.
export function modelIssues(model, winTypes) {
  const out = [];
  const rooms = modelRooms(model);
  if (!rooms.length) out.push("В модели нет помещений");
  rooms.forEach(function (r) {
    if (r.len < MIN_ROOM) out.push("«" + r.name + "»: меньше " + MIN_ROOM + " мм — это уже не помещение");
  });
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  (model.openings || []).forEach(function (op) {
    if (!byType[op.typeId]) out.push("Проём без типового изделия — цена не посчитается");
    const len = sideLength(model, op.side);
    const t = byType[op.typeId] || {};
    const wmm = Number(t.w) || 0;
    if ((Number(op.pos) || 0) + wmm > len) out.push("«" + (t.n || "Проём") + "» выходит за стену");
  });
  if (!(model.openings || []).length) out.push("Ни одного окна или двери");
  return out;
}
