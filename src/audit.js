// ─── ИСТОРИЯ ДЕЙСТВИЙ (аудит) ────────────────────────────────────────────────
// Кто, что и когда менял в панели. Ключевая идея: панель НЕ шлёт «события» — она
// шлёт снимок всего состояния. Поэтому лог строится СЕРВЕРОМ: сравниваем то, что
// лежало в D1, с тем, что пришло, и записываем разницу. Плюсы такого подхода:
//   • не надо инструментировать 15k строк admin.js — логируется вообще всё;
//   • «кто» берётся из подписанного токена (auth.uid), клиент его не подделает;
//   • лог живёт в СВОЕЙ таблице, а не в снимке — лимит D1 (2 МБ на строку) не при чём.
//
// Дешевизна: сначала сравниваются СЫРЫЕ строки JSON по разделам. Клиент шлёт полный
// снимок, но меняется обычно 1–2 раздела — остальные отсеиваются сравнением строк,
// без парсинга.

const MAX_EVENTS_PER_SAVE = 40;   // защита от «импортировали смету на 500 позиций»
const MAX_DEPTH = 7;              // объект → этапы → работы → материалы → поля
const COALESCE_MS = 2 * 60 * 1000; // правки одного поля в течение 2 мин — одна запись
const KEEP_DAYS = 180;            // глубина хранения истории
const VAL_MAX = 70;               // обрезка значений в логе

// Разделы снимка → человеческие названия. Раздел без метки в лог не пишется
// (служебные ключи вроде estKinds/estRooms шумят и ничего не говорят человеку).
export const SECTION_LABELS = {
  objects:      "Объекты",
  templates:    "Шаблоны",
  estimates:    "Сметы",
  dbWorks:      "База · работы",
  expProducts:  "База · материалы",
  dbPlans:      "База · планировки",
  purchased:    "Снабжение · закупка",
  arrived:      "Снабжение · приёмка",
  receipts:     "Снабжение · чеки",
  finTxns:      "Финансы · операции",
  finSalaries:  "Финансы · зарплаты",
  finContracts: "Финансы · суммы договоров",
  finExtraWorks:"Финансы · допработы",
  contractDocs: "Договора",
  crmClients:   "CRM-клиенты",
  users:        "Команда",
  roles:        "Роли",
  rolePermissions: "Права ролей",
  settings:     "Настройки",
  auth:         "Вход в портал",
};

// Поля, которые меняются сами и в истории только мешают.
const SKIP_FIELDS = new Set(["updatedAt", "updated_at", "ts", "_v", "seen", "lastSeen", "cachedAt"]);

// Поля-секреты: факт изменения в истории нужен, ЗНАЧЕНИЯ — нет. Иначе админ,
// поменявший сотруднику PIN, оставил бы этот PIN в логе открытым текстом.
const REDACT_FIELDS = new Set(["pin", "password", "pass", "token", "secret", "apiKey", "api_key", "key"]);

const FIELD_LABELS = {
  name: "название", n: "название", title: "название", note: "примечание", comment: "комментарий",
  cost: "стоимость", price: "цена", unitCost: "цена за ед.", sum: "сумма", amount: "сумма",
  qty: "количество", cnt: "количество", store: "магазин", url: "ссылка", phone: "телефон",
  stage: "этап", status: "статус", done: "выполнено", pin: "PIN", roles: "роли",
  date: "дата", start: "начало", end: "окончание", resp: "ответственный", responsible: "ответственный",
  icon: "иконка", emoji: "иконка", img: "изображение", mode: "режим", hours: "часы",
};

function fieldLabel(k) { return FIELD_LABELS[k] || k; }

// Имя элемента для «хлебных крошек». id — последний резерв: лучше «db_dm3_1», чем пусто.
function nameOf(x) {
  if (x === null || x === undefined) return "";
  if (typeof x !== "object") return String(x);
  return String(x.name || x.n || x.title || x.t || x.label || x.id || "");
}

function isPlainObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
function hasId(o) { return isPlainObj(o) && (typeof o.id === "string" || typeof o.id === "number"); }

function fmtVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "да";
  if (v === false) return "нет";
  if (typeof v === "object") return Array.isArray(v) ? "список (" + v.length + ")" : "объект";
  const s = String(v);
  return s.length > VAL_MAX ? s.slice(0, VAL_MAX - 1) + "…" : s;
}

// ─── Ядро: рекурсивная разница двух снимков раздела ──────────────────────────
// out — накопитель событий { action, trail:[имена], field, from, to }.
// trail даёт путь «Баня на Киевке › ЭТАП 1 › Обшивка стен», из него собирается заголовок.
function diffValue(prev, next, trail, out, depth) {
  if (out.length >= MAX_EVENTS_PER_SAVE) return;
  if (prev === next) return;

  if (Array.isArray(prev) && Array.isArray(next)) {
    // Массив объектов с id — сопоставляем по id: видно добавление/удаление/правку.
    if (next.some(hasId) || prev.some(hasId)) {
      const pm = new Map(), nm = new Map();
      prev.forEach(function (x, i) { pm.set(hasId(x) ? String(x.id) : "#" + i, x); });
      next.forEach(function (x, i) { nm.set(hasId(x) ? String(x.id) : "#" + i, x); });
      for (const [k, v] of nm) {
        if (!pm.has(k)) out.push({ action: "add", trail: trail.concat(nameOf(v)), field: "", from: null, to: null });
        else if (depth < MAX_DEPTH) diffValue(pm.get(k), v, trail.concat(nameOf(v)), out, depth + 1);
        if (out.length >= MAX_EVENTS_PER_SAVE) return;
      }
      for (const [k, v] of pm) {
        if (!nm.has(k)) out.push({ action: "del", trail: trail.concat(nameOf(v)), field: "", from: null, to: null });
        if (out.length >= MAX_EVENTS_PER_SAVE) return;
      }
      return;
    }
    // Массив примитивов (фото, теги) — деталей не разбираем, важен сам факт.
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      out.push({ action: "edit", trail: trail.slice(), field: "список", from: prev.length, to: next.length });
    }
    return;
  }

  if (isPlainObj(prev) && isPlainObj(next)) {
    const keys = new Set(Object.keys(prev).concat(Object.keys(next)));
    for (const k of keys) {
      if (SKIP_FIELDS.has(k) || k.charAt(0) === "_") continue;
      const a = prev[k], b = next[k];
      if (a === b) continue;
      if ((isPlainObj(a) || Array.isArray(a)) && (isPlainObj(b) || Array.isArray(b))) {
        if (depth < MAX_DEPTH) diffValue(a, b, trail.slice(), out, depth + 1);
      } else if (JSON.stringify(a) !== JSON.stringify(b)) {
        // Появление/исчезновение ключа в map-разделах (purchased/arrived) = отметка галочки.
        if (a === undefined) out.push({ action: "add", trail: trail.concat(k), field: "", from: null, to: null });
        else if (b === undefined) out.push({ action: "del", trail: trail.concat(k), field: "", from: null, to: null });
        else out.push({ action: "edit", trail: trail.slice(), field: k, from: a, to: b });
      }
      if (out.length >= MAX_EVENTS_PER_SAVE) return;
    }
    return;
  }

  // Разные типы или скаляры
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    out.push({ action: "edit", trail: trail.slice(), field: "значение", from: prev, to: next });
  }
}

// Разделы-«галочки»: {materialId: true}. Голый id в истории нечитаем, поэтому имя
// материала подтягивается из снимка, а действие проговаривается словами.
const MARK_SECTIONS = {
  purchased: ["отмечен как купленный", "снята отметка закупки"],
  arrived:   ["принят на склад", "снята отметка приёмки"],
};

// Индекс id → название по присланному снимку. Строится ЛЕНИВО (только если реально
// поменялись галочки закупки/приёмки) и обходит лишь материалы, а не весь стейт.
function collectNames(node, map, depth) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) { for (const x of node) collectNames(x, map, depth + 1); return; }
  if (node.id && (node.name || node.n)) map[String(node.id)] = String(node.name || node.n);
  for (const k of ["mats", "works", "stages", "items"]) if (node[k]) collectNames(node[k], map, depth + 1);
}
function buildNameIndex(items) {
  const map = {};
  for (const it of items) {
    if (it.work_id === "expProducts" || it.work_id === "dbWorks") collectNames(it.data, map, 0);
    if (it.work_id === "objects" || it.work_id === "templates") collectNames(it.data, map, 0);
  }
  return map;
}

