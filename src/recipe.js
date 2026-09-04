// ─── ПРАВИЛА СБОРКИ ──────────────────────────────────────────────────────────
// Смета собиралась руками: человек открывал справочник и решал, какие позиции
// входят в этот дом. Чертёж при этом молчал, хотя знает всё, чем эти позиции
// меряются — площади помещений, число проёмов, раскладку точек.
//
// Правило говорит только одно: К ЧЕМУ применяется смета из справочника.
// «Стены ОСП — на стены каждого помещения», «Монтаж розетки — на каждую точку».
// Дальше позиция считается ТОЙ ЖЕ машинкой (`positionFor` из spec.js), которой
// считается спецификация: своя копия формул означала бы, что правило обещает одну
// сумму, а объект собирается по другой.
//
// Материалов у правила своих НЕТ. Они уже описаны в смете, у неё есть экран, связь
// с каталогом и история цен; вторая копия того же разошлась бы с первой на первой
// же правке. Правило добавляет условие, а не ещё один справочник.
//
// ГДЕ ПРАВИЛА ПРИМЕНЯЮТСЯ, решает вызывающий: `allPositions` берёт правила
// параметром. Панель передаёт их только листам опытного раздела — по боевым
// спецификациям заведены договора, объекты и транши, и молча изменить их сумму
// новым правилом нельзя.

import { positionFor, roomArea, roomPoints, pointMeta, sheetPositions, matQtyForArea } from "./spec.js";
import { modelToSpecs, modelTotals, modelAreas } from "./model.js";

// Чем меряется правило. `need` — что ещё обязано быть заполнено, иначе правило
// не о чем: поверхность без «пол/стены/потолок» и точка без вида точки — это
// незаконченная настройка, а не правило.
export const RULE_WHATS = [
  { k: "surface", n: "по площади поверхности", need: "surface" },
  { k: "point",   n: "по точкам раскладки",    need: "point" },
  { k: "room",    n: "на каждое помещение",    need: "" },
  { k: "part",    n: "на каждую перегородку",  need: "" },
  { k: "house",   n: "один раз на дом",        need: "" },
];
export const RULE_SURFACES = [["floor", "пол"], ["wall", "стены"], ["ceil", "потолок"]];
export const RULE_SCOPES = [["room", "по каждому помещению"], ["house", "на весь дом"]];

const SURFACE_N = { floor: "пол", wall: "стены", ceil: "потолок" };

function whatMeta(k) { return RULE_WHATS.find(function (x) { return x.k === k; }) || RULE_WHATS[0]; }

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

// Откуда у строки количество. Формулировка одна на экран, печать и правило:
// число, про которое непонятно, как оно получилось, не проверяют — его либо
// принимают на веру, либо не верят вовсе.
export function positionWhy(pos) {
  const p = pos || {};
  if (p.point) {
    const m = pointMeta(p.point);
    return ((m && m.n) || "точки") + " " + (Number(p.count) || 0) + " шт";
  }
  if (Number(p.area) > 0) {
    const n = Math.round((Number(p.area) || 0) * 100) / 100;
    return (SURFACE_N[p.surface] || "площадь") + " " + String(n).replace(".", ",") + " м²" + (p.room ? " · " + p.room : "");
  }
  return p.room || "на весь дом";
}

// Правило человеческими словами. Читается в списке правил и в объяснении строки:
// «Стены ОСП — стены каждого помещения». Собирается здесь, а не в панели, чтобы
// список правил и подпись на строке сметы говорили одно и то же.
export function ruleText(rule) {
  const r = rule || {};
  const w = whatMeta(r.what);
  const room = String(r.room || "").trim();
  const where = room ? " · помещения «" + room + "»" : "";
  if (r.what === "surface") {
    const s = SURFACE_N[r.k] || "поверхность";
    return (r.scope === "house" ? s + " всего дома" : s + " каждого помещения") + where;
  }
  if (r.what === "point") {
    const m = pointMeta(r.k);
    return (r.scope === "house" ? "все точки «" : "точки «") + ((m && m.n) || r.k) + "»" +
      (r.scope === "house" ? " по дому" : " по каждому помещению") + where;
  }
  if (r.what === "room") return "на каждое помещение" + where;
  if (r.what === "part") return "на каждую перегородку";
  return w.n;
}

