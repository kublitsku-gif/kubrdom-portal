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

import { positionFor, roomArea, roomPoints, pointMeta, sheetPositions } from "./spec.js";
import { modelToSpecs, modelTotals } from "./model.js";

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
        p.factor = mult;
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

// Полный состав дома: то, что выбрано руками в справочнике, плюс то, что дали
// правила. ОДНА функция на экран и на сборку объекта — иначе на экране одна
// смета, а в стройке другая, и находится это на приёмке этапа.
export function allPositions(sheet, ctx) {
  const c = ctx || {};
  const probe = probeSheet(sheet, c.winTypes);
  const base = sheetPositions(probe, c.estimates, c.products).map(function (p) {
    return Object.assign({}, p, { from: "est", why: positionWhy(p) });
  });
  return base.concat(rulePositions(sheet, c.rules, c.estimates, c.products, c.winTypes));
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
    room: "", labor: 0, note: "",
    cost: Math.round(mats.reduce(function (a, m) { return a + m.cost * m.qty; }, 0)),
    mats: mats,
  };
}
