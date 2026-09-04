// ─── СПЕЦИФИКАЦИЯ 2 — ЭКСПЕРИМЕНТАЛЬНЫЙ РАЗДЕЛ ───────────────────────────────
// Второй, опытный заход на продажу дома. Раздел намеренно ПУСТОЙ: экрана отделки,
// комплектаций, матрицы и мастера здесь нет — они остались в боевой «Спецификации».
// Копия чужого экрана мешала бы главному: на этом месте будет собрана своя логика,
// а не подправленная старая.
//
// Что раздел уже знает:
//  1. СВОИ ДАННЫЕ — листы лежат в разделе снимка `specSheets2`. Эксперимент, который
//     пишет в проданные спецификации, — не эксперимент, а авария: по ним заведены
//     договора, объекты и транши.
//  2. ДОМ — ЭТО МОДЕЛЬ КОНТЕЙНЕРА. Отсюда и критерий готовности (issues2): пока
//     коробка не собрана, считать нечего, и говорить про невыбранную отделку рано.
//  3. ДЕНЬГИ ОБЩИЕ — цену считает боевой модуль (`src/spec.js`). Своя копия формул
//     означала бы, что клиенту называют одну цену, а в договор и объект уходит
//     другая, и находится это в лучшем случае на приёмке этапа. Понадобится своя
//     цена — её место здесь, в totals2, осознанной развилкой.

import { sheetTotals, pointTotals, pointMeta } from "./spec.js";
import { modelIssues, modelAreas, modelTotals } from "./model.js";
import { allPositions, allPositionsRaw, probeSheet, positionWhy, roomKeyOf, PIE_SOURCES, pieCost } from "./recipe.js";
export { ROOM_HOUSE, posRoomOf } from "./recipe.js";

// Пробный лист и объяснение количества живут в src/recipe.js — там же, где
// правила, которые ими пользуются. Здесь они переэкспортированы, потому что
// раздел спрашивает их у своего модуля, а не ходит за ними через голову.
export { probeSheet, positionWhy };

// Деньги — общие с боевым разделом: позиции считает та же машинка (`positionFor`),
// а состав дома — тот же `allPositions`, которым собирается объект. Своя копия
// формул означала бы, что клиенту называют одну цену, а в договор и объект уходит
// другая, и находится это в лучшем случае на приёмке этапа.
//
// Отличие одно и осознанное: сюда входят позиции, которые дали ПРАВИЛА. Без них
// договор заводился бы на сумму, которой на экране никто не видел.
export function totals2(sheet, ctx) {
  const c = ctx || {};
  if (!c.rules || !c.rules.length) return sheetTotals(probeSheet(sheet, c.winTypes), c.estimates, c.products);
  const pos = allPositions(sheet, c);
  const cost = pos.reduce(function (a, p) { return a + (Number(p.cost) || 0); }, 0);
  const markup = Number(sheet && sheet.markup);
  const mk = isFinite(markup) && markup >= 0 ? markup : 0;
  const byStage = {};
  pos.forEach(function (p) { byStage[p.stage] = (byStage[p.stage] || 0) + p.cost; });
  return { positions: pos, cost: cost, markup: mk, price: Math.round(cost * (1 + mk / 100)),
    byStage: byStage, count: pos.length };
}

// Что мешает считать по этому листу. Спрашиваем МОДЕЛЬ, а не отделку: раздел про
// коробку, и предупреждение «не выбраны стены» здесь было бы про экран, которого нет.
export function issues2(sheet, winTypes) {
  const model = (sheet && sheet.model) || null;
  if (!model) return ["Не собрана модель контейнера — с неё здесь начинается дом"];
  const out = [];
  if (((model.rooms || []).length) < 2) out.push("В модели одно помещение — перегородок ещё нет");
  return out.concat(modelIssues(model, winTypes || []));
}

