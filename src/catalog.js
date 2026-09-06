// ─── УЗКАЯ РУЧКА КАТАЛОГА: ТОЛЬКО ЗАВЕСТИ ТОВАР ──────────────────────────────
// POST /api/catalog/add — единственный способ пополнить «Базу · материалы» снаружи
// портала (машинный клиент: ассистент, скрипт импорта, выгрузка прайса).
//
// Почему СВОЙ секрет CATALOG_TOKEN, а не общий X-Admin-Token: панельный токен пишет
// снимок ЦЕЛИКОМ разделами, и серверной проверки прав по work_id у записи нет (панель —
// доверенный клиент). Дать его наружу ради одного каталога значит отдать вместе с ним
// договора, финансы и команду. Тот же довод, по которому у MCP свой MCP_TOKEN.
//
// Почему ТОЛЬКО ДОБАВЛЕНИЕ: правка и удаление карточки — это цена, по которой уже
// собраны сметы и закуплены материалы. Ручка снаружи умеет ровно одно действие, и
// потерять ею нельзя ничего: чужие карточки не читаются в ответ, не меняются и не
// удаляются, остальные разделы снимка не открываются вовсе.
//
// Не задан секрет — эндпоинта нет (404, fail-closed): не «пускаем всех» и не подсказываем
// 401-ом, что тут что-то есть. Как MCP_TOKEN, задаётся руками
// (`wrangler secret put CATALOG_TOKEN --name kubrdom-portal-api`), деплои его не трогают.

import { logEvent } from "./audit.js";

const SECTION = "expProducts";
const MAX_ITEMS = 100;          // один запрос — одна таблица прайса, а не выгрузка магазина
const MAX_BODY = 256 * 1024;    // тело запроса: имена и ссылки, картинок тут нет
const MAX_SECTION = 1500000;    // лимит строки D1 — 2 МБ; ближе не подходим
const NAME_MAX = 160;
const COST_MAX = 10000000;

// Единицы из таблиц поставщиков → режим карточки. Словарь общий с панелью
// (public/admin.js импортирует его отсюда): вторая копия разошлась бы с первой,
// и «рулон» из таблицы стал бы штукой в одной из дверей заведения товара.
export const UNIT_WORDS = {
  "шт": "piece", "шт.": "piece", "штук": "piece", "штука": "piece", "штуки": "piece",
  "м2": "m2", "м²": "m2", "кв.м": "m2", "кв.м.": "m2", "кв м": "m2", "m2": "m2",
  "м.п.": "mp", "мп": "mp", "м/п": "mp", "пог.м": "mp", "пог. м": "mp", "п.м": "mp", "м": "mp", "м.": "mp",
  "лист": "sheet", "листов": "sheet", "л": "sheet",
  "пачка": "pack", "пач": "pack", "упак": "pack", "упак.": "pack", "уп": "pack", "уп.": "pack", "упаковка": "pack",
  "рулон": "pack", "бухта": "pack", "мешок": "pack", "коробка": "pack", "компл": "pack", "комплект": "pack",
};
// Слово покупки сохраняем как есть: рулон должен остаться рулоном (см. packWord).
export const PACK_AS_WORD = { "рулон": 1, "бухта": 1, "мешок": 1, "коробка": 1, "комплект": 1, "упаковка": 1, "пачка": 1 };

export const EXP_MODE_KEYS = ["piece", "pack", "mp", "m2", "sheet"];

// Числовые поля пересчёта: сколько базовых единиц в одной покупке. Ноль и минус
// не пропускаем — на них делят (см. expConv), и «0 м² в листе» превратило бы цену
// в бесконечность прямо в смете.
const NUM_FIELDS = ["packPer", "sheetM2", "lenPer", "shopPer"];

// Ответ мутации «ничего не пишем»: у writeSection нет холостого хода, а поднимать
// версию снимка ради нуля изменений нельзя.
const NOOP = "\u0000noop";