// ─── Таблица ────────────────────────────────────────────────────────────────
// Создаём лениво (раз на изолят) — не нужен отдельный шаг миграции при деплое.
let _tableReady = false;
async function ensureTable(env) {
  if (_tableReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, uid TEXT NOT NULL, uname TEXT NOT NULL DEFAULT '', section TEXT NOT NULL, action TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', field TEXT NOT NULL DEFAULT '', old_val TEXT, new_val TEXT, sig TEXT NOT NULL DEFAULT '', cnt INTEGER NOT NULL DEFAULT 1)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_audit_sig ON audit_log(uid, sig, ts DESC)"),
  ]);
  _tableReady = true;
}

// Имя сотрудника по uid. Кэш на минуту: иначе на каждый автосейв — лишнее чтение users.
let _usersCache = { at: 0, map: {} };
async function userName(env, uid) {
  if (uid === "__master__") return "Мастер-доступ";
  const now = Date.now();
  if (now - _usersCache.at > 60000) {
    try {
      const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key='admin_panel' AND work_id='users'").first();
      const arr = row && row.data ? JSON.parse(row.data) : [];
      const map = {};
      (arr || []).forEach(function (u) { if (u && u.id) map[u.id] = { n: u.name || u.id, av: u.av || "👤", c: u.c || "#7a9aaa" }; });
      _usersCache = { at: now, map: map };
    } catch { _usersCache = { at: now, map: _usersCache.map }; }
  }
  const u = _usersCache.map[uid];
  return u ? u.n : uid;
}

