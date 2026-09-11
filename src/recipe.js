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
// Ключ сравнения имён — тот же, по которому каталог отсекает тёзок: «ОСП 9 мм» и
// «осп  9 мм» — одно. Своя копия правила разошлась бы с каталогом на первом же
// неразрывном пробеле.
import { nameKey } from "./catalog.js";

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
// Стены двумя числами: полная (обрешётка и утеплитель идут и за окном) и без
// проёмов (красят и обшивают только стену). Одно число врало бы одному из двух
// расчётов, а какому — зависит от материала.
export const RULE_SURFACES = [["floor", "пол"], ["wall", "стены"], ["ceil", "потолок"],
  ["wallceil", "стены + потолок"], ["wallnet", "стены без проёмов"],
  ["wallnetceil", "стены без проёмов + потолок"]];
export const RULE_SCOPES = [["room", "по каждому помещению"], ["house", "на весь дом"]];

const SURFACE_N = { floor: "пол", wall: "стены", ceil: "потолок", wallceil: "стены и потолок",
  wallnet: "стены без проёмов", wallnetceil: "стены без проёмов и потолок" };

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

// Сколько квадратов даст каждая поверхность при ЭТОМ правиле — числа для кнопок
// выбора и для проверки глазами. Считаем тем же roomArea/roomMatch, которым потом
// соберётся смета: цифра на кнопке обязана совпасть с той, что уедет в дом,
// иначе кнопка обещает одно, а строка приносит другое.
export function ruleAreas(sheet, rule, winTypes) {
  const probe = probeSheet(sheet, winTypes);
  const specs = probe.specs || {};
  const H = Number(specs.height) || 0;
  const all = specs.rooms || [];
  const rooms = all.map(function (rm) {
    return {
      id: rm.id || "", name: rm.name || "",
      floor: roomArea(rm, H, "floor"), wall: roomArea(rm, H, "wall"),
      ceil: roomArea(rm, H, "ceil"), wallceil: roomArea(rm, H, "wallceil"),
      wallnet: roomArea(rm, H, "wallnet"), wallnetceil: roomArea(rm, H, "wallnetceil"),
      match: roomMatch(rule, rm),
    };
  });
  const hit = rooms.filter(function (rm) { return rm.match; });
  const sum = function (k) {
    return Math.round(hit.reduce(function (a, rm) { return a + (Number(rm[k]) || 0); }, 0) * 100) / 100;
  };
  return { rooms: rooms, matched: hit.length,
    floor: sum("floor"), wall: sum("wall"), ceil: sum("ceil"), wallceil: sum("wallceil"),
    wallnet: sum("wallnet"), wallnetceil: sum("wallnetceil") };
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
  ["packBase", "packPer", "lenPer", "sheetM2", "packName"].forEach(function (k) {
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
// Адрес материала внутри строки сметы. У расчётного это его товар (`pid`): по
// нему же лежит замена (`sheet.mats[posKey][oldPid]`), и другого адреса у него
// быть не может. У ДОПИСАННОГО руками — всегда собственный id, даже когда товар
// из базы у него есть.
//
// Иначе дописанный «ОСП 9 мм» получал адрес того же товара, что уже посчитан в
// строке, и две разные позиции жили по одному адресу: ручное количество,
// перестановка, «убрать» и обновление цены доставались обеим сразу, а вернуть
// убранное можно было только вместе. Дописанный материал — отдельная строка
// (его и добавляли ради второй фасовки или лишней коробки), значит и адрес у
// него отдельный.
export function matAddKey(m) { return "+" + String((m && (m.id || m.pid)) || ""); }

// Прежний адрес — по ТОВАРУ (и номеру повтора, если товар в смете назван дважды).
// Так адресованы правки боевых листов, и читать их надо по-прежнему: переписывать
// снимок ради нового формата опаснее, чем прочитать оба адреса.
export function matLegacyKey(m) {
  const base = String((m && (m.pid || m.id)) || "");
  const ix = Number(m && m.mix) || 0;
  return ix > 1 ? base + "#" + ix : base;
}

// Адрес материала внутри строки сметы: у расчётного это id СТРОКИ СПРАВОЧНИКА
// (`l:<lid>`), у дописанного руками — его собственный id (`+<id>`).
//
// Адресом расчётного был его товар, и это ломалось дважды: один товар в смете
// может стоять двумя строками (пол и стены одной работой), а замена меняет товар
// прямо в строке. Id строки не зависит ни от того, ни от другого — и переживает
// перестановку строк в справочнике, чего номер повтора не умел.
export function matKeyOf(m) {
  if (m && m.added) return matAddKey(m);
  if (m && m.lid) return "l:" + m.lid;
  return matLegacyKey(m);
}

// Все адреса материала: нынешний и прежний. Читаем по первому, который что-то
// знает; «вернуть как было» обязано снимать оба, иначе стёртая правка вернулась
// бы прежним адресом.
export function matAddrs(m) {
  const now = matKeyOf(m);
  // У дописанного руками прежний адрес уже перенесён в лист (`migrateMatAddrs`),
  // и читать его ещё и здесь значило бы вернуть ту же коллизию: «убрать» по
  // товару снова уносило бы и расчётную строку, и дописанную.
  if (m && m.added) return [now];
  const was = matLegacyKey(m);
  return (was && was !== now) ? [now, was] : [now];
}
function matVal(map, m) {
  const a = matAddrs(m), src = map || {};
  for (let i = 0; i < a.length; i++) { if (src[a[i]] != null) return src[a[i]]; }
  return null;
}
function matIn(list, m) {
  const a = matAddrs(m), src = list || [];
  for (let i = 0; i < a.length; i++) { if (src.indexOf(a[i]) >= 0) return true; }
  return false;
}

// Смета справочника может назвать один товар ДВАЖДЫ («ОСП на пол» и «ОСП на
// стены» одной работой, две фасовки одного крепежа): это две строки, и правят их
// порознь. Адресом обеих был один товар, поэтому замена меняла товар в обеих,
// ручное количество доставалось обеим, а «убрать» уносило сразу две.
//
// Различаем их НОМЕРОМ ПОВТОРА в смете: первая строка товара сохраняет прежний
// адрес (`p_osb`) — по нему лежат все правки боевых листов, и трогать его нельзя,
// — а каждая следующая получает свой (`p_osb#2`). Номер считается по строкам
// справочника, а не по порядку на экране: перестановка материалов в листе не
// должна переадресовывать чужие правки.
export function matAddrPid(addr) {
  const v = String(addr || "");
  const cut = v.indexOf("#");
  return cut < 0 ? v : v.slice(0, cut);
}
// Адрес того же материала после замены товара: номер повтора переезжает вместе с
// ним («p_osb#2» → «p_ply#2»), иначе ручное количество второй строки досталось бы
// первой.
export function matAddrSwap(addr, pid) {
  const v = String(addr || "");
  const cut = v.indexOf("#");
  return cut < 0 ? String(pid || "") : String(pid || "") + v.slice(cut);
}
export function stampMatIx(positions) {
  return (positions || []).map(function (pos) {
    const mats = (pos && pos.mats) || [];
    if (mats.length < 2) return pos;
    const seen = {};
    let dup = false;
    const out = mats.map(function (m) {
      const pid = String((m && m.pid) || "");
      if (!pid) return m;
      seen[pid] = (seen[pid] || 0) + 1;
      if (seen[pid] < 2) return m;
      dup = true;
      return Object.assign({}, m, { mix: seen[pid] });
    });
    return dup ? Object.assign({}, pos, { mats: out }) : pos;
  });
}

// Адреса дописанных материалов сменились (был `pid`, стал `+id`), а правки по
// старым адресам лежат в боевых листах: убранный материал вернулся бы на экран,
// ручное количество откатилось бы к расчётному, порядок сбросился.
//
// Поэтому старый адрес НЕ переносим, а ДОПИСЫВАЕМ рядом новый: там, где старый
// адрес был общим с расчётным материалом, обе строки останутся такими, какими
// человек их видел до правки, а дальше живут порознь. Прогон идемпотентен —
// новый адрес уже есть, значит мигрировать нечего.
export function migrateMatAddrs(sheet) {
  const adds = (sheet && sheet.matAdd) || {};
  let hit = false;
  Object.keys(adds).forEach(function (posKey) {
    (adds[posKey] || []).forEach(function (row) {
      const was = String((row && (row.pid || row.id)) || "");
      const now = matAddKey(row);
      if (!was || was === now) return;
      const qty = (sheet.matQty || {})[posKey];
      if (qty && qty[was] != null && qty[now] == null) { qty[now] = qty[was]; hit = true; }
      const ord = (sheet.matOrder || {})[posKey];
      if (ord && ord[was] != null && ord[now] == null) { ord[now] = ord[was]; hit = true; }
      const off = (sheet.matOff || {})[posKey];
      if (Array.isArray(off) && off.indexOf(was) >= 0 && off.indexOf(now) < 0) { off.push(now); hit = true; }
    });
  });
  return hit;
}

// ─── ПРАВКИ СТРОКИ ПЕРЕЕЗЖАЮТ ПОД ПРАВИЛО ────────────────────────────────────
// Правило ЗАМЕНЯЕТ обязательную строку сметы, и ключ у неё другой: был
// `base:<смета>`, стал `rule:<правило>:<комната>`. Всё, что человек правил в
// строке этого дома, лежит по ключу — дописанный материал, ручное количество,
// часы, цена, этап, «убрать», — и оставалось под старым ключом, которого на
// экране больше нет. Так на «Доме СВО» пропали дописанная фанера и ручные 12
// упаковок клея, на «Мордвесе» — подвесы, часы и цены.
//
// Переносим, а не читаем по двум ключам: правка, записанная после, легла бы в
// новый ключ, и старая на экране исчезла бы в тот же момент.
//
// Куда ехать, решает комната: правило по каждому помещению даёт несколько строк,
// и правка уходит в строку той комнаты, к которой строку приписали. Строка
// правила одна — туда. Не сказано и строк несколько — гадать нельзя, правка
// остаётся на месте.
//
// Едет только в НЕТРОНУТУЮ строку правила — только что заведённую. Если строку
// под правилом уже правили, человек работает с тем, что видит, и воскрешать
// поверх старые правки нельзя: клей «Стен спальни» вернулся бы с 1 на давние 12.
// «Не в итоге» (`posOff`) и «удалено» (`posDel`) не везём вовсе: они прячут работу
// целиком, и молча спрятать то, что сейчас стоит в смете, — хуже, чем показать лишнее.
// Прогон идемпотентен.
export const POS_EDIT_SECTIONS = ["matAdd", "matQty", "mats", "matOff", "matOrder", "posHours", "posK",
  "posCost", "posCostMode", "posStage", "posRoom", "posOrder", "qty"];
export function carryRuleEdits(sheet, rulePos) {
  if (!sheet) return false;
  const byEst = {}, byRule = {}, live = {};
  (rulePos || []).forEach(function (p) {
    if (!p || !p.key) return;
    live[p.key] = true;
    if (p.estId) (byEst[p.estId] = byEst[p.estId] || []).push(p);
    if (p.ruleId) (byRule[p.ruleId] = byRule[p.ruleId] || []).push(p);
  });
  const room = sheet.posRoom || {};
  // Какие строки правил уже правили — в них не везём ничего.
  const touched = {};
  POS_EDIT_SECTIONS.concat(["posOff", "posDel"]).forEach(function (sec) {
    const map = sheet[sec];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      Object.keys(map).forEach(function (k) { if (live[k]) touched[k] = true; });
    }
  });
  // Адрес считается ДО переноса: комната приписки — тоже раздел, и она уедет
  // вместе с остальными.
  const plan = {};
  POS_EDIT_SECTIONS.forEach(function (sec) {
    const map = sheet[sec];
    if (!map || typeof map !== "object" || Array.isArray(map)) return;
    Object.keys(map).forEach(function (k) {
      if (k in plan || live[k]) return;
      let list = null;
      if (k.indexOf("base:") === 0) list = byEst[k.slice(5)];
      else if (k.indexOf("rule:") === 0) list = byRule[k.split(":")[1]];
      if (!list || !list.length) { plan[k] = ""; return; }
      const hit = room[k] ? list.filter(function (p) { return p.roomId === room[k]; }) : [];
      const to = hit.length === 1 ? hit[0].key : (list.length === 1 ? list[0].key : "");
      plan[k] = (to && !touched[to]) ? to : "";
    });
  });
  let moved = false;
  POS_EDIT_SECTIONS.forEach(function (sec) {
    const map = sheet[sec];
    if (!map || typeof map !== "object" || Array.isArray(map)) return;
    let next = null;
    Object.keys(map).forEach(function (k) {
      const to = plan[k];
      if (!to || map[to] != null || (next && next[to] != null)) return;
      next = next || Object.assign({}, map);
      next[to] = map[k];
      delete next[k];
    });
    if (next) { sheet[sec] = next; moved = true; }
  });
  return moved;
}

// ─── ОБЪЁМ ПО НАЗВАНИЮ РАБОТЫ ────────────────────────────────────────────────
// Строка без объёма («Монтаж стен из ОСП», «Стены зал») встаёт «на весь дом»
// числом из справочника, хотя по названию видно, чем она меряется. Портал
// ПРЕДЛАГАЕТ поверхность и, если названо, помещение, — ставит человек.
// «Стены и пол» одной поверхностью портал не меряет, выдумывать её нельзя.
export function guessVolume(name, roomNames) {
  const s = String(name || "").toLowerCase().replace(/ё/g, "е");
  const wall = /стен/.test(s);
  const ceil = /потол/.test(s);
  // «пол» — отдельным словом: полотенцесушитель и полиэтилен — не пол.
  const floor = /(^|[^а-я])пол(а|у|ом|е|ы|ов)?([^а-я]|$)/.test(s);
  if (wall && floor) return null;
  const k = wall ? (ceil ? "wallceil" : "wall") : (ceil ? "ceil" : (floor ? "floor" : ""));
  if (!k) return null;
  return { k: k, room: roomInName(s, roomNames) };
}
// Помещение, названное в имени работы: «Стены зал», «Потолок спальни», «Пол сан
// узел». Слово целиком — иначе «заливка» нашла бы «зал»; у длинных имён сверяем
// основу (спальн-я/-и, сануз-ел/-ла), и соседние слова склеиваем («сан узел»).
function roomInName(s, roomNames) {
  const words = s.split(/[^а-яa-z0-9]+/).filter(Boolean);
  const cand = words.concat(words.slice(1).map(function (w, i) { return words[i] + w; }));
  const names = (roomNames || []).filter(function (r) { return String(r || "").trim(); });
  for (let i = 0; i < names.length; i++) {
    const rn = String(names[i]).toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
    if (!rn) continue;
    const stem = rn.length >= 5 ? rn.slice(0, -2) : "";
    const hit = cand.some(function (w) {
      return w === rn || (stem && w.indexOf(stem) === 0 && w.length <= rn.length + 2);
    });
    if (hit) return String(names[i]);
  }
  return "";
}

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

// Порядок материалов внутри строки (`sheet.matOrder[posKey][адрес] = номер`).
// Список читают сверху вниз и по нему закупают: сначала лист, потом крепёж. В
// справочнике порядок общий на все дома, поэтому перестановка живёт на листе —
// как замена, ручное количество и всё остальное про один дом.
export function matOrderOf(sheet, key) {
  return (((sheet && sheet.matOrder) || {})[key]) || {};
}
function sortMats(mats, order) {
  if (!Object.keys(order || {}).length) return mats;
  return mats.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
    const av = matVal(order, a.m), bv = matVal(order, b.m);
    if (av != null && bv != null) return av - bv;
    if (av != null) return -1;          // расставленные руками идут первыми
    if (bv != null) return 1;
    return a.i - b.i;                   // остальные — в порядке сметы
  }).map(function (r) { return r.m; });
}