// ─── СМЕТА ИЗ ЧЕРТЕЖА ────────────────────────────────────────────────────────
// Модель уже знает всё, из чего считается смета: площади помещений, проёмы и
// раскладку точек. До сих пор эти числа жили только на схеме, а список работ
// собирался руками из справочника — нарисованное до сметы не доезжало.
//
// Здесь дом называет свои числа сам, и у каждой строки видно, ОТКУДА количество:
// «пол 14,08 м²», «Розетка 15 шт». Число, про которое непонятно, как оно
// получилось, проверить нельзя — его либо принимают на веру, либо не верят вовсе.
//
// Ничего не сохраняется: считается на лету по модели листа. Значит, нечему и
// разъехаться с чертежом — а заодно видно, каких позиций в справочнике не
// хватает, чтобы дом посчитался целиком (см. gaps2).

const SURFACE2 = { floor: "пол", wall: "стены", ceil: "потолок" };

function num2(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return String(n).replace(".", ",");
}

// Что дом рассказал о себе: площади, изделия в проёмах, раскладка точек. Это те
// самые числа, на которые дальше умножается смета, и показываются они рядом с
// ней — иначе проверять пришлось бы, сверяя два экрана.
export function modelFacts(sheet, winTypes) {
  const model = (sheet && sheet.model) || null;
  const types = winTypes || [];
  const empty = { height: 0, rooms: [], total: { floor: 0, ceil: 0, wallGross: 0, wallNet: 0, openings: 0 },
    points: [], openings: [], partitions: 0, goodsCost: 0 };
  if (!model) return empty;
  const A = modelAreas(model, types);
  const byType = {};
  types.forEach(function (t) { if (t && t.id) byType[t.id] = t; });

  // Изделия — по видам, а не по штукам: заказывают их именно так, и цена в
  // справочнике стоит за одно.
  const openings = [], seen = {};
  (model.openings || []).forEach(function (op) {
    const t = byType[op.typeId];
    if (!t) return;
    if (!seen[op.typeId]) {
      seen[op.typeId] = { typeId: op.typeId, name: t.n || "Изделие", kind: t.kind === "door" ? "door" : "win",
        w: Number(t.w) || 0, h: Number(t.h) || 0, cost: Number(t.cost) || 0, count: 0 };
      openings.push(seen[op.typeId]);
    }
    seen[op.typeId].count++;
  });

  const totals = pointTotals(probeSheet(sheet, types));
  const points = Object.keys(totals).map(function (k) {
    const m = pointMeta(k);
    return { k: k, n: (m && m.n) || k, emoji: (m && m.emoji) || "•", count: totals[k] };
  }).filter(function (p) { return p.count > 0; });

  const mt = modelTotals(model, types);
  return { height: A.height, rooms: A.rooms, total: A.total, points: points, openings: openings,
    partitions: mt.partitions, goodsCost: mt.openingsCost };
}

// Смета по этому дому: позиции с объяснением количества, разложенные по этапам.
// Стройка меряется этапами, по ним же идут сроки, приёмка и транши — значит и
// смета читается в этом разрезе, а не сплошным списком.
// ctx = {estimates, products, winTypes, stages, rules} — одним объектом, потому
// что тот же контекст уходит в сборку объекта: список аргументов, который надо
// повторить в двух местах в одном порядке, рано или поздно повторят неправильно.
// Блок этапа — работы ОДНОГО помещения подряд: «Санузел — стены, пол, потолок».
// Позиции уже разложены по комнатам, здесь мы только режем список на куски и
// считаем сумму каждого: этап на сорок строк читается комнатами, а не сплошняком.
function blocksOf(positions) {
  const out = [];
  (positions || []).forEach(function (p) {
    const k = roomKeyOf(p);
    const last = out[out.length - 1];
    if (last && last.key === k) { last.positions.push(p); last.cost += Number(p.cost) || 0; return; }
    out.push({ key: k, room: String(p.room || ""), positions: [p], cost: Number(p.cost) || 0 });
  });
  return out.map(function (b) { return Object.assign(b, { cost: Math.round(b.cost) }); });
}

