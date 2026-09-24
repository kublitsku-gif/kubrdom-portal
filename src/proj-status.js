// ═══ ПРОЕКТ: ГДЕ ОН СЕЙЧАС И ЧТО ДЕЛАТЬ ДАЛЬШЕ ═══════════════════════════════
// Путь у дома один: чертёж → состав → цена → объект → договор. Список проектов
// раньше отвечал на это серыми чипами «объекта нет · договора нет», и понять, где
// застрял дом, можно было только открыв его. Здесь путь считается один раз, а
// список и шапка карточки показывают одно и то же: какой шаг следующий и куда тапнуть.
//
// Модуль чистый: на вход — уже посчитанные факты о проекте (площадь, итог, объект,
// договор), на выход — шаги. Сами факты считает панель, потому что для них нужен
// весь её стейт (каталог, правила, объекты).

// [ключ, подпись шага, что сделать, полоса карточки, где это делается]
const STEPS = [
  ["plan",     "Чертёж",  "Начертить дом",    "plan"],
  ["parts",    "Состав",  "Собрать смету",    "parts"],
  ["price",    "Цена",    "Проставить цены",  "parts"],
  ["obj",      "Объект",  "Создать объект",   "money"],
  ["contract", "Договор", "Завести договор",  "money"],
];
export const PROJ_STEP_COUNT = STEPS.length;

// f: { floor, count, price, hasObj, hasContract, isFlat }
// Цена — шаг сделан, когда у сметы есть сумма клиенту. Отставание цен от магазина
// сюда НЕ входит: его проверка — это сборка сметы плюс проход по каждому этапу, и
// считать её на каждой правке в шапке карточки значило бы тормозить ввод. Оно
// показывается отдельной отметкой и отдельным фильтром.
export function projSteps(f) {
  const x = f || {};
  const done = {
    plan: Number(x.floor) > 0,
    parts: Number(x.count) > 0,
    price: Number(x.price) > 0,
    obj: !!x.hasObj,
    contract: !!x.hasContract,
  };
  const steps = STEPS.map(function (s) { return { k: s[0], label: s[1], done: done[s[0]] }; });
  const i = STEPS.findIndex(function (s) { return !done[s[0]]; });
  const next = i < 0 ? null : {
    k: STEPS[i][0],
    n: i + 1,
    // У квартиры чертить нечего: её площади вносят с экспликации.
    label: (STEPS[i][0] === "plan" && x.isFlat) ? "Внести помещения" : STEPS[i][2],
    band: STEPS[i][3],
  };
  return { steps: steps, next: next, doneN: steps.filter(function (s) { return s.done; }).length };
}

// Фильтры списка. Каждый — вопрос, с которым открывают список: «что не продано»,
// «где цены вчерашние», «где стройка идёт не по чертежу», «что уже строим».
export const PROJ_FILTERS = [
  ["all",        "Все"],
  ["nocontract", "Без договора"],
  ["stale",      "Цены отстали"],
  ["diff",       "Правки не в объекте"],
  ["build",      "В стройке"],
];

// f: { hasObj, hasContract, priceState, diffN }
export function projFilterOk(f, filter) {
  const x = f || {};
  if (filter === "nocontract") return !x.hasContract;
  if (filter === "stale") return x.priceState === "stale";
  if (filter === "diff") return Number(x.diffN) > 0;
  if (filter === "build") return !!x.hasObj;
  return true;
}

// Поиск по названию и клиенту. «ё» и «е» — одна буква: Семёнова ищут как «семенова».
function norm(s) { return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }
export function projQueryOk(texts, q) {
  const need = norm(q);
  if (!need) return true;
  const hay = norm((texts || []).join(" "));
  return need.split(" ").every(function (w) { return hay.indexOf(w) >= 0; });
}

// Клиенты для выпадающего списка нового проекта: в CRM их сотни, а листать
// select на телефоне — пытка. Выбранный остаётся в списке всегда, иначе фильтр
// молча сбросил бы выбор.
export function clientsMatching(clients, q, keepId) {
  return (clients || []).filter(function (c) {
    return c && (c.id === keepId || projQueryOk([c.name, c.phone], q));
  });
}

// Копия проекта «сделать такой же»: дом, отделка и наценка — те же, а всё, что
// принадлежит ПРЕЖНЕМУ заказчику и его стройке, не переезжает. Объект и договор
// у копии свои; планировка прошлого заказчика и его клиент в CRM — тоже его.
export function projCopy(p, opts) {
  const o = opts || {};
  const c = JSON.parse(JSON.stringify(p || {}));
  c.id = o.id;
  c.name = (p && p.name ? p.name : "Проект") + " (копия)";
  c.objId = "";
  c.contractId = "";
  c.clientId = "";
  c.status = "draft";
  c.at = o.at || "";
  c.by = o.by || "";
  delete c.plans;
  delete c.plan;
  return c;
}