// Правило без обязательного поля не применяется молча — оно недонастроено, и об
// этом надо сказать в списке, а не тихо отдавать ноль строк.
export function ruleReady(rule) {
  const r = rule || {};
  if (!r.estId) return "не выбрана смета";
  const need = whatMeta(r.what).need;
  if (need === "surface" && !SURFACE_N[r.k]) return "не выбрана поверхность";
  if (need === "point" && !r.k) return "не выбрана точка";
  return "";
}

function roomMatch(rule, room) {
  const q = String((rule && rule.room) || "").trim().toLowerCase();
  if (!q) return true;
  return String((room && room.name) || "").toLowerCase().indexOf(q) >= 0;
}

// Позиции, которые дают правила по этому дому. Каждая помечена `ruleId` и `from`,
// потому что в смете рядом стоят строки из справочника — и различать их надо
// глазом, а не догадкой.
export function rulePositions(sheet, rules, estimates, products, winTypes) {
  const probe = probeSheet(sheet, winTypes);
  const specs = probe.specs || {};
  const rooms = specs.rooms || [];
  const H = Number(specs.height) || 0;
  const kind = probe.kind || "banya";
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  const byId = {};
  (estimates || []).forEach(function (e) { if (e && e.id) byId[e.id] = e; });
  const parts = probe.model ? modelTotals(probe.model, winTypes || []).partitions : 0;
  const out = [];

  (rules || []).forEach(function (r) {
    if (!r || r.off) return;
    if ((r.kind || "banya") !== kind) return;
    if (ruleReady(r)) return;
    const est = byId[r.estId];
    if (!est) return;
    const mult = Number(r.qty) > 0 ? Number(r.qty) : 1;
    const add = function (ctx) {
      const p = positionFor(est, ctx, prodById);
      // Множитель умножает МАТЕРИАЛЫ, а не только сумму: объект собирается по
      // материалам (`w.cost` = их сумма), и «×2» в одной только цене означало бы,
      // что на экране одна смета, а на стройку уехала вдвое дешевле.
      if (mult !== 1) {
        p.mats = (p.mats || []).map(function (m) {
          return Object.assign({}, m, { qty: Math.round((Number(m.qty) || 0) * mult * 100) / 100 });
        });
        p.cost = Math.round(p.mats.reduce(function (a, m) { return a + (Number(m.cost) || 0) * (Number(m.qty) || 0); }, 0));
        // `factor` остаётся единицей: множитель уже вшит в количества материалов, и
        // второй раз его применять нельзя — иначе пересчёт строки удвоит цену.
        p.mult = mult;
      }
      p.stage = Number(r.stage) > 0 ? Number(r.stage) : p.stage;
      p.ruleId = r.id;
      p.from = "rule";
      p.why = positionWhy(p);
      out.push(p);
    };
    const key = function (suffix) { return "rule:" + r.id + ":" + suffix; };

    if (r.what === "surface") {
      if (r.scope === "house") {
        let area = 0;
        rooms.forEach(function (rm) { if (roomMatch(r, rm)) area += roomArea(rm, H, r.k); });
        if (area <= 0) return;
        add({ key: key("house"), area: Math.round(area * 100) / 100, surface: r.k, count: 0, point: "" });
        return;
      }
      rooms.forEach(function (rm) {
        if (!roomMatch(r, rm)) return;
        const area = roomArea(rm, H, r.k);
        if (area <= 0) return;
        add({ key: key(rm.id), area: Math.round(area * 100) / 100, roomId: rm.id, roomName: rm.name || "",
          surface: r.k, count: 0, point: "" });
      });
      return;
    }

    if (r.what === "point") {
      if (r.scope === "house") {
        let cnt = 0;
        rooms.forEach(function (rm) { if (roomMatch(r, rm)) cnt += roomPoints(rm, r.k); });
        if (!cnt) return;
        add({ key: key("house"), area: 0, count: cnt, point: r.k });
        return;
      }
      rooms.forEach(function (rm) {
        if (!roomMatch(r, rm)) return;
        const cnt = roomPoints(rm, r.k);
        if (!cnt) return;
        add({ key: key(rm.id), area: 0, roomId: rm.id, roomName: rm.name || "", count: cnt, point: r.k });
      });
      return;
    }

    if (r.what === "room") {
      rooms.forEach(function (rm) {
        if (!roomMatch(r, rm)) return;
        add({ key: key(rm.id), area: 0, roomId: rm.id, roomName: rm.name || "", count: 1, point: "" });
      });
      return;
    }

    if (r.what === "part") {
      if (!parts) return;
      add({ key: key("part"), area: 0, count: parts, point: "" });
      return;
    }

    add({ key: key("house"), area: 0, count: 0, point: "" });
  });

  return out;
}