export function applyMatEdits(positions, sheet, products) {
  const swaps = (sheet && sheet.mats) || {};
  const qtys = (sheet && sheet.matQty) || {};
  const adds = (sheet && sheet.matAdd) || {};
  const offs = (sheet && sheet.matOff) || {};
  const ords = (sheet && sheet.matOrder) || {};
  if (!Object.keys(swaps).length && !Object.keys(qtys).length && !Object.keys(adds).length
    && !Object.keys(offs).length && !Object.keys(ords).length) return positions;
  const prodById = {};
  (products || []).forEach(function (p) { if (p && p.id) prodById[p.id] = p; });
  return (positions || []).map(function (pos) {
    const sw = swaps[pos.key] || {};
    const q = qtys[pos.key] || {};
    const add = adds[pos.key] || [];
    const off = matOffOf(sheet, pos.key);
    const ord = matOrderOf(sheet, pos.key);
    if (!Object.keys(sw).length && !Object.keys(q).length && !add.length && !off.length
      && !Object.keys(ord).length) return pos;
    // Убранный материал и ручной порядок — тоже правка: без них строка
    // возвращалась бы как есть.
    let hit = !!add.length || !!off.length || !!Object.keys(ord).length;
    const mats = (pos.mats || []).map(function (m) {
      let out = m;
      const nid = matVal(sw, m);
      const prod = nid && prodById[nid];
      if (prod) { out = swapMat(m, prod, pos.area); hit = true; }
      // Ручное количество ставится ПОСЛЕ замены: человек правит то число, которое
      // видит на экране, а видит он уже новый товар.
      const own = Number(matVal(q, out));
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
      const own = Number(q[matAddKey(a)]);
      const row = Object.assign({}, a, { added: true });
      return (isFinite(own) && own > 0)
        ? Object.assign(row, { qty: own, qtySet: true })
        : row;
    }));
    // Убранный материал вычитается ПОСЛЕДНИМ — после замены: человек убирает то,
    // что видит на экране, а видит он уже новый товар.
    const kept = sortMats(
      off.length ? full.filter(function (m) { return !matIn(off, m); }) : full, ord);
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
  // Комнаты дома нужны для ПОДПИСИ приписанной руками работы: сама приписка
  // хранит только адрес комнаты, а имя живёт в модели — второй его копии в
  // листе быть не должно, она разошлась бы с чертежом.
  const rooms = ((probeSheet(sheet, c.winTypes).specs || {}).rooms) || [];
  // Номер повтора проставляется ДО правок: по нему они и адресуются, а считается
  // он по составу справочника, поэтому не зависит ни от замен, ни от перестановки.
  const numbered = stampMatIx(all);
  // Порядок важен: сначала свои часы, потом норма (она их уважает и считает по ним
  // деньги), и только потом своя цена — она главнее любого расчёта.
  const priced = applyCost(applyNorm(applyHours(applyPicks(applyMatEdits(numbered, sheet, c.products), sheet), sheet), sheet, c), sheet);
  // Выключенные отделяем в САМОМ КОНЦЕ: к этому моменту у них есть цена по норме,
  // этап, комната и место в порядке — экран рисует их серыми там же, где они
  // стояли, и честно показывает, сколько вернётся в смету при включении.
  return dropOff(applyRooms(applyOrder(applyStage(priced, sheet), sheet), sheet, rooms, c.stages), sheet);
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
      // У материала ОБЯЗАН быть свой адрес (`matKeyOf`): без него
      // ручное количество, замена, порядок и «убрать» уходили в пустой ключ, и
      // кнопки в такой строке молча ничего не делали.
      // Флаг `own` на самом материале: по нему и экран, и разбивка «материалы /
      // работа» узнают, что эта строка — цена работы, а не купленный товар.
      mats: cost ? [{ id: "own:" + (row.id || ""), pid: "", own: true, n: String(row.name || "Работа"),
        store: "", mode: "piece", cost: cost, qty: 1 }] : [],
      cost: cost,
    };
  });
}

