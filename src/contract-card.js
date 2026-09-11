// ─── КАРТОЧКА ДОГОВОРА ────────────────────────────────────────────────────────
// Договор без объекта не видят ни стройка, ни закупки, ни финансы объекта, а
// привязать его было некуда нажать: объект заводили в другой вкладке и выбирали
// из плоского списка, где занятые стояли вперемешку со свободными. Здесь — логика
// новой карточки без экрана: шаги договора, порядок объектов в выборе, защита от
// второго основного договора, имя и шаблон объекта из договора, прогресс стройки.
import { stageFact, objWorstStage } from "./stages.js";

const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

// «2026-08-21» → «21 авг 2026». ISO читают программы, люди читают месяц словом.
export function dateRu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1];
}

// ── Шаги договора ────────────────────────────────────────────────────────────
// Хранится три статуса (черновик, подписан, закрыт). «В работе» не хранится: шаг
// ставится сам, когда объект привязан и на нём появился первый след работы, —
// отдельное поле разошлось бы со стройкой при первой же отметке часов.
export const CT_STEPS = [
  { k: "draft", label: "Черновик" },
  { k: "signed", label: "Подписан" },
  { k: "work", label: "В работе" },
  { k: "closed", label: "Закрыт" },
];

function objStarted(obj) {
  return ((obj && obj.stages) || []).some(function (s) {
    const f = stageFact(s);
    return !!f.start || f.done > 0;
  });
}

export function ctStep(c, obj) {
  const st = c && c.status;
  if (st === "closed") return "closed";
  if (st === "signed") return obj && objStarted(obj) ? "work" : "signed";
  return "draft";
}

// Чего не хватает для следующего шага — списком, чтобы было ясно, что делать, а
// не только где договор стоит.
export function ctMissing(c, obj) {
  const d = c || {};
  const step = ctStep(d, obj);
  const out = [];
  const hasResp = (d.responsible || []).length > 0;
  if (step === "draft") {
    if (!obj) out.push({ k: "obj", t: "объект" });
    if (!(Number(d.amount) > 0)) out.push({ k: "amount", t: "сумма" });
    if (!d.signDate) out.push({ k: "signDate", t: "дата подписания" });
    if (!hasResp) out.push({ k: "resp", t: "ответственные" });
    return { next: "Подписан", missing: out };
  }
  if (step === "signed") {
    if (!obj) out.push({ k: "obj", t: "объект" });
    if (!hasResp) out.push({ k: "resp", t: "ответственные" });
    if (obj && !(obj.stages || []).some(function (s) { return !!(s && s.planEnd); })) out.push({ k: "plan", t: "сроки этапов" });
    if (obj && !objStarted(obj)) out.push({ k: "start", t: "первая работа на объекте" });
    return { next: "В работе", missing: out };
  }
  if (step === "work") {
    const open = ((obj && obj.stages) || []).filter(function (s) { return !stageFact(s).allDone; }).length;
    if (open) out.push({ k: "stages", t: "закрыть этапы: осталось " + open });
    return { next: "Закрыт", missing: out };
  }
  return { next: "", missing: [] };
}

// ── Выбор объекта ────────────────────────────────────────────────────────────
function words(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/)
    .filter(function (w) { return w.length >= 3 || /\d/.test(w); });
}

// Порядок в выборе: текущий, подходящий по клиенту и свободный, подходящий занятый,
// свободные, занятые. Подходит — тот же клиент из CRM (объект из договора его
// помнит) или фамилия клиента в названии объекта. Занятый — у другого договора.
export function objPickList(objects, contracts, c, clientName) {
  const me = c || {};
  const sur = words(clientName)[0] || "";
  const rows = (objects || []).filter(Boolean).map(function (o) {
    const busy = (contracts || []).filter(function (x) { return x && x.objId === o.id && x.id !== me.id && !x.archived; });
    const match = !!((me.crmClientId && o.crmClientId === me.crmClientId) || (sur && words(o.name).indexOf(sur) >= 0));
    return { o: o, busy: busy, free: busy.length === 0, match: match, current: !!me.objId && me.objId === o.id };
  });
  const rank = function (r) { return r.current ? 0 : (r.match && r.free ? 1 : (r.match ? 2 : (r.free ? 3 : 4))); };
  return rows.map(function (r, i) { return { r: r, i: i }; })
    .sort(function (a, b) { return rank(a.r) - rank(b.r) || a.i - b.i; })
    .map(function (x) { return x.r; });
}