// ─── ДОМ КАК КОНСТРУКЦИЯ: ПИРОГ СЧИТАЕТ СЕБЯ САМ ─────────────────────────────
// Пироги стен уже описывают, из чего собран дом: металл, ППУ, обрешётка, ОСП,
// фанера. До сих пор они знали только толщину — по ней шёл план. Дай слою товар
// из каталога, и он посчитает себя сам: площадь × цена, тем же `matQtyForArea`,
// которым считается вся остальная смета.
//
// Источник здесь — КОНСТРУКЦИЯ, а не справочник смет: одно место правды о том,
// из чего сделана стена, вместо двух — пирога в узле и позиции в справочнике.
// Конструктивом дом не исчерпывается (печь, сантехника, доставка), поэтому это
// не замена правилам, а вторая половина: пироги дают стены, правила — остальное.
export const PIE_SOURCES = [
  { key: "skin",   n: "наружная стена", surface: "wall" },
  { key: "layers", n: "перегородка",    surface: "" },
];

// Чем меряется пирог. Наружная стена — ЧИСТОЙ площадью: проём режет её насквозь,
// и все слои в этом месте отсутствуют. Перегородки — своей площадью из модели.
export function pieArea(model, key, winTypes) {
  if (!model) return 0;
  if (key === "skin") return modelAreas(model, winTypes || []).total.wallNet;
  return modelTotals(model, winTypes || []).partitionArea;
}

export function pieMeta(key) {
  return PIE_SOURCES.find(function (x) { return x.key === key; }) || PIE_SOURCES[0];
}

// Материал слоя по карточке каталога, с количеством под площадь.
export function layerMat(layer, product, area) {
  const p = product || {};
  const mat = {
    pid: (layer && layer.pid) || "", n: p.name || "", store: p.store || "", url: p.url || "", note: "",
    cost: Number(p.unitCost) || 0, mode: p.mode || "piece", qty: 0, unitCost: Number(p.unitCost) || 0,
  };
  ["packBase", "packPer", "lenPer", "sheetM2"].forEach(function (k) { if (p[k] != null) mat[k] = p[k]; });
  mat.qty = matQtyForArea(mat, area);
  return mat;
}

// Позиции, которые дают пироги. Слой без товара молчит: он описывает конструкцию,
// но о деньгах ничего не сказал, и придумывать за него цену нельзя.
export function layerPositions(sheet, estimates, products, winTypes) {
  const sh = sheet || {};
  const model = sh.model;
  if (!model) return [];
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  const out = [];
  PIE_SOURCES.forEach(function (src) {
    const list = model[src.key] || [];
    if (!list.length) return;
    const area = pieArea(model, src.key, winTypes);
    if (!(area > 0)) return;
    list.forEach(function (l, i) {
      if (!l || !l.pid) return;
      const prod = prodById[l.pid];
      if (!prod) return;
      const mat = layerMat(l, prod, area);
      const cost = Math.round((Number(mat.cost) || 0) * (Number(mat.qty) || 0));
      out.push({
        key: "layer:" + src.key + ":" + (l.id || i), estId: "", from: "layer",
        pie: src.key, layerId: l.id || String(i),
        name: (l.n || prod.name || "Слой") + " — " + src.n,
        stage: Number(l.stage) > 0 ? Number(l.stage) : 2,
        room: "", roomId: "", surface: src.surface, group: "", label: "",
        area: Math.round(area * 100) / 100, point: "", count: 0,
        mats: [mat], cost: cost, factor: 1,
        why: src.n + " " + String(Math.round(area * 100) / 100).replace(".", ",") + " м²",
      });
    });
  });
  return out;
}