// ─── ВЗЯТЬ РАБОТЫ ИЗ ДРУГОГО ПРОЕКТА ─────────────────────────────────────────
// Дом собирают не с нуля: в «Мордвес 1» уже подобраны тридцать позиций труб и
// фитингов к водоснабжению, назначена цена бригаде и план часов. Вписывать это в
// новый дом второй раз — час работы и гарантированная опечатка в количестве.
//
// Берём строку ГОТОВОЙ — такой, какой её отдаёт works2() источника: правки листа
// уже применены, количества итоговые (у дописанных материалов настоящее число
// лежит не в самой строке, а в `matQty`, и сырой лист отдал бы по штуке каждого).
// Перенос правок по одной — тринадцать карт листа с перепривязкой ключей и
// номеров повтора — был бы вторым расчётом сметы, который однажды разошёлся бы
// с первым.
//
// Взятая строка становится СВОЕЙ работой нового дома (`posAdd`), её материалы —
// дописанными (`matAdd`): ровно так «Водоснабжение» живёт в самом Мордвесе, и
// дальше строку считает, правит и закупает тот же код, что и всё остальное.
// Ссылки на справочник у копии нет намеренно: строка справочника в новом доме
// пересчиталась бы по ЕГО чертежу и потеряла бы то, ради чего её брали.