// Управляющие символы вырезаем: имя товара уезжает в HTML панели и в лог истории,
// а перевод строки внутри названия ломает и то, и другое.
function str(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

// Имя как ключ сравнения: по имени идёт связь сметы с товаром (ensureMatPids),
// поэтому «ОСП 9 мм» и «осп  9 мм» — один товар, а не два.
export function nameKey(s) {
  return String(s || "").toLowerCase().replace(/[\s\u00a0\u202f]+/g, " ").trim();
}

// Карточка товара по описанию из таблицы или из формы. Одна на все двери заведения:
// панель зовёт её из productNew, ручка — отсюда, и разъехаться формам негде.
export function normProduct(o, id, today) {
  const name = str(o && (o.name || o.n), NAME_MAX);
  if (name.length < 2) return null;
  const unit = str(o && o.unit, 20).toLowerCase();
  const mode = EXP_MODE_KEYS.indexOf(String((o && o.mode) || "")) >= 0
    ? String(o.mode)
    : (UNIT_WORDS[unit] || "piece");
  const url = str(o && o.url, 500);
  const cost = num(o && (o.cost != null ? o.cost : o.unitCost)) || 0;
  const p = {
    id: id,
    emoji: str(o && o.emoji, 4) || "📦",
    name: name,
    store: str(o && o.store, 40),
    url: /^https?:\/\//i.test(url) ? url : "",
    photo: "",
    mode: mode,
    unitCost: Math.round(Math.min(Math.max(cost, 0), COST_MAX) * 100) / 100,
    qty: 1,
    priceCheckedAt: today,
  };
  const word = str(o && o.packName, 20).toLowerCase() || (PACK_AS_WORD[unit] ? unit : "");
  if (word) p.packName = word;
  const base = str(o && o.packBase, 20);
  if (base) p.packBase = base;
  NUM_FIELDS.forEach(function (k) {
    const n = num(o && o[k]);
    if (n != null && n > 0) p[k] = n;
  });
  return p;
}

// Что заводим и что пропускаем. Отделено от записи, чтобы правила проверялись без D1.
export function planAdd(items, existing) {
  const seen = new Map();
  (existing || []).forEach(function (p) { if (p && p.name) seen.set(nameKey(p.name), p); });
  const add = [], skip = [];
  (items || []).forEach(function (raw, i) {
    const name = str(raw && (raw.name || raw.n), NAME_MAX);
    if (name.length < 2) { skip.push({ name: name || "строка " + (i + 1), why: "нет названия" }); return; }
    const key = nameKey(name);
    // Тёзку НЕ заводим и НЕ правим: по имени идёт связь сметы с товаром, и вторая
    // карточка с тем же именем означала бы, что цену правят в одной, а считают по другой.
    const was = seen.get(key);
    if (was) { skip.push({ name: name, why: "уже есть", id: was.id || "" }); return; }
    seen.set(key, { id: "" });
    add.push(raw);
  });
  return { add: add, skip: skip };
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
function reply(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

// id карточки: время + счётчик + случайность, как gid() в панели. На id висят отметки
// закупки и фото — два товара с одним id это «куплено», поставленное не тому.
let seq = 0;
function newId() {
  seq = (seq + 1) % 100000;
  return "p_" + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 7);
}

// POST /api/catalog/add { items: [{name, cost, unit|mode, store, url, packName, packPer, …}] }
export async function catalogFetch(request, env, deps) {
  const writeSection = deps && deps.writeSection;
  if (!env || !env.CATALOG_TOKEN) return reply({ error: "Not found" }, 404);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const hdr = request.headers.get("Authorization") || "";
  const token = hdr.indexOf("Bearer ") === 0 ? hdr.slice(7).trim() : "";
  if (!safeEqual(token, env.CATALOG_TOKEN)) {
    return reply({ error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="kubrdom-catalog"' });
  }
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });

  const text = await request.text();
  if (text.length > MAX_BODY) return reply({ success: false, error: "Слишком большое тело запроса" }, 413);
  let body; try { body = JSON.parse(text); } catch { return reply({ success: false, error: "Тело не разобралось как JSON" }, 400); }
  const items = (body && Array.isArray(body.items)) ? body.items : null;
  if (!items) return reply({ success: false, error: "Ожидается { items: [...] }" }, 400);
  if (!items.length) return reply({ success: false, error: "Список пуст" }, 400);
  if (items.length > MAX_ITEMS) return reply({ success: false, error: "За раз не больше " + MAX_ITEMS + " товаров" }, 413);

  const today = new Date().toISOString().slice(0, 10);
  let added = [], skipped = [];
  const w = await writeSection(env, SECTION, function (list) {
    if (!Array.isArray(list)) return { error: "Раздел «Материалы» повреждён" };
    // План считаем ВНУТРИ мутации: между чтением и записью раздел мог измениться,
    // и тёзка, заведённая в панели секунду назад, обязана отсечь наш дубль.
    const plan = planAdd(items, list);
    const made = [];
    plan.add.forEach(function (raw) {
      const p = normProduct(raw, newId(), today);
      if (p) made.push(p);
    });
    added = made.map(function (p) { return { id: p.id, name: p.name, mode: p.mode, unitCost: p.unitCost }; });
    skipped = plan.skip;
    // Все товары оказались тёзками — писать НЕЧЕГО. Пустая запись подняла бы версию
    // снимка, и каждая открытая панель потянула бы мегабайт ради нуля изменений.
    if (!made.length) return { error: NOOP };
    // Дописываем В НАЧАЛО, как productNew: свежая карточка должна быть на виду.
    const next = made.concat(list);
    if (JSON.stringify(next).length > MAX_SECTION) return { error: "Каталог у предела строки D1 — заводите меньшими порциями" };
    list.length = 0;
    next.forEach(function (p) { list.push(p); });
    return { value: made.length };
  });
  if (!w.ok && w.error !== NOOP) return reply({ success: false, error: w.error }, 409);

  if (added.length) {
    await logEvent(env, { uid: "api" }, SECTION, "add", "Заведено товаров: " + added.length,
      added.map(function (p) { return p.name; }).join(", ").slice(0, 300));
  }
  return reply({ success: true, added: added, skipped: skipped });
}