// Сколько стоит квадрат этой стены по нынешнему пирогу. Число для узла: правишь
// слой — сразу видно, во что он обходится, и ходить за этим в смету не надо.
export function pieCost(model, key, products, winTypes) {
  const area = pieArea(model, key, winTypes);
  const pos = layerPositions({ model: model }, [], products, winTypes)
    .filter(function (p) { return p.pie === key; });
  const total = pos.reduce(function (a, p) { return a + p.cost; }, 0);
  const list = (model && model[key]) || [];
  return {
    area: Math.round(area * 100) / 100, total: Math.round(total),
    perM2: area > 0 ? Math.round(total / area) : 0,
    priced: pos.length, layers: list.length,
  };
}


// ─── ЗАМЕНА МАТЕРИАЛА И РУЧНОЕ КОЛИЧЕСТВО ────────────────────────────────────
// Состав строки приезжает из справочника (или из пирога), но дом живёт своей
// сметой: «эту гофру берём другую». Замена лежит НА ЛИСТЕ (`sheet.mats`), а не
// правит справочник: справочник общий, и правка в нём меняла бы состав всех
// будущих домов заодно.
//
// Ключ — адрес позиции и старый товар: `sheet.mats[posKey][oldPid] = newPid`.
// По этому же адресу собирается объект и считается подпись состава, поэтому
// замена доезжает и до стройки, и до «в проекте изменилось» сама.
export function matSwapsOf(sheet, key) {
  return (((sheet && sheet.mats) || {})[key]) || {};
}

// Материал по карточке каталога, с пересчётом количества. Площадные позиции
// пересчитываются под новую фасовку (лист 2,9 м² и лист 3 м² — разное число
// листов), штучные количество не меняют: там считались штуки, а не квадраты.
export function swapMat(mat, product, area) {
  const p = product || {};
  const next = Object.assign({}, mat, {
    pid: p.id || "", n: p.name || "", store: p.store || "", url: p.url || "",
    cost: Number(p.unitCost) || 0, unitCost: Number(p.unitCost) || 0, mode: p.mode || "piece",
    swapped: true,
  });
  ["packBase", "packPer", "lenPer", "sheetM2"].forEach(function (k) {
    if (p[k] != null) next[k] = p[k]; else delete next[k];
  });
  if (Number(area) > 0) next.qty = matQtyForArea(next, Number(area));
  return next;
}

// Количество, поставленное руками (`sheet.matQty[posKey][pid]`). Чертёж считает
// честно, но на площадке бывает иначе — подрезка, запас, вторая точка ввода, — и
// спорить с человеком, который эту стройку ведёт, портал не должен. Ручное число
// живёт рядом с заменой, на том же листе: справочник от этого не меняется.
export function matQtyOf(sheet, key) {
  return (((sheet && sheet.matQty) || {})[key]) || {};
}

// Материал, добавленный руками к строке (`sheet.matAdd[posKey]`). Смета из
// справочника описывает типовой дом, а на этом доме бывает лишний уголок или
// вторая коробка — дописать его прямо в строке честнее, чем править справочник
// ради одного дома.
// Адрес материала внутри строки сметы. У каталожного это его товар (`pid`), у
// дописанного руками товара может не быть вовсе — тогда собственный id. Без этого
// ручное количество дописанного уходило в пустой ключ и молча доставалось чужому
// материалу без товара, а сам дописанный оставался с прежним числом.
export function matKeyOf(m) { return String((m && (m.pid || m.id)) || ""); }

export function matAddOf(sheet, key) {
  return (((sheet && sheet.matAdd) || {})[key]) || [];
}

// Материал, убранный из строки на ЭТОМ доме (`sheet.matOff[posKey]` — адреса
// материалов). Справочник смет общий на все дома: удалить из него позицию ради
// одного дома значит изменить состав всех будущих. Строка выключает материал у
// себя — и возвращает тем же тапом, поэтому убранное остаётся видно.
export function matOffOf(sheet, key) {
  const v = ((sheet && sheet.matOff) || {})[key];
  return Array.isArray(v) ? v.map(String) : [];
}

