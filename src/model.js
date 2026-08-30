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
//     rooms:    [{id, name, len, pts}],        // сегменты вдоль контейнера
//     openings: [{id, side, pos, typeId, roomId}],  // проёмы на стенах
//     wallThick                       // толщина перегородки, мм
//   }
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
  const src = m.rooms || [];
  let x = 0;
  return src.map(function (r, i) {
    const len = Math.max(0, Number(r.len) || 0);
    // Чистовые размеры: отделка съедает по стене с каждой стороны. У торцевых
    // помещений — ещё и по внешней стене контейнера.
    const fw = Math.max(0, (Number(m.w) || 0) - fin * 2);
    const fl = Math.max(0, len - (i === 0 ? fin : 0) - (i === src.length - 1 ? fin : 0));
    const out = {
      id: r.id, name: r.name || "Помещение", len: len, x0: x, x1: x + len,
      pts: r.pts || {}, finW: fw, finL: fl,
      area: Math.round(fl * fw / 1000 / 1000 * 100) / 100,
      wallLen: Math.round((fl + fw) * 2) / 1000,
    };
    x += len + (Number(m.wallThick) || 0);
    return out;
  });
}

// Длина стены, вдоль которой ставятся проёмы. Длинные стены идут по всему
// контейнеру, торцы — по его ширине.
export function sideLength(model, side) {
  const m = model || {};
  return (side === "w" || side === "e") ? (Number(m.w) || 0) : totalLength(m);
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
  if (op.side === "w") return rooms[0];
  if (op.side === "e") return rooms[rooms.length - 1];
  const pos = Number(op.pos) || 0;
  return rooms.find(function (r) { return pos >= r.x0 && pos <= r.x1; }) || null;
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

// Разделить помещение перегородкой пополам. Новое помещение получает свой id —
// раскладка и отделка привязаны к id, и делить их пополам было бы враньём.
export function splitRoom(model, roomId, newId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0) return model;
  const r = rooms[i];
  const len = Number(r.len) || 0;
  const half = Math.round((len - (Number(model.wallThick) || 0)) / 2);
  if (half < MIN_ROOM) return model;   // делить нечего
  const left = Object.assign({}, r, { len: half });
  const right = { id: newId, name: "Помещение", len: len - half - (Number(model.wallThick) || 0), pts: {} };
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([left, right], rooms.slice(i + 1)) });
}

// Убрать перегородку справа от помещения: соседи сливаются, длина перегородки
// возвращается в помещение. Раскладка соседа переезжает — точки никуда не делись.
export function mergeRoom(model, roomId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0 || i + 1 >= rooms.length) return model;
  const a = rooms[i], b = rooms[i + 1];
  const pts = Object.assign({}, a.pts || {});
  Object.keys(b.pts || {}).forEach(function (k) { pts[k] = (pts[k] || 0) + b.pts[k]; });
  const merged = Object.assign({}, a, {
    len: (Number(a.len) || 0) + (Number(b.len) || 0) + (Number(model.wallThick) || 0),
    pts: pts,
  });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([merged], rooms.slice(i + 2)) });
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
  const walls = Math.max(0, (model.rooms || []).length - 1);
  return {
    openingsCost: Math.round(openings),
    openingsArea: Math.round(area * 100) / 100,
    partitions: walls,
    partitionArea: Math.round(walls * (Number(model.w) || 0) * (Number(model.h) || 0) / 1000000 * 100) / 100,
    floorArea: Math.round(modelRooms(model).reduce(function (a, r) { return a + r.area; }, 0) * 100) / 100,
  };
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