// Что из материала переносим. Остальное — метки ИСТОЧНИКА: `lid`/`mix` адресуют
// строку его справочника, `added`/`qtySet` ставит applyMatEdits при счёте, а
// `client` («платит заказчик») — решение по договору ТОГО дома, не этого.
const IMPORT_MAT_FIELDS = ["pid", "n", "store", "url", "note", "mode", "cost", "qty", "unitCost",
  "packBase", "packPer", "lenPer", "sheetM2", "packName"];

// Почему строка уже есть в доме — или пусто, если её нет. Помеченную не отмечаем
// заранее, но и не запрещаем: вторая «Разводка электрики» бывает нужна (второй
// санузел), а вот случайно задвоить обшивку — ошибка в деньгах.
function importExists(sp, targetPositions, target, srcId) {
  const here = targetPositions || [];
  if (sp.estId && here.some(function (p) { return p && p.estId === sp.estId; })) {
    return "эта работа справочника в доме уже есть";
  }
  const k = nameKey(sp.name);
  if (k && here.some(function (p) { return p && nameKey(p.name) === k; })) {
    return "работа с таким именем в доме уже есть";
  }
  const taken = ((target && target.posAdd) || []).some(function (r) {
    return r && r.from && r.from.p === srcId && r.from.k === sp.key;
  });
  return taken ? "уже взята из этого проекта" : "";
}