export function applyMatEdits(positions, sheet, products) {
  const swaps = (sheet && sheet.mats) || {};
  const qtys = (sheet && sheet.matQty) || {};
  const adds = (sheet && sheet.matAdd) || {};
  const offs = (sheet && sheet.matOff) || {};
  if (!Object.keys(swaps).length && !Object.keys(qtys).length && !Object.keys(adds).length
    && !Object.keys(offs).length) return positions;
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  return (positions || []).map(function (pos) {
    const sw = swaps[pos.key] || {};
    const q = qtys[pos.key] || {};
    const add = adds[pos.key] || [];
    const off = matOffOf(sheet, pos.key);
    if (!Object.keys(sw).length && !Object.keys(q).length && !add.length && !off.length) return pos;
    // Убранный материал — тоже правка: без него строка возвращалась бы как есть.
    let hit = !!add.length || !!off.length;
    const mats = (pos.mats || []).map(function (m) {
      let out = m;
      const nid = sw[m.pid || ""];
      const prod = nid && prodById[nid];
      if (prod) { out = swapMat(m, prod, pos.area); hit = true; }
      // Ручное количество ставится ПОСЛЕ замены: человек правит то число, которое
      // видит на экране, а видит он уже новый товар.
      const own = Number(q[matKeyOf(out)]);
      if (isFinite(own) && own > 0 && own !== Number(out.qty)) {
        out = Object.assign({}, out, { qty: own, qtySet: true });
        hit = true;
      } else if (isFinite(own) && own > 0) {
        out = Object.assign({}, out, { qtySet: true });
      }
      return out;
    });
    if (!hit) return pos;
    // Дописанные идут в конце списка и помечены: по строке видно, что в ней от
    // справочника, а что добавил человек на этом доме.
    // Ручное количество работает и на дописанных: их прибавляют последними, и
    // раньше правка их просто не догоняла — число на экране менялось, а в смете нет.
    const full = mats.concat(add.map(function (a) {
      const own = Number(q[matKeyOf(a)]);
      const row = Object.assign({}, a, { added: true });
      return (isFinite(own) && own > 0)
        ? Object.assign(row, { qty: own, qtySet: true })
        : row;
    }));
    // Убранный материал вычитается ПОСЛЕДНИМ — после замены: человек убирает то,
    // что видит на экране, а видит он уже новый товар.
    const kept = off.length ? full.filter(function (m) { return off.indexOf(matKeyOf(m)) < 0; }) : full;
    const sum = kept.reduce(function (a, m) { return a + (Number(m.cost) || 0) * (Number(m.qty) || 0); }, 0);
    return Object.assign({}, pos, { mats: kept, cost: Math.round(sum * (Number(pos.factor) || 1)) });
  });
}


// ─── ВАРИАНТЫ: ОДИН ИЗ НЕСКОЛЬКИХ ────────────────────────────────────────────
// «Утепление — ППУ 3 см», «— ППУ 5 см», «— ППУ 8 см» — это не три работы, а одно
// решение с тремя ответами. В справочнике они лежат обязательными позициями и
// лезут в дом все сразу.
//
// Почему ПЕРЕКЛЮЧАТЕЛЬ, а не «удалить лишние»: удаление — разовое действие,
// которое пришлось бы повторять на каждом доме, и в следующем доме уже никто не
// вспомнит, что вариантов было три. Переключатель — одно решение, принятое один
// раз, и по нему видно, что выбор вообще есть.
//
// Разметка живёт НА ЛИСТЕ (`sheet.optOf` / `sheet.optPick`), а не в справочнике:
// превратить обязательную смету в вариант — значит убрать её из состава всех
// боевых спецификаций, где выбор ещё не сделан. По ним заведены договора.
export function optGroupOf(sheet, estId) {
  return String((((sheet && sheet.optOf) || {})[estId]) || "");
}

// Имя варианта режется по ПОСЛЕДНЕМУ тире: «Утепление стен и потолка — ППУ 5 см».
// Тире в справочнике бывает любое — длинное, среднее и обычный дефис, — а пробелы
// вокруг него двойные и неразрывные: имена набирают руками, и требовать ровно
// « — » значит не узнать половину вариантов. Ровно на этом ППУ и не собирался,
// когда ЭППС собирался.
function splitOpt(name) {
  const s = String(name || "").replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(.*)\s[—–‒−-]\s(.+)$/.exec(s);
  return m ? { pref: m[1].trim(), label: m[2].trim() } : { pref: s, label: s };
}

// Метка варианта — то, чем он отличается. Полное имя в чипе не помещается,
// а «ППУ 5 см» и есть ответ на вопрос «какой из трёх».
export function optLabelOf(name) { return splitOpt(name).label; }
// Общая часть имени: по ней предлагается объединить строки в группу одним тапом.
export function optPrefixOf(name) { return splitOpt(name).pref; }