// Одна запись в историю. Склейка: правка того же поля тем же человеком в течение
// COALESCE_MS обновляет существующую строку (чтобы посимвольный ввод имени не давал
// десяток записей), сохраняя ИСХОДНОЕ «было».
async function insertEvent(env, ev) {
  const sig = ev.sig || "";
  if (sig) {
    const prev = await env.DB
      .prepare("SELECT id FROM audit_log WHERE uid=? AND sig=? AND ts>? ORDER BY ts DESC LIMIT 1")
      .bind(ev.uid, sig, Date.now() - COALESCE_MS).first();
    if (prev && prev.id) {
      await env.DB.prepare("UPDATE audit_log SET ts=?, new_val=?, cnt=cnt+1 WHERE id=?")
        .bind(ev.ts, ev.new_val, prev.id).run();
      return;
    }
  }
  await env.DB.prepare("INSERT INTO audit_log (ts, uid, uname, section, action, title, field, old_val, new_val, sig) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(ev.ts, ev.uid, ev.uname, ev.section, ev.action, ev.title, ev.field || "", ev.old_val, ev.new_val, sig).run();
}

// Публичная точка для «событий», у которых нет снимка (вход в портал и т.п.).
export async function logEvent(env, auth, section, action, title, detail) {
  try {
    await ensureTable(env);
    const uid = (auth && auth.uid) || "?";
    await insertEvent(env, {
      ts: Date.now(), uid: uid, uname: await userName(env, uid),
      section: section, action: action, title: title || "", field: "",
      old_val: null, new_val: detail || null, sig: "",
    });
  } catch { /* история не должна ронять основной запрос */ }
}

// ─── Главное: разница снимков → строки истории ───────────────────────────────
// before — Map(work_id → сырая строка JSON из D1) ДО записи; items — то, что пришло.
export async function recordSnapshotDiff(env, auth, before, items) {
  if (!auth || auth.client) return;
  const uid = auth.uid || "?";
  const events = [];

  for (const item of items) {
    const label = SECTION_LABELS[item.work_id];
    if (!label) continue;                                   // служебный раздел — не логируем
    const nextRaw = JSON.stringify(item.data ?? null);
    const prevRaw = before.get(item.work_id);
    if (prevRaw === undefined) continue;                    // первое появление раздела — не «правка»
    if (prevRaw === nextRaw) continue;                      // ← дешёвый отсев: парсим только изменённое
    let prev, next;
    try { prev = JSON.parse(prevRaw); next = JSON.parse(nextRaw); } catch { continue; }
    const out = [];
    diffValue(prev, next, [], out, 0);
    out.forEach(function (e) { events.push({ section: item.work_id, sectionLabel: label, ev: e }); });
  }
  if (!events.length) return;

  await ensureTable(env);
  const uname = await userName(env, uid);
  const ts = Date.now();
  const capped = events.slice(0, MAX_EVENTS_PER_SAVE);
  const needNames = capped.some(function (it) { return MARK_SECTIONS[it.section]; });
  const names = needNames ? buildNameIndex(items) : null;

  for (const it of capped) {
    const e = it.ev;
    let title = e.trail.filter(Boolean).join(" › ") || it.sectionLabel;
    const mark = MARK_SECTIONS[it.section];
    if (mark && (e.action === "add" || e.action === "del")) {
      const raw = e.trail[e.trail.length - 1];
      title = "«" + ((names && names[raw]) || raw) + "» — " + (e.action === "add" ? mark[0] : mark[1]);
    }
    const secret = REDACT_FIELDS.has(e.field);
    const field = e.field ? fieldLabel(e.field) : "";
    // Подпись для склейки: тот же человек правит то же поле того же элемента.
    const sig = e.action === "edit" ? it.section + "|" + title + "|" + field : "";
    await insertEvent(env, {
      ts: ts, uid: uid, uname: uname, section: it.section, action: e.action,
      title: title, field: field,
      old_val: e.action === "edit" ? (secret ? "•••" : fmtVal(e.from)) : null,
      new_val: e.action === "edit" ? (secret ? "•••" : fmtVal(e.to)) : null,
      sig: sig,
    });
  }
  if (events.length > capped.length) {
    await insertEvent(env, {
      ts: ts, uid: uid, uname: uname, section: capped[0].section, action: "bulk",
      title: "…и ещё " + (events.length - capped.length) + " изменений за одно сохранение",
      field: "", old_val: null, new_val: null, sig: "",
    });
  }

  // Чистка старого — редко и не на каждом сейве (D1 не любит лишние записи).
  if (ts % 50 === 0) {
    try { await env.DB.prepare("DELETE FROM audit_log WHERE ts < ?").bind(ts - KEEP_DAYS * 86400000).run(); } catch { /* чистка не критична */ }
  }
}

// ─── GET /api/audit — чтение истории (только админ) ──────────────────────────
// Фильтры: uid, section, from (ts), q (поиск по заголовку). Курсор: before="ts.id".
export async function readAudit(env, url) {
  await ensureTable(env);
  const p = url.searchParams;
  const where = [], bind = [];
  const from = Number(p.get("from") || 0);
  if (from > 0) { where.push("ts >= ?"); bind.push(from); }
  const uid = p.get("uid"); if (uid) { where.push("uid = ?"); bind.push(uid); }
  const section = p.get("section"); if (section) { where.push("section = ?"); bind.push(section); }
  const q = (p.get("q") || "").trim();
  if (q) { where.push("(title LIKE ? OR uname LIKE ?)"); bind.push("%" + q + "%", "%" + q + "%"); }
  const cur = (p.get("before") || "").split(".");
  if (cur.length === 2 && cur[0] && cur[1]) {
    where.push("(ts < ? OR (ts = ? AND id < ?))");
    bind.push(Number(cur[0]), Number(cur[0]), Number(cur[1]));
  }
  const limit = Math.min(Math.max(Number(p.get("limit") || 60), 1), 200);
  const sql = "SELECT id, ts, uid, uname, section, action, title, field, old_val, new_val, cnt FROM audit_log"
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY ts DESC, id DESC LIMIT " + (limit + 1);
  const res = await env.DB.prepare(sql).bind(...bind).all();
  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    success: true,
    rows: page,
    sections: SECTION_LABELS,
    next: hasMore && last ? last.ts + "." + last.id : null,
  };
}