// Основной договор объекта, кроме указанного. Второй основной на одном объекте —
// почти всегда ошибка: деньги, сроки и ответственные разъедутся на два договора.
export function mainContractOf(contracts, objId, exceptId) {
  if (!objId) return null;
  return (contracts || []).find(function (x) {
    return x && x.objId === objId && x.id !== exceptId && (x.type || "main") === "main" && !x.archived;
  }) || null;
}

// ── Объект из договора ───────────────────────────────────────────────────────
function ctText(c) { return String((c && c.note) || "") + " " + String((c && c.name) || ""); }

function kindOf(text) {
  const s = String(text || "").toLowerCase().replace(/ё/g, "е");
  if (/минибрус/.test(s)) return "minibrus";
  if (/бан[яиюе]/.test(s)) return "banya";
  // Квартира — не дом из контейнера: этапы и работы у неё другие.
  if (/квартир/.test(s)) return "flat";
  if (/(^|[^а-я])дом/.test(s)) return "house";
  return "";
}

// «Дом 12 м · Кутьин»: что строим (из примечания или названия договора) и чей.
const KIND_WORD = { banya: "Баня", minibrus: "Баня", flat: "Квартира", house: "Дом" };
// Форма собственности — не имя: у «ИП Петров» и «ООО «Ромашка»» объект называют
// по Петрову и Ромашке, а не «Дом · ИП».
const LEGAL_FORMS = ["ип", "ооо", "оао", "зао", "пао", "ао", "нко", "тсж", "снт"];

export function ctObjName(c, clientName) {
  const m = /(дом|баня)[^.,;:\d]{0,30}?\d+(?:[.,]\d+)?\s*(?:м(?![а-яё])|фут[а-яё]*)/i.exec(ctText(c));
  let what = m ? m[0].replace(/\s+/g, " ").trim() : (KIND_WORD[kindOf(ctText(c))] || "Дом");
  what = what.charAt(0).toUpperCase() + what.slice(1);
  const sur = String(clientName || "").replace(/[«»"'“”„]/g, " ").trim().split(/\s+/)
    .filter(function (w) { return w && LEGAL_FORMS.indexOf(w.toLowerCase()) < 0; })[0] || "";
  return sur ? what + " · " + sur : what;
}

// Шаблон под договор: тот же вид (дом, баня, минибрус), а среди них — у кого больше
// общих слов с договором («40 футов»). Вид не понять — не угадываем, выбирает человек.
export function ctTemplateFor(c, templates) {
  const text = ctText(c).toLowerCase().replace(/ё/g, "е");
  const kind = kindOf(text);
  if (!kind) return null;
  // Совпадение — целым словом или числом. Кусок строки врал: «7» из «д.7» находился
  // в «07.12.2026», «40» — в номере проекта, и шаблон квартиры обгонял шаблоны дома.
  const tokens = {};
  words(text).forEach(function (w) { tokens[w] = true; });
  let best = null, bestScore = 0;
  (templates || []).forEach(function (t) {
    if (!t) return;
    const tk = ["banya", "house", "minibrus"].indexOf(t.kind) >= 0 ? t.kind : kindOf(t.name);
    if (tk !== kind) return;
    let s = 10;
    words(t.name).forEach(function (w) { if (tokens[w]) s += 1; });
    if (s > bestScore) { best = t; bestScore = s; }
  });
  return best;
}

// ── Прогресс стройки ─────────────────────────────────────────────────────────
// Срок договора говорит про сдачу целиком, а стройка встаёт этапами: «этап 2 из 3,
// отставание 6 дн» видно за месяц до срыва сдачи. Отставание — в рабочих днях, тем же
// счётом, что у напоминаний (src/stages.js).
export function objProgress(obj, today) {
  const stages = (obj && obj.stages) || [];
  if (!stages.length) return null;
  const facts = stages.map(stageFact);
  const curIdx = facts.findIndex(function (f) { return !f.allDone; });
  const worst = objWorstStage(obj, today);
  const late = worst && (worst.sc.state === "overdue" || worst.sc.state === "notStarted") ? worst.sc.days : 0;
  return {
    total: stages.length,
    done: facts.filter(function (f) { return f.allDone; }).length,
    cur: curIdx < 0 ? null : { n: curIdx + 1, name: stages[curIdx].n || ("Этап " + (curIdx + 1)) },
    started: facts.some(function (f) { return !!f.start || f.done > 0; }),
    hasPlan: stages.some(function (s) { return !!(s && s.planEnd); }),
    late: late,
    worst: worst,
  };
}