// Отсев невыбранных вариантов. Отдаёт и сами группы — экрану нужно показать, из
// чего выбирали и почём: чип без цены не помогает выбрать.
export function applyPicks(positions, sheet) {
  const map = (sheet && sheet.optOf) || {};
  if (!Object.keys(map).length) return { positions: positions, groups: [] };
  const picks = (sheet && sheet.optPick) || {};
  const byGroup = {};
  const order = [];
  (positions || []).forEach(function (p) {
    const g = p.estId ? String(map[p.estId] || "") : "";
    if (!g) return;
    if (!byGroup[g]) { byGroup[g] = { group: g, variants: [], byEst: {} }; order.push(g); }
    const grp = byGroup[g];
    if (!grp.byEst[p.estId]) {
      grp.byEst[p.estId] = { estId: p.estId, name: p.name, label: optLabelOf(p.name), cost: 0 };
      grp.variants.push(grp.byEst[p.estId]);
    }
    // Правило даёт по строке на помещение — в цене варианта они складываются.
    grp.byEst[p.estId].cost += Number(p.cost) || 0;
  });
  const chosen = {};
  order.forEach(function (g) {
    const grp = byGroup[g];
    const want = picks[g];
    const has = grp.variants.some(function (v) { return v.estId === want; });
    // Выбор не сделан — берём первый: молча обнулить дом, потому что человек ещё
    // не дошёл до этой группы, хуже, чем показать один из вариантов.
    chosen[g] = has ? want : (grp.variants[0] || {}).estId;
    grp.picked = chosen[g];
    grp.variants.forEach(function (v) { v.on = v.estId === chosen[g]; });
  });
  const kept = (positions || []).filter(function (p) {
    const g = p.estId ? String(map[p.estId] || "") : "";
    return !g || chosen[g] === p.estId;
  });
  return { positions: kept, groups: order.map(function (g) { return byGroup[g]; }) };
}

// Полный состав дома: то, что выбрано руками в справочнике, плюс то, что дали
// правила. ОДНА функция на экран и на сборку объекта — иначе на экране одна
// смета, а в стройке другая, и находится это на приёмке этапа.
// Правило для сметы ЗАМЕНЯЕТ её обязательную строку, а не добавляется к ней:
// «Контейнер — один раз на дом» и «Контейнер — по площади пола» это одна и та же
// позиция, посчитанная по-разному, и в списке она обязана быть одна.
// Выбор человека (отделка комнаты, общедомовая опция) правило не трогает: там
// решение принято руками, и подменять его нечем.
export function ruledEstIds(sheet, rules) {
  const kind = (sheet && sheet.kind) || "banya";
  const out = {};
  (rules || []).forEach(function (r) {
    if (!r || r.off || (r.kind || "banya") !== kind) return;
    if (ruleReady(r) || !r.estId) return;
    out[r.estId] = true;
  });
  return out;
}

export function allPositions(sheet, ctx) {
  return allPositionsRaw(sheet, ctx).positions;
}

// То же самое, но с группами вариантов: экрану надо показать, из чего выбирали.
export function allPositionsRaw(sheet, ctx) {
  const c = ctx || {};
  const probe = probeSheet(sheet, c.winTypes);
  const ruled = ruledEstIds(probe, c.rules);
  const base = sheetPositions(probe, c.estimates, c.products)
    .filter(function (p) { return !(String(p.key || "").indexOf("base:") === 0 && ruled[p.estId]); })
    .map(function (p) { return Object.assign({}, p, { from: "est", why: positionWhy(p) }); });
  const out = base.concat(rulePositions(sheet, c.rules, c.estimates, c.products, c.winTypes));
  // Пироги считают себя сами там же, где работают правила: боевые спецификации
  // ни того, ни другого не видят — по ним заведены договора, объекты и транши.
  // Дописанные руками работы: справочник описывает типовой дом, а в этом бывает
  // то, чего в нём нет вовсе — вывоз мусора, сборка мебели заказчика, вторая
  // коробка. Править справочник ради одного дома нельзя, он общий.
  const all = (c.pies ? out.concat(layerPositions(sheet, c.estimates, c.products, c.winTypes)) : out)
    .concat(addedPositions(sheet, c.estimates, c.products));
  return applyOrder(applyStage(applyCost(dropOff(applyPicks(applyMatEdits(all, sheet, c.products), sheet), sheet), sheet), sheet), sheet);
}

