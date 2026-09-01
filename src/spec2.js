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

import { sheetTotals, sheetPositions, pointTotals, pointMeta } from "./spec.js";
import { modelIssues, modelToSpecs, modelAreas, modelTotals } from "./model.js";

// Деньги — общие с боевым разделом. См. заголовок: это решение, а не заглушка.
export function totals2(sheet, estimates, products) {
  return sheetTotals(sheet, estimates, products);
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

// Лист, у которого характеристики взяты из МОДЕЛИ. Сам лист не трогаем: расчёт
// не имеет права молча переписать данные, по которым его же и проверяют.
export function probeSheet(sheet, winTypes) {
  const sh = sheet || {};
  if (!sh.model) return sh;
  const keep = sh.specs || {};
  const specs = modelToSpecs(sh.model, winTypes || []);
  specs.planUrl = keep.planUrl || "";
  specs.planName = keep.planName || "";
  return Object.assign({}, sh, { specs: specs });
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

// Откуда у строки количество. Формулировка одна на экран и на печать: разойдись
// они, на бумаге стояло бы не то, что показывали.
export function positionWhy(pos) {
  const p = pos || {};
  if (p.point) {
    const m = pointMeta(p.point);
    return ((m && m.n) || "точки") + " " + (Number(p.count) || 0) + " шт";
  }
  if (Number(p.area) > 0) {
    return (SURFACE2[p.surface] || "площадь") + " " + num2(p.area) + " м²" + (p.room ? " · " + p.room : "");
  }
  return p.room || "на весь дом";
}

// Смета по этому дому: позиции с объяснением количества, разложенные по этапам.
// Стройка меряется этапами, по ним же идут сроки, приёмка и транши — значит и
// смета читается в этом разрезе, а не сплошным списком.
export function works2(sheet, estimates, products, winTypes, estStages) {
  const probe = probeSheet(sheet, winTypes);
  const positions = sheetPositions(probe, estimates, products).map(function (p) {
    return Object.assign({}, p, { why: positionWhy(p) });
  });
  const cost = positions.reduce(function (a, p) { return a + (Number(p.cost) || 0); }, 0);
  const mk = (function () {
    const m = Number(sheet && sheet.markup);
    return isFinite(m) && m >= 0 ? m : 0;
  })();
  const known = {};
  (estStages || []).forEach(function (s) { if (s) known[Number(s.n)] = s; });
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
    });
  });
  return {
    facts: modelFacts(sheet, winTypes),
    positions: positions, stages: stages,
    cost: Math.round(cost), markup: mk, price: Math.round(cost * (1 + mk / 100)),
    gaps: gaps2(sheet, estimates, products, winTypes),
  };
}

// Что дом посчитал, а смета не использовала. Это не украшение экрана: ровно этот
// список и есть задание на правила сборки — пока розетки посчитаны, а позиции,
// которая их считает, в справочнике нет, дом продаётся не целиком.
export function gaps2(sheet, estimates, products, winTypes) {
  const probe = probeSheet(sheet, winTypes);
  if (!probe.model) return [];
  const pos = sheetPositions(probe, estimates, products);
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

  // Окна и двери смета считает монтажом, а сами изделия стоят в справочнике
  // проёмов. Пока их не свели в одну сумму, дом на экране дешевле, чем на складе.
  const mt = modelTotals(probe.model, winTypes || []);
  if (mt.openingsCost > 0) {
    out.push({ kind: "goods", k: "openings", t: "изделия проёмов " + Math.round(mt.openingsCost).toLocaleString("ru-RU") + " ₽",
      why: "в смете только монтаж, стоимость окон и дверей живёт в справочнике изделий" });
  }
  return out;
}
