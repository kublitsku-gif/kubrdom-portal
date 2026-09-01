// ─── ВЕРСИЯ ПРОЕКТА ВМЕСТО КОПИИ ─────────────────────────────────────────────
// Объект — копия проекта на момент создания, и отличаться он ОБЯЗАН: на стройке
// появляются часы, фото, докупка снабженца. Поэтому прямой дифф «объект против
// проекта» бессмыслен, нужен третий участник — слепок состава на момент, когда
// человек в последний раз сказал «принято». Дальше это обычное трёхстороннее
// сравнение, как при слиянии снимков: правил только проект → можно принять;
// правили с двух сторон → решает человек.
//
// Это тот же механизм, что у ревизий шаблона, но между ПРОЕКТОМ и стройкой.
// Разница одна и важная: состав проекта нигде не хранится — он считается по
// чертежу и правилам. Значит «версия проекта» это и есть подпись его состава:
// подвинули перегородку — площади поехали, подписи изменились, и стройка об этом
// узнала. Отдельный номер версии пришлось бы двигать руками, и он разошёлся бы
// с содержимым в первый же день.
//
// Храним не содержимое, а короткие подписи: полный слепок сорока работ весил бы
// десятки килобайт в КАЖДОМ объекте, а раздел `objects` и так ближе всех к
// лимиту строки D1.

import { positionWork } from "./recipe.js";

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(16);
}

// Подпись работы: то, что имеет смысл переносить из проекта, — состав и цены.
// Часы, фото и отметки «выполнено» в неё не входят: они про стройку, а не про план.
export function sigOf(w) {
  const mats = ((w && w.mats) || []).map(function (m) {
    return [m.pid || "", String(m.n || "").trim(), m.mode || "piece", Number(m.cost) || 0, Number(m.qty) || 0].join("~");
  }).sort();
  return fnv([(w && w.n) || "", Math.round(Number(w && w.cost) || 0), mats.join("|")].join("::"));
}

// Ключ сопоставления между копиями — адрес позиции (`key`): id работы рождается
// при сборке объекта, а один и тот же `estId` может стоять у десятка строк —
// правило даёт по строке на каждое помещение.
export function workKeyOf(w) { return (w && w.posKey) || ""; }

export function projSigMap(positions) {
  const out = {};
  (positions || []).forEach(function (p) {
    const w = positionWork(p);
    if (w.posKey) out[w.posKey] = sigOf(w);
  });
  return out;
}

// Слепок проекта для объекта: пишем при создании объекта и после принятия правок.
export function projBaseline(positions, at) {
  return { at: at || "", sig: projSigMap(positions) };
}

export function objWorkMap(obj) {
  const out = {};
  (((obj && obj.stages) || [])).forEach(function (s) {
    (s.works || []).forEach(function (w) {
      const k = workKeyOf(w);
      if (k) out[k] = { w: w, s: s };
    });
  });
  return out;
}

// Есть ли у работы следы стройки. Такую работу нельзя убрать молча, даже если
// в проекте её больше нет: удалить её значит стереть бригаде день работы.
export function workTouched(w) {
  if (!w) return false;
  return !!(w.doneAt || w.done || (w.timeLogs && w.timeLogs.length) || (w.photos && w.photos.length));
}

// Что изменилось в ПРОЕКТЕ с тех пор, как из него собрали этот объект.
//   added   — позиция появилась в проекте (в объекте её нет)
//   removed — позиция из проекта исчезла (в объекте осталась)
//   changed — состав или цена позиции изменились
// safe=true — объект свою копию не трогал: такую правку можно принять молча.
export function projDiff(positions, obj) {
  const base = obj && obj.projBase && obj.projBase.sig;
  if (!base) return { noBase: true, items: [], safe: 0, total: 0 };
  const now = {};
  const nowWork = {};
  (positions || []).forEach(function (p) {
    const w = positionWork(p);
    if (!w.posKey) return;
    now[w.posKey] = sigOf(w);
    nowWork[w.posKey] = { w: w, stage: Number(p.stage) || 0 };
  });
  const inObj = objWorkMap(obj);
  const items = [];

  Object.keys(now).forEach(function (k) {
    const o = inObj[k];
    if (base[k] === undefined) {
      // Появилось в проекте. Если работа уже есть в объекте — её кто-то завёл
      // руками, и подменять её проектом молча нельзя.
      if (!o) items.push({ kind: "added", key: k, proj: nowWork[k], safe: true });
      return;
    }
    if (now[k] === base[k]) return;      // проект эту позицию не менял
    if (!o) return;                      // работу удалили из объекта — не воскрешаем
    items.push({ kind: "changed", key: k, proj: nowWork[k], obj: o, safe: sigOf(o.w) === base[k] });
  });

  Object.keys(base).forEach(function (k) {
    if (now[k] !== undefined) return;
    const o = inObj[k];
    if (!o) return;
    items.push({ kind: "removed", key: k, obj: o, safe: sigOf(o.w) === base[k] && !workTouched(o.w) });
  });

  return { items: items, safe: items.filter(function (x) { return x.safe; }).length, total: items.length };
}