// Работы, убранные руками из ЭТОГО дома. Смета справочника описывает типовой дом,
// а в конкретном бывает лишняя строка: контейнер уже стоит на участке, электрику
// ведёт заказчик, кухню он привезёт свою. Править ради этого справочник нельзя —
// он общий, — поэтому строка выключается в листе и помнится по своему ключу.
//
// Убранные возвращаются: список уходит на экран, и вернуть строку можно тем же
// тапом. Молча выкинуть работу из сметы — это молча выкинуть её из стройки.
// Работы, дописанные в ЭТОТ дом. Две породы: строка справочника, взятая целиком
// (с её материалами, ценой и этапом), и своя — имя и сумма, которых в справочнике
// нет и не должно быть. Обе живут в листе и считаются тем же кодом, что и всё
// остальное: иначе на экране одна смета, а в стройке другая.
export function addedPositions(sheet, estimates, products) {
  const rows = (sheet && sheet.posAdd) || [];
  if (!rows.length) return [];
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  const byId = {};
  (estimates || []).forEach(function (e) { if (e && e.id) byId[e.id] = e; });
  return rows.map(function (row) {
    const key = "add:" + (row.id || "");
    const est = row.estId ? byId[row.estId] : null;
    if (est) {
      // Берём строку справочника как есть: «на весь дом», без площади и точек —
      // количество материалов такое же, как в самой смете.
      const p = positionFor(est, { key: key, area: 0, count: 0, point: "" }, prodById, row.qty);
      return Object.assign(p, { added: true });
    }
    // Своя строка: цена — это и есть работа, материалов у неё нет. Показываем её
    // одним «материалом» с той же ценой, чтобы деньги считались общим правилом.
    const cost = Math.max(0, Math.round(Number(row.cost) || 0));
    return {
      key: key, estId: "", name: String(row.name || "Работа"), stage: Number(row.stage) || 0,
      room: "", roomId: "", surface: "", group: "", label: "",
      area: 0, point: "", count: 0, factor: 1, added: true, own: true,
      mats: cost ? [{ pid: "", n: String(row.name || "Работа"), store: "", mode: "piece",
        cost: cost, qty: 1 }] : [],
      cost: cost,
    };
  });
}

// Работа, переставленная в другой этап ЭТОГО дома. Этап — свойство стройки, а не
// справочника: контейнер обычно ставят на подготовительном, но на участок с
// готовым фундаментом его привозят первым же днём. Правило и справочник общие на
// все дома, поэтому перестановка живёт в листе — как и всё остальное про один дом.
//
// По этапам идут сроки, приёмка и транши, поэтому переставленная работа обязана
// уехать в новый этап целиком: и в смете, и в стройке. Обе читают этот список.
// Порядок работ ВНУТРИ этапа. Считается смета сама, порядок в ней — порядок
// расчёта, а не стройки: бригаде важно, что сначала обрешётка, потом обшивка, и
// читать смету, перепрыгивая глазами, — верный способ что-то пропустить.
//
// Между этапами порядок задают сами этапы, и трогать его нельзя: смета читается
// этапами, и перемешать их значит стереть то, по чему идут сроки и приёмка.
export function applyOrder(raw, sheet) {
  const map = (sheet && sheet.posOrder) || {};
  if (!Object.keys(map).length) return raw;
  const rows = (raw.positions || []).map(function (p, i) { return { p: p, i: i }; });
  const byStage = {};
  rows.forEach(function (r) {
    const n = Number(r.p.stage) || 0;
    (byStage[n] = byStage[n] || []).push(r);
  });
  Object.keys(byStage).forEach(function (n) {
    byStage[n].sort(function (a, b) {
      const av = map[a.p.key], bv = map[b.p.key];
      if (av != null && bv != null) return av - bv;
      if (av != null) return -1;          // расставленные руками идут первыми
      if (bv != null) return 1;
      return a.i - b.i;                   // остальные — в порядке расчёта
    });
  });
  // Раскладываем обратно по тем же местам: первая строка этапа остаётся первой
  // строкой этапа, иначе этапы поменялись бы местами на экране.
  const queue = {};
  Object.keys(byStage).forEach(function (n) { queue[n] = byStage[n].slice(); });
  return Object.assign({}, raw, {
    positions: rows.map(function (r) { return queue[Number(r.p.stage) || 0].shift().p; }),
  });
}