// Перечень строк источника для выбора: что это, сколько стоит, есть ли уже.
// Сама строка источника едет рядом (`src`), чтобы перенос не считал её заново.
export function importRows(srcPositions, targetPositions, target, srcId) {
  return (srcPositions || []).map(function (sp) {
    const why = importExists(sp, targetPositions, target, srcId);
    return {
      key: sp.key, name: String(sp.name || ""), stage: Number(sp.stage) || 0,
      room: String(sp.room || ""), cost: Math.round(Number(sp.cost) || 0),
      matCount: (sp.mats || []).filter(function (m) { return m && !m.own; }).length,
      exists: !!why, why: why, src: sp,
    };
  });
}

// Одна материальная позиция источника → дописанный материал нового дома.
// Id СВОЙ: общий id «протёк» бы отметками закупки между объектами — купили трубу
// в Мордвес, а галка встала и в новом доме.
function importMat(m, gid) {
  const out = { id: gid() };
  IMPORT_MAT_FIELDS.forEach(function (f) { if (m[f] != null && m[f] !== "") out[f] = m[f]; });
  return out;
}

// Правка листа для отмеченных строк. Лист НЕ трогаем — возвращаем новые карты
// поверх его прежних: запишет их обработчик, после снимка для «отменить», а до
// нажатия «взять» дом остаётся ровно таким, каким был.
//
// opts.gid — выдача id (у панели своя, у тестов своя); opts.rooms — помещения
// нового дома: комната едет ПО ИМЕНИ, потому что id у неё свой в каждом чертеже,
// а «Санузел» — это санузел в любом доме. Нет такой комнаты — строка общая.
export function importPatch(target, rows, picked, srcId, opts) {
  const o = opts || {};
  if (typeof o.gid !== "function") throw new Error("importPatch: нужна выдача id (opts.gid)");
  const roomBy = {};
  (o.rooms || []).forEach(function (r) {
    const k = nameKey(r && r.name);
    if (k && r.id && !roomBy[k]) roomBy[k] = r.id;
  });
  const t = target || {};
  const posAdd = (t.posAdd || []).slice();
  const matAdd = Object.assign({}, t.matAdd || {});
  const posHours = Object.assign({}, t.posHours || {});
  const posRoom = Object.assign({}, t.posRoom || {});
  (rows || []).forEach(function (row) {
    if (!row || !(picked || {})[row.key]) return;
    const sp = row.src || {};
    const id = o.gid();
    const key = "add:" + id;
    const split = positionSplit(sp);
    // Цена бригаде — та, что стояла в источнике. «Под ключ» переносится договорной
    // цифрой целиком и БЕЗ материалов: они уже внутри неё, и отдельной строкой
    // закупки они посчитались бы дважды.
    const add = {
      id: id, name: row.name, stage: row.stage,
      cost: Math.round(split.all ? (Number(sp.cost) || 0) : split.labor),
      from: { p: String(srcId || ""), k: row.key },
    };
    if (sp.estId) add.srcEstId = sp.estId;
    posAdd.push(add);
    if (!split.all) {
      const mats = (sp.mats || []).filter(function (m) { return m && !m.own; })
        .map(function (m) { return importMat(m, o.gid); });
      if (mats.length) matAdd[key] = mats;
    }
    const h = Number(sp.hours) || 0;
    if (h > 0) posHours[key] = h;
    const rid = roomBy[nameKey(row.room)];
    if (rid) posRoom[key] = rid;
  });
  const out = { posAdd: posAdd };
  if (Object.keys(matAdd).length) out.matAdd = matAdd;
  if (Object.keys(posHours).length) out.posHours = posHours;
  if (Object.keys(posRoom).length) out.posRoom = posRoom;
  return out;
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

// ─── БЛОКИ ПО ПОМЕЩЕНИЯМ ─────────────────────────────────────────────────────
// Внутри этапа работы идут БЛОКАМИ ПО ПОМЕЩЕНИЯМ: «Санузел — стены, пол,
// потолок», следом «Зал». Правило по помещениям даёт строку на каждую комнату, и
// без блоков этап выглядит как «стены санузел, стены зал, стены спальня, пол
// санузел, пол зал…» — то есть перечислением поверхностей, а не комнат. Бригада
// же работает комнатой: в санузел заходят один раз и делают там всё.
//
// Это ПОРЯДОК, а не новая сущность: тот же список уходит и на экран, и в объект,
// поэтому группировка живёт здесь, а не в панели. Своя группировка на экране
// означала бы, что на «Составе» дом читается комнатами, а на стройке — россыпью.
export function roomKeyOf(p) {
  const id = String((p && p.roomId) || "");
  if (id) return id;
  const n = String((p && p.room) || "").trim();
  return n ? "n:" + n : "";
}

// Работу можно приписать к комнате РУКАМИ (`sheet.posRoom[posKey]`). Расчёт знает
// комнату только там, где считал по ней (правило по помещениям); обязательная
// строка справочника посчитана на весь дом, а делают её всё равно в санузле — и
// бригаде нужен список по комнатам, а не «общее по дому» на восемнадцать работ.
//
// «Общее по дому» — тоже осознанный выбор, поэтому у него свой ключ: пустая
// строка означала бы «человек ничего не решал», и такую работу расчёт утащил бы
// обратно в свою комнату.
export const ROOM_HOUSE = "-";
export function posRoomOf(sheet, key) {
  return String((((sheet && sheet.posRoom) || {})[key]) || "");
}

// Порядок блоков — по ПЕРВОМУ появлению: он и так осмысленный (в каком порядке
// правила прошли по дому), и его же двигает ручная перестановка строк. Отдельный
// список комнат пришлось бы вести руками, и он разошёлся бы с чертежом.
// Кучками по комнатам раскладываем ТОЛЬКО этапы, которые так и показаны — блоками
// по помещениям (чистовой, `finish`). Подготовку и черновые работы экран рисует
// одним списком, и там кучки были невидимой силой: человек ставил «Монтаж
// подвесов · Санузел» выше «Разводки электрики», а applyRooms после его порядка
// снова собирал этап по комнатам — строка возвращалась ниже всех работ «на весь
// дом». В этапе без блоков порядок — человека.
// Без сведений об этапах (прямые вызовы, старые проверки) — комнатами везде, как
// раньше: экран и сборка объекта этапы передают всегда (specCtx), и разойтись
// порядком им не на чем.
export function applyRooms(raw, sheet, rooms, stages) {
  const named = {};
  (rooms || []).forEach(function (r) { if (r && r.id) named[r.id] = String(r.name || ""); });
  // Ручная приписка меняет ТОЛЬКО комнату: количество и `why` остаются как
  // посчитано — «на весь дом» и есть правда о том, откуда взялось число.
  const moved = (raw.positions || []).map(function (p) {
    const ov = posRoomOf(sheet, p.key);
    if (!ov) return p;
    if (ov === ROOM_HOUSE) return Object.assign({}, p, { room: "", roomId: "", roomSet: true });
    return Object.assign({}, p, { room: named[ov] || p.room || "", roomId: ov, roomSet: true });
  });
  const rows = moved.map(function (p, i) { return { p: p, i: i }; });
  const byStage = {};
  rows.forEach(function (r) {
    const n = Number(r.p.stage) || 0;
    (byStage[n] = byStage[n] || []).push(r);
  });
  const known = Array.isArray(stages);
  const finish = {};
  (stages || []).forEach(function (s) { if (s && s.finish) finish[Number(s.n)] = true; });
  const queue = {};
  Object.keys(byStage).forEach(function (n) {
    if (known && !finish[Number(n)]) { queue[n] = byStage[n].slice(); return; }
    const seen = {}, ord = [];
    byStage[n].forEach(function (r) {
      const k = roomKeyOf(r.p);
      if (!seen[k]) { seen[k] = []; ord.push(k); }
      seen[k].push(r);
    });
    const out = [];
    ord.forEach(function (k) { seen[k].forEach(function (r) { out.push(r); }); });
    queue[n] = out;
  });
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

// ── НОРМА-ЧАС ───────────────────────────────────────────────────────────────
// Цену работы вбивали руками в каждой строке каждого дома. Норма-час убирает эту
// работу: у работы в справочнике записано, сколько времени она занимает на
// ЕДИНИЦУ своего объёма, у портала — по чём этот час, а объём у строки уже есть
// (тот же, которым считаются материалы). Дальше: часы = норма × объём × коэффициент,
// деньги = часы × ставка.
//
// Три величины лежат там, где каждая ОБЩАЯ:
//   `est.hourNorm` — норма и `est.hourK` — коэффициент сложности: свойство самой
//   работы, одинаковое на всех домах (высотные работы тяжелее везде);
//   `sheet.posK[key]` — коэффициент ЭТОГО дома: конкретно здесь работа сложнее;
//   `sheet.hourRate` / `ctx.hourRate` — ставка объекта и портала.
//
// Руками вписанное главнее расчёта — как и везде в портале: свои часы (`posHours`)
// перебивают норму, своя цена (`posCost`) перебивает и её, и ставку. У СВОЕЙ
// работы нормы нет вовсе: её часы — вписанные руками, дальше тот же коэффициент и
// та же ставка (`normOwn`).
//
// Единица объёма — та же, которой меряется строка: площадь, если считали по
// площади, число точек, если по точкам, и сама строка, если она «один раз на дом».
export function normUnitsOf(pos) {
  const p = pos || {};
  const mult = Number(p.mult) > 0 ? Number(p.mult) : 1;
  if (Number(p.area) > 0) return Number(p.area) * mult;
  if (Number(p.count) > 0) return Number(p.count) * mult;
  return mult;
}
export function hourKOf(sheet, est, key) {
  const own = ((sheet && sheet.posK) || {})[key];
  if (own != null && Number(own) > 0) return Number(own);
  const k = est && est.hourK;
  return (k != null && Number(k) > 0) ? Number(k) : 1;
}
export function hourRateOf(sheet, ctx) {
  const own = Number(sheet && sheet.hourRate);
  if (own > 0) return own;
  return Number((ctx || {}).hourRate) || 0;
}
// Своя работа: нормы в справочнике у неё нет, часы вписывают в строке руками, а
// коэффициент и ставка — те же, что у всех: работа = часы × коэффициент × ставка.
// Деньги кладём в её «материал» (см. `addedPositions`), а не в `labor`: стройка
// складывает `labor` с материалами (workTotal), и цена посчиталась бы дважды.
// Сумма, вписанная в строку до нормы-часа, остаётся работой, пока нет часов или
// ставки: терять её молча нельзя — это договорённость с бригадой.
function normOwn(p, sheet, rate) {
  if (!(p.hoursSet && Number(p.hours) > 0)) return p;
  const k = hourKOf(sheet, null, p.key);
  const typed = Number(p.hours);
  const hours = Math.round(typed * k * 10) / 10;
  const next = Object.assign({}, p, { hours: hours, hourK: k, hourRate: rate, ownHours: typed });
  if (!(rate > 0)) return next;
  const labor = Math.round(hours * rate);
  const had = (p.mats || []).some(function (m) { return m && m.own; });
  const mats = had
    ? p.mats.map(function (m) { return m && m.own ? Object.assign({}, m, { cost: labor, qty: 1 }) : m; })
    : [{ id: "own:" + String(p.key || "").slice(4), pid: "", own: true, n: String(p.name || "Работа"),
      store: "", mode: "piece", cost: labor, qty: 1 }].concat(p.mats || []);
  const cost = mats.reduce(function (a, m) { return a + (Number(m && m.cost) || 0) * (Number(m && m.qty) || 0); }, 0);
  return Object.assign(next, { mats: mats, cost: Math.round(cost), laborCalc: true });
}
export function applyNorm(raw, sheet, ctx) {
  const rate = hourRateOf(sheet, ctx);
  const byId = {};
  ((ctx || {}).estimates || []).forEach(function (e) { if (e && e.id) byId[e.id] = e; });
  return Object.assign({}, raw, {
    positions: (raw.positions || []).map(function (p) {
      if (p.own) return normOwn(p, sheet, rate);
      const est = byId[p.estId];
      const k = hourKOf(sheet, est, p.key);
      const norm = Number(est && est.hourNorm) || 0;
      const units = normUnitsOf(p);
      // Часы: свои, если вписаны руками, иначе норма × объём × коэффициент.
      const hours = p.hoursSet ? (Number(p.hours) || 0)
        : (norm > 0 ? Math.round(norm * units * k * 10) / 10 : 0);
      if (!(hours > 0)) return p;
      const next = Object.assign({}, p, { hours: hours, hourK: k, hourRate: rate });
      if (!p.hoursSet) { next.norm = norm; next.normUnits = Math.round(units * 100) / 100; next.hoursNorm = true; }
      if (!(rate > 0)) return next;
      // Деньги за работу считаются по часам — но не у строки, у которой цена уже
      // назначена руками: applyCost идёт следом и перебьёт, а до тех пор в смете
      // не должно мелькать чужое число.
      const labor = Math.round(hours * rate);
      const mats = (p.mats || []).reduce(function (a, m) { return a + (Number(m.cost) || 0) * (Number(m.qty) || 0); }, 0);
      return Object.assign(next, { labor: labor, cost: Math.round(mats) + labor, laborCalc: true });
    }),
  });
}

// План работ в человеко-часах. Деньги бригаде видно, а времени — нет: по этим
// часам считают сроки и загрузку людей. План ставит хозяин и живёт он в ЛИСТЕ
// дома, а не в справочнике смет: справочник общий на все объекты, и часы одного
// дома не должны становиться часами всех.
export function applyHours(raw, sheet) {
  const map = (sheet && sheet.posHours) || {};
  if (!Object.keys(map).length) return raw;
  return Object.assign({}, raw, {
    positions: (raw.positions || []).map(function (p) {
      const v = map[p.key];
      if (v == null) return p;
      const n = Number(v);
      if (!isFinite(n) || n <= 0) return p;
      return Object.assign({}, p, { hours: n, hoursSet: true });
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

// `positions` — только то, что считается (деньги, договор, стройка); `shown` —
// все строки в прежнем порядке, выключенные с пометкой `off`: по нему экран
// рисует галочку снятой, не убирая строку с её места.
//
// `deleted` — удалённые ✕ (`posDel`): их нет ни в деньгах, ни на экране, только в
// перечне «удалено», откуда их возвращают. Галочку прикидывают, удаление решают —
// поэтому удаление главнее: строка с обеими отметками числится удалённой.
export function dropOff(raw, sheet) {
  const off = (sheet && sheet.posOff) || {};
  const del = (sheet && sheet.posDel) || {};
  const all = raw.positions || [];
  if (!Object.keys(off).length && !Object.keys(del).length) {
    return Object.assign({ dropped: [], deleted: [] }, raw, { shown: all });
  }
  const kept = [], dropped = [], shown = [], deleted = [];
  all.forEach(function (p) {
    if (del[p.key]) { deleted.push(Object.assign({}, p, { deleted: true })); return; }
    if (!off[p.key]) { kept.push(p); shown.push(p); return; }
    const o = Object.assign({}, p, { off: true });
    dropped.push(o); shown.push(o);
  });
  return Object.assign({}, raw, { positions: kept, dropped: dropped, shown: shown, deleted: deleted });
}

// Позиция → работа объекта. ОДНА машинка на сборку объекта и на подпись состава:
// если бы объект собирался одним кодом, а сравнивался другим, «в проекте
// изменилось» загоралось бы на ровном месте — или молчало, когда изменилось.
// Идентификаторы здесь не выдаются: их ставит тот, кто кладёт работу в объект.
// Две цифры строки: сколько в ней МАТЕРИАЛОВ и сколько РАБОТЫ. Считается здесь, а
// не на экране: те же числа идут в подытог этапа, и вторая копия формулы разошлась
// бы с первой на первой правке.
//
//   своя работа  — вся цена это работа: материалов у неё нет, а её «материал» это
//                  она сама (см. `addedPositions`);
//   «под ключ»   — цифра из договора с бригадой, и делить её нельзя: материалы в
//                  неё уже включены, поэтому вся сумма считается работой;
//   обычная      — оплата работы лежит в `labor`, остальное и есть материалы.
export function positionSplit(pos) {
  const p = pos || {};
  const cost = Math.round(Number(p.cost) || 0);
  // У своей работы её цена лежит помеченным материалом, а дописанные к ней
  // товары — обычные: делим по флагу, иначе купленный уголок считался бы работой.
  if (p.own) {
    const labor = Math.round((p.mats || []).reduce(function (a, m) {
      return a + (m && m.own ? (Number(m.cost) || 0) * (Number(m.qty) || 0) : 0);
    }, 0));
    return { mats: Math.max(0, cost - labor), labor: labor, all: false };
  }
  if (p.costAll) return { mats: 0, labor: cost, all: true };
  const labor = Math.max(0, Math.round(Number(p.labor) || 0));
  return { mats: Math.max(0, cost - labor), labor: labor, all: false };
}

export function positionWork(pos) {
  const p = pos || {};
  const mats = (p.mats || []).map(function (m) {
    const mm = { pid: m.pid || "", n: m.n || "", store: m.store || "", url: m.url || "", note: "",
      cost: Number(m.cost) || 0, qty: Number(m.qty) || 0, mode: m.mode || "piece",
      unitCost: Number(m.cost) || 0 };
    ["packBase", "packPer", "lenPer", "sheetM2", "packName"].forEach(function (k) { if (m[k] != null) mm[k] = m[k]; });
    // `own` едет в стройку вместе с материалом: у СВОЕЙ работы «материал» — это она
    // сама, её цена. Флаг терялся здесь, и в снабжение работа приезжала обычной
    // покупкой — «Сборку стеллажей» предлагали купить в магазине. Снабжение
    // отличает труд от товара только по нему.
    if (m.own) mm.own = true;
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
    // План часов уезжает в стройку вместе с работой: мастер должен видеть, во
    // сколько времени её заложили, а расхождение с фактом (timeLogs) считается
    // по этой же паре. Это снимок на момент сборки объекта — стройка идёт по
    // плану, который продали, а не по тому, что правят в смете задним числом.
    planHours: Number(p.hours) || 0,
    costAll: !!p.costAll,
    cost: p.costSet ? (Number(p.cost) || 0)
      : Math.round(mats.reduce(function (a, m) { return a + m.cost * m.qty; }, 0)),
    mats: mats,
  };
}