export function works2(sheet, ctx) {
  const c = ctx || {};
  const raw = allPositionsRaw(sheet, c);
  const positions = raw.positions;
  const cost = positions.reduce(function (a, p) { return a + (Number(p.cost) || 0); }, 0);
  const mk = (function () {
    const m = Number(sheet && sheet.markup);
    return isFinite(m) && m >= 0 ? m : 0;
  })();
  const known = {};
  (c.stages || []).forEach(function (s) { if (s) known[Number(s.n)] = s; });
  const byStage = {};
  const order = [];
  positions.forEach(function (p) {
    const n = Number(p.stage) || 0;
    if (!byStage[n]) { byStage[n] = { n: n, positions: [], cost: 0 }; order.push(n); }
    byStage[n].positions.push(p);
    byStage[n].cost += Number(p.cost) || 0;
  });
  const stages = order.sort(function (a, b) { return a - b; }).map(function (n) {
    const st = known[n];
    return Object.assign(byStage[n], {
      label: st ? (st.short + " — " + st.label) : "Без этапа",
      color: st ? st.color : "#7a9aaa",
      // Блоки по помещениям. Позиции ПРИХОДЯТ уже сгруппированными (`applyRooms`),
      // поэтому здесь только сплошные куски — иначе экран и объект разошлись бы
      // порядком, а сумма блока перестала бы сходиться с суммой его строк.
      blocks: blocksOf(byStage[n].positions),
    });
  });
  return {
    facts: modelFacts(sheet, c.winTypes),
    // Комнаты дома — ВСЕ, а не только те, где что-то посчиталось: работу
    // переносят и в пустую комнату, а блока у неё ещё нет.
    rooms: (((probeSheet(sheet, c.winTypes).specs) || {}).rooms || [])
      .map(function (r) { return { id: r.id, name: String(r.name || "") }; }),
    positions: positions, stages: stages, groups: raw.groups,
    cost: Math.round(cost), markup: mk, price: Math.round(cost * (1 + mk / 100)),
    gaps: gaps2(sheet, c),
  };
}

// Что дом посчитал, а смета не использовала. Это не украшение экрана: ровно этот
// список и есть задание на правила сборки — пока розетки посчитаны, а позиции,
// которая их считает, в справочнике нет, дом продаётся не целиком.
export function gaps2(sheet, ctx) {
  const c = ctx || {};
  const winTypes = c.winTypes;
  const probe = probeSheet(sheet, winTypes);
  if (!probe.model) return [];
  // Пробел закрывается и правилом тоже — иначе список не пустел бы по мере
  // настройки, а именно ради этого он и написан.
  const pos = allPositions(sheet, c);
  const out = [];

  const totals = pointTotals(probe);
  Object.keys(totals).forEach(function (k) {
    if (!totals[k]) return;
    if (pos.some(function (p) { return p.point === k; })) return;
    const m = pointMeta(k);
    out.push({ kind: "point", k: k, t: ((m && m.n) || k) + " ×" + totals[k], why: "нет позиции, которая их считает" });
  });

  const A = modelAreas(probe.model, winTypes || []);
  [["floor", A.total.floor], ["wall", A.total.wallNet], ["ceil", A.total.ceil]].forEach(function (pair) {
    if (!(pair[1] > 0)) return;
    if (pos.some(function (p) { return p.surface === pair[0] && p.area > 0; })) return;
    out.push({ kind: "surface", k: pair[0], t: SURFACE2[pair[0]] + " " + num2(pair[1]) + " м²",
      why: "ни одна позиция этим не меряется" });
  });

  // Пирог знает, из чего стена, но не знает, по чём. Слой без товара — это
  // конструкция, которую никто не оплачивает: в смету она не попадает.
  if (c.pies) {
    PIE_SOURCES.forEach(function (src) {
      const m = pieCost(probe.model, src.key, c.products, winTypes);
      if (!m.layers || m.priced >= m.layers) return;
      out.push({ kind: "pie", k: src.key,
        t: "пирог «" + src.n + "» · " + (m.layers - m.priced) + " из " + m.layers + " слоёв без товара",
        why: "их стоимость в смету не попадает" });
    });
  }

  // Окна и двери смета считает монтажом, а сами изделия стоят в справочнике
  // проёмов. Пока их не свели в одну сумму, дом на экране дешевле, чем на складе.
  const mt = modelTotals(probe.model, winTypes || []);
  if (mt.openingsCost > 0) {
    out.push({ kind: "goods", k: "openings", t: "изделия проёмов " + Math.round(mt.openingsCost).toLocaleString("ru-RU") + " ₽",
      why: "в смете только монтаж, стоимость окон и дверей живёт в справочнике изделий" });
  }
  return out;
}