// Цена работы, назначенная руками. У неё ДВА смысла, и путать их нельзя:
//
//   «за работу» — столько платят бригаде, и к материалам эта цифра отношения не
//   имеет: разводка кабелем стоит своё, кабель с гофрой — своё, а в смете строка
//   должна нести и то, и другое. Это обычный случай, поэтому он же и умолчание
//   для всякой новой цены.
//
//   «под ключ» — бригаду взяли на подряд, и цена это цифра из договора с ней:
//   «электрика под ключ 25 000» одинаково верна при любом метраже гофры.
//   Материалы при этом остаются (по ним закупаются), но ценой быть перестают.
//
// Отсутствующий режим читаем как «под ключ»: так эта цифра понималась, когда её
// вводили, и менять смысл уже сохранённого числа задним числом нельзя.
export function costModeOf(sheet, key) {
  const m = (((sheet && sheet.posCostMode) || {})[key]) || "";
  return m === "labor" ? "labor" : "all";
}

export function applyCost(raw, sheet) {
  const map = (sheet && sheet.posCost) || {};
  if (!Object.keys(map).length) return raw;
  return Object.assign({}, raw, {
    positions: (raw.positions || []).map(function (p) {
      const v = map[p.key];
      if (v == null) return p;
      const n = Math.max(0, Math.round(Number(v) || 0));
      if (costModeOf(sheet, p.key) === "labor") {
        const mats = (p.mats || []).reduce(function (a, m) { return a + (Number(m.cost) || 0) * (Number(m.qty) || 0); }, 0);
        return Object.assign({}, p, { labor: n, cost: Math.round(mats) + n, costSet: true, costMode: "labor" });
      }
      return Object.assign({}, p, { labor: 0, cost: n, costSet: true, costAll: true, costMode: "all" });
    }),
  });
}

export function applyStage(raw, sheet) {
  const map = (sheet && sheet.posStage) || {};
  if (!Object.keys(map).length) return raw;
  return Object.assign({}, raw, {
    positions: (raw.positions || []).map(function (p) {
      const n = map[p.key];
      return (n == null) ? p : Object.assign({}, p, { stage: Number(n) || 0, stageSet: true });
    }),
  });
}

export function dropOff(raw, sheet) {
  const off = (sheet && sheet.posOff) || {};
  if (!Object.keys(off).length) return Object.assign({ dropped: [] }, raw);
  const kept = [], dropped = [];
  (raw.positions || []).forEach(function (p) { (off[p.key] ? dropped : kept).push(p); });
  return Object.assign({}, raw, { positions: kept, dropped: dropped });
}

// Позиция → работа объекта. ОДНА машинка на сборку объекта и на подпись состава:
// если бы объект собирался одним кодом, а сравнивался другим, «в проекте
// изменилось» загоралось бы на ровном месте — или молчало, когда изменилось.
// Идентификаторы здесь не выдаются: их ставит тот, кто кладёт работу в объект.
export function positionWork(pos) {
  const p = pos || {};
  const mats = (p.mats || []).map(function (m) {
    const mm = { pid: m.pid || "", n: m.n || "", store: m.store || "", url: m.url || "", note: "",
      cost: Number(m.cost) || 0, qty: Number(m.qty) || 0, mode: m.mode || "piece",
      unitCost: Number(m.cost) || 0 };
    ["packBase", "packPer", "lenPer", "sheetM2"].forEach(function (k) { if (m[k] != null) mm[k] = m[k]; });
    return mm;
  });
  return {
    posKey: p.key || "", estId: p.estId || "",
    n: (p.name || "") + (p.room ? " — " + p.room : ""),
    room: "", note: "",
    // Оплата работы и признак «под ключ» уезжают в стройку вместе с ценой: иначе
    // на экране подрядная цена, а в объекте сумма кабелей — и расходятся они
    // молча. По `labor` объект потом и пересчитывает себя (normalizeWorkCosts).
    labor: Number(p.labor) || 0,
    costAll: !!p.costAll,
    cost: p.costSet ? (Number(p.cost) || 0)
      : Math.round(mats.reduce(function (a, m) { return a + m.cost * m.qty; }, 0)),
    mats: mats,
  };
}
