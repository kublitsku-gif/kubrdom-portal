// Cloudflare Worker: API для KUBRDOM-portal.
//   GET  /api/state/:storageKey  → текущее состояние объекта (массив работ)
//   POST /api/state/:storageKey  → сохранить состояние объекта
//
// Привязки из wrangler.toml:
//   env.DB — D1Database (banya-db)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  "Access-Control-Max-Age":       "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function unauthorized() {
  return json({ success: false, error: "Unauthorized" }, 401);
}

// Сравнение строк в постоянное время — не сливаем длину/префикс через тайминг.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Персональные токены (серверная авторизация) ─────────────────────────────
// Модель: сотрудник логинится (userId+PIN) → сервер выдаёт ПОДПИСАННЫЙ токен с его
// правами (adm/fin), зашитыми на момент входа. HMAC-ключ = ADMIN_TOKEN (отдельный
// секрет не нужен; ротация ADMIN_TOKEN разом инвалидирует все токены — это и есть отсечка).
// Разделы, которые нельзя переписывать/читать без прав — ниже. Запись чужого раздела не
// отклоняется (иначе полноснимковый сейв ломается), а МОЛЧА пропускается сервером.
const ADMIN_KEYS = ["users", "roles", "rolePermissions", "settings"];   // писать — только admin
const FIN_KEYS   = ["finSalaries", "finTxns", "finContracts", "finExtraWorks"]; // писать/читать — только роль с правом finance

function b64urlEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
async function hmacRaw(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_TOKEN || ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64urlEncode(new Uint8Array(sig));
}
// payload: { u:userId, adm:bool, fin:bool, exp:ms }
async function makeUserToken(env, payload) {
  const p = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacRaw(env, p);
  return "v1." + p + "." + sig;
}
async function verifyUserToken(env, token) {
  if (typeof token !== "string" || token.indexOf("v1.") !== 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expSig = await hmacRaw(env, parts[1]);
  if (!safeEqual(parts[2], expSig)) return null;          // подпись не сошлась
  let payload; try { payload = JSON.parse(b64urlDecodeToStr(parts[1])); } catch { return null; }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;  // протух
  return payload;
}
// Резолвим кто это: мастер (общий ADMIN_TOKEN — full admin, break-glass владельца) или персональный токен.
async function resolveAuth(env, request) {
  const token = request.headers.get("X-Admin-Token") || "";
  if (!token) return null;
  if (env.ADMIN_TOKEN && safeEqual(token, env.ADMIN_TOKEN)) return { kind: "master", uid: "__master__", adm: true, fin: true };
  const p = await verifyUserToken(env, token);
  if (p && p.typ === "client") return { kind: "client", cid: p.cid, adm: false, fin: false, client: true };
  if (p) return { kind: "user", uid: p.u, adm: !!p.adm, fin: !!p.fin };
  return null;
}
// POST /api/login { userId?|phone?, pin } → персональный токен с зашитыми правами. Без токена (сотрудник его и получает).
// Вход по телефону: клиент шлёт телефон+PIN, сервер сам находит сотрудника — публичный список не нужен.
async function loginUser(env, request) {
  let body; try { body = await request.json(); } catch { return json({ success: false, error: "bad json" }, 400); }
  const userId = String((body && body.userId) || "");
  const phone = String((body && body.phone) || "");
  const pin = String((body && body.pin) || "");
  if ((!userId && !phone) || !pin) return json({ success: false, error: "need userId/phone + pin" }, 400);
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN ('users','rolePermissions')").all();
  let users = [], rolePerms = {};
  for (const r of rows.results) {
    try { const d = JSON.parse(r.data); if (r.work_id === "users") users = d || []; else rolePerms = d || {}; } catch {}
  }
  const norm = function (s) { return String(s || "").replace(/\D/g, "").slice(-10); };
  const u = userId
    ? users.find(function (x) { return x && x.id === userId; })
    : users.find(function (x) { return x && x.phone && norm(x.phone) === norm(phone) && norm(phone).length >= 10; });
  if (!u) return json({ success: false, error: "Сотрудник не найден" }, 401);
  const realPin = String(u.pin || "1111");
  if (!safeEqual(pin, realPin)) return json({ success: false, error: "Неверный PIN" }, 401);
  const roles = u.roles || [];
  const adm = roles.indexOf("admin") >= 0;
  const fin = adm || roles.some(function (r) { return (rolePerms[r] || []).indexOf("finance") >= 0; });
  const token = await makeUserToken(env, { u: u.id, adm: adm, fin: fin, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  return json({ success: true, token: token, user: { id: u.id, name: u.name, roles: roles, av: u.av, c: u.c, mustChangePin: !!u.mustChangePin } });
}

// POST /api/change-pin { oldPin, newPin } — сотрудник меняет СВОЙ PIN (auth = его личный токен).
// Нужен отдельный эндпоинт: раздел users пишет только админ, а самому себе PIN сменить надо всем.
async function changePin(env, request, auth) {
  if (!auth || auth.kind !== "user") return json({ success: false, error: "Нужен вход сотрудника" }, 403);
  let body; try { body = await request.json(); } catch { return json({ success: false, error: "bad json" }, 400); }
  const oldPin = String((body && body.oldPin) || ""), newPin = String((body && body.newPin) || "");
  if (!/^[0-9]{4,6}$/.test(newPin)) return json({ success: false, error: "Новый PIN — 4–6 цифр" }, 400);
  const s = await readSnapshot(env, ["users"]);
  const users = s.users || [];
  const idx = users.findIndex(function (u) { return u && u.id === auth.uid; });
  if (idx < 0) return json({ success: false, error: "Сотрудник не найден" }, 404);
  const u = users[idx];
  if (!safeEqual(oldPin, String(u.pin || "1111"))) return json({ success: false, error: "Текущий PIN неверный" }, 401);
  if (safeEqual(newPin, String(u.pin || "1111"))) return json({ success: false, error: "Новый PIN совпадает со старым" }, 400);
  users[idx] = Object.assign({}, u, { pin: newPin, mustChangePin: false });
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES ('admin_panel','users',?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(JSON.stringify(users), Date.now()).run();
  return json({ success: true });
}

// Читает нужные разделы снимка из D1 разом. Возвращает { work_id: data }.
async function readSnapshot(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of rows.results) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}

// Срез данных для кабинета клиента: только ЕГО договор, объект, crmClient, планировки и доходные платежи.
// Больше клиент не получает НИЧЕГО (ни других клиентов/договоров, ни зарплат, ни пользователей).
async function buildClientSlice(env, cid) {
  const s = await readSnapshot(env, ["contractDocs", "objects", "crmClients", "dbPlans", "finTxns"]);
  const contracts = s.contractDocs || [];
  const c = contracts.find(function (x) { return x && x.id === cid; });
  if (!c) return null;
  const obj = (s.objects || []).find(function (o) { return o && o.id === c.objId; });
  const crmCl = (s.crmClients || []).find(function (x) { return x && x.id === c.crmClientId; });
  const planIds = (crmCl && crmCl.planIds) ? crmCl.planIds : [];
  const plans = (s.dbPlans || []).filter(function (p) { return p && planIds.indexOf(p.id) >= 0; });
  const txns = (s.finTxns || []).filter(function (t) { return t && t.type === "income" && ((c.objId && t.objId === c.objId) || t.contractId === c.id); });
  const now = Date.now();
  const item = function (k, d) { return { work_id: k, data: d, updated_at: now }; };
  return [
    item("contractDocs", [c]),
    item("objects", obj ? [obj] : []),
    item("crmClients", crmCl ? [crmCl] : []),
    item("dbPlans", plans),
    item("finTxns", txns),
  ];
}

// POST /api/client-login { query, pin } → клиентский токен (scope=один договор) + его срез. Без токена.
async function clientLogin(env, request) {
  let body; try { body = await request.json(); } catch { return json({ success: false, error: "bad json" }, 400); }
  const query = String((body && body.query) || "").trim().toLowerCase();
  const pin = String((body && body.pin) || "").trim();
  if (!query || !pin) return json({ success: false, error: "need query+pin" }, 400);
  const s = await readSnapshot(env, ["contractDocs", "crmClients"]);
  const contracts = s.contractDocs || [], crm = s.crmClients || [];
  const qd = query.replace(/\D/g, "");
  const c = contracts.find(function (x) {
    const nm = (x.name || "").toLowerCase(), cl = (x.client || "").toLowerCase();
    const cm = crm.find(function (y) { return y.id === x.crmClientId; });
    const ph = ((cm && cm.phone) ? cm.phone : "").replace(/\D/g, "");
    return nm.indexOf(query) >= 0 || cl.indexOf(query) >= 0 || (qd.length >= 4 && ph.indexOf(qd) >= 0);
  });
  if (!c) return json({ success: false, error: "Договор не найден" }, 401);
  const cm = crm.find(function (y) { return y.id === c.crmClientId; });
  const phoneLast4 = ((cm && cm.phone) ? cm.phone : "").replace(/\D/g, "").slice(-4);
  const realPin = (c.clientPin && c.clientPin.trim()) ? c.clientPin.trim() : phoneLast4;
  if (!realPin) return json({ success: false, error: "PIN не задан. Обратитесь к менеджеру по сопровождению." }, 401);
  if (!safeEqual(pin, realPin)) return json({ success: false, error: "Неверный PIN" }, 401);
  const token = await makeUserToken(env, { typ: "client", cid: c.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  const slice = await buildClientSlice(env, c.id);
  return json({ success: true, token: token, cid: c.id, items: slice });
}

// Все строки снимка с фильтрацией по правам (общая часть GET /api/state и 409-ответа POST):
//   • не-admin не получает PIN-ы (вырезаем поле pin из users);
//   • роль без finance не получает финансовые разделы вовсе.
async function readStateItems(env, storageKey, auth) {
  const result = await env.DB
    .prepare("SELECT work_id, data, updated_at FROM work_states WHERE storage_key = ?")
    .bind(storageKey)
    .all();

  const adm = !!(auth && auth.adm), fin = !!(auth && auth.fin);
  const items = [];
  for (const row of result.results) {
    if (!fin && FIN_KEYS.indexOf(row.work_id) >= 0) continue;   // финансы скрыты от не-finance
    let data = JSON.parse(row.data);
    if (!adm && row.work_id === "users" && Array.isArray(data)) {
      data = data.map(function (u) { const c = Object.assign({}, u); delete c.pin; return c; });  // PIN-ы — только admin
    }
    items.push({ work_id: row.work_id, data: data, updated_at: row.updated_at });
  }
  return items;
}

// GET /api/state/:storageKey — с фильтрацией по правам (auth), см. readStateItems.
async function getState(env, storageKey, auth) {
  // Клиент видит ТОЛЬКО срез своего договора (объект/платежи/планировки), больше ничего.
  if (auth && auth.client) {
    const slice = await buildClientSlice(env, auth.cid);
    return json({ success: true, storage_key: storageKey, items: slice || [] });
  }
  return json({ success: true, storage_key: storageKey, items: await readStateItems(env, storageKey, auth) });
}

// POST /api/state/:storageKey
//
// ─── РЕШЕНИЕ, КОТОРОЕ ТЕБЕ НУЖНО СДЕЛАТЬ ─────────────────────────────────────
// Тело запроса будет иметь формат:
//   { items: [ { work_id: "rough_in", data: {...} }, ... ] }
//
// Есть три семантики записи — выбери одну и реализуй в TODO ниже:
//
//   (A) UPSERT batch (рекомендую):
//       Для каждого item делаем INSERT ... ON CONFLICT(storage_key, work_id)
//       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at.
//       Существующие work_id обновляются, новые добавляются, остальные не трогаются.
//       Плюс: безопасно для partial updates с фронта, не теряет данные.
//       Минус: чтобы удалить work_id, нужен отдельный DELETE-эндпоинт.
//
//   (B) REPLACE-ALL:
//       Сначала DELETE FROM work_states WHERE storage_key = ?, потом INSERT всех items.
//       Состояние объекта = ровно то, что прислал фронт.
//       Плюс: простая ментальная модель ("сохранить снимок").
//       Минус: если два клиента шлют одновременно — последний выигрывает целиком,
//              и если фронт прислал неполные данные — потеряем работы.
//
//   (C) UPSERT single (без batching):
//       Тело — один объект { work_id, data }, без массива.
//       Плюс: проще API, проще валидация.
//       Минус: чтобы сохранить 5 работ, нужно 5 запросов.
//
// Я выставил TODO там, где нужна твоя имплементация. Это 5-10 строк кода в зависимости
// от выбранного варианта. Если сомневаешься — бери (A): это самый гибкий и безопасный.
async function postState(env, storageKey, request, auth) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!body || !Array.isArray(body.items)) {
    return json({ success: false, error: "Body must be { items: [...] }" }, 400);
  }

  const now = Date.now();

  for (const item of body.items) {
    if (typeof item?.work_id !== "string" || item.work_id.length === 0) {
      return json({ success: false, error: "Each item needs a non-empty work_id" }, 400);
    }
  }

  // Клиент — строго read-only: ничего не пишем (иначе его частичный срез затёр бы всю базу).
  if (auth && auth.client) {
    return json({ success: true, written: 0, updated_at: now, skipped: ["*client-readonly*"] });
  }
  // Пропускаем запись разделов, на которые у отправителя нет прав. НЕ отклоняем весь запрос
  // (клиент всегда шлёт полный снимок) — просто не трогаем защищённый раздел. Так рабочий,
  // сохраняя объект, не может переписать зарплаты/пользователей/роли, а его сейв проходит.
  const adm = !!(auth && auth.adm), fin = !!(auth && auth.fin);
  const skipped = [];
  const allowed = body.items.filter(function (item) {
    if (!adm && ADMIN_KEYS.indexOf(item.work_id) >= 0) { skipped.push(item.work_id); return false; }
    if (!fin && FIN_KEYS.indexOf(item.work_id) >= 0)   { skipped.push(item.work_id); return false; }
    return true;
  });

  if (allowed.length === 0) {
    return json({ success: true, written: 0, updated_at: now, skipped });
  }

  // ─── OPTIMISTIC LOCKING (закрывает «last write wins») ──────────────────────
  // Новый клиент шлёт base = максимальный updated_at, который он видел. Если любая из
  // ЗАПИСЫВАЕМЫХ строк обновилась позже base (правка с другого устройства, прямая вставка
  // в D1), весь сейв отклоняется 409-м с актуальным снимком — клиент сливает его со своими
  // правками и повторяет. Старые клиенты base не шлют — пишем безусловно, как раньше.
  //
  // Проверка встроена В КАЖДЫЙ upsert самого batch (batch в D1 — одна сериализованная
  // транзакция), а не отдельным SELECT перед записью: иначе между проверкой и записью
  // оставалось бы окно гонки для двух одновременных сейвов. Детали условия:
  //   • скоуп — только записываемые work_id: строки Worker'а (voiceCalls, aiChats) и
  //     скрытые правами разделы не дают ложных конфликтов тем, кто их не пишет;
  //   • updated_at <> now исключает строки, записанные ЭТИМ же batch (первый upsert
  //     ставит updated_at = now > base и без исключения «состарил» бы остальные).
  // Условие неизменно внутри транзакции → batch проходит целиком или целиком нет.
  const base = (typeof body.base === "number" && isFinite(body.base)) ? body.base : null;
  const ids = allowed.map(function (item) { return item.work_id; });
  const guard = base === null ? null : " WHERE NOT EXISTS (SELECT 1 FROM work_states"
    + " WHERE storage_key = ? AND updated_at > ? AND updated_at <> ? AND work_id IN ("
    + ids.map(function () { return "?"; }).join(",") + "))";
  const upsert = env.DB.prepare(
    "INSERT INTO work_states (storage_key, work_id, data, updated_at) "
    + (guard === null ? "VALUES (?, ?, ?, ?)" : "SELECT ?, ?, ?, ?" + guard)
    + " ON CONFLICT(storage_key, work_id)"
    + " DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  );

  const batch = allowed.map(item => guard === null
    ? upsert.bind(storageKey, item.work_id, JSON.stringify(item.data ?? null), now)
    : upsert.bind(storageKey, item.work_id, JSON.stringify(item.data ?? null), now, storageKey, base, now, ...ids)
  );

  const results = await env.DB.batch(batch);

  // changes = 0 — guard не пропустил запись (base устарел). Неизвестная форма meta →
  // считаем записанным (поведение как раньше), а не выдумываем ложный конфликт.
  const rejected = base !== null && results.some(function (r) {
    return r && r.meta && typeof r.meta.changes === "number" && r.meta.changes === 0;
  });
  if (rejected) {
    const items = await readStateItems(env, storageKey, auth);
    return json({ success: false, error: "stale base", conflict: true, storage_key: storageKey, items }, 409);
  }

  return json({ success: true, written: batch.length, updated_at: now, skipped });
}

// Разрешённые типы (тип задаём САМИ по расширению, не доверяя клиенту — иначе можно
// залить text/html или svg и получить XSS при отдаче). Картинки — для фото объектов/
// планировок; документы — для файлов договоров (pdf/doc/xls). SVG/HTML в список НЕ входят.
const IMG_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", heic:"image/heic", heif:"image/heif" };
const DOC_TYPES = {
  pdf:  "application/pdf",
  doc:  "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:  "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const FILE_TYPES = Object.assign({}, IMG_TYPES, DOC_TYPES);

// GET /api/file/<key> — публичная отдача файла из R2 (для <img> и ссылок «Открыть», без токена).
async function getFile(env, key) {
  if (!env.FILES) return json({ success: false, error: "R2 not configured" }, 500);
  const obj = await env.FILES.get(key);
  if (!obj) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // Защита: не угадывать тип (тип фиксируем сами по расширению при загрузке).
  headers.set("X-Content-Type-Options", "nosniff");
  if (ct.indexOf("image/") === 0) {
    // Картинки — инлайн в песочнице: нейтрализует любой «активный» контент при отдаче.
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  } else if (ct !== "application/pdf") {
    // Офисные документы (doc/docx/xls/xlsx) браузер не рендерит — отдаём как загрузку, не инлайн.
    headers.set("Content-Disposition", "attachment");
  }
  // PDF — инлайн (открывается во встроенном вьюере); nosniff достаточно, тип задан нами.
  return new Response(obj.body, { headers });
}

// POST /api/file?name=... — загрузка изображения в R2 (тело = бинарные данные). Требует токен.
async function putFile(env, request, url) {
  if (!env.FILES) return json({ success: false, error: "R2 not configured" }, 500);
  const name = url.searchParams.get("name") || "";
  const ext = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const ct = FILE_TYPES[ext];
  if (!ct) return json({ success: false, error: "Можно загружать изображения (png, jpg, webp, gif, heic) и документы (pdf, doc, docx, xls, xlsx)" }, 415);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ success: false, error: "Пустой файл" }, 400);
  if (body.byteLength > 20 * 1024 * 1024) return json({ success: false, error: "Файл больше 20 МБ" }, 413);
  const key = "plans/" + crypto.randomUUID() + "." + ext;
  await env.FILES.put(key, body, { httpMetadata: { contentType: ct } });
  // Относительный URL: рендерится как <img src="/api/file/..."> на любом домене (same-origin
  // через прокси). Иначе бы зашили *.workers.dev — а его режут в РФ.
  return json({ success: true, key, url: "/api/file/" + key });
}

// Гарантирует наличие темы объекта в Telegram: вернёт { topicId } или { error }.
// topicId > 0 — тема уже есть; 0 — создаём новую по имени объекта.
async function ensureTopic(env, tg, objName, topicId) {
  if (topicId) return { topicId };
  const r = await fetch(tg + "/createForumTopic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT_ID, name: (objName || "Объект").slice(0, 128) }) });
  const j = await r.json();
  if (!j.ok) return { error: "Тема: " + j.description };
  return { topicId: j.result.message_thread_id };
}

// POST /api/video?objName=...&topicId=...&name=... — видео в Telegram-тему объекта (≤50 МБ). Требует токен.
async function postVideo(env, request, url) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json({ success: false, error: "Telegram не настроен" }, 500);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ success: false, error: "Пустой файл" }, 400);
  if (body.byteLength > 50 * 1024 * 1024) return json({ success: false, error: "Видео больше 50 МБ" }, 413);
  const tg = "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;
  const objName = (url.searchParams.get("objName") || "Объект").slice(0, 120);
  const topic = await ensureTopic(env, tg, objName, parseInt(url.searchParams.get("topicId") || "0", 10) || 0);
  if (topic.error) return json({ success: false, error: topic.error }, 502);
  const topicId = topic.topicId;
  // отправить видео в тему
  const fd = new FormData();
  fd.append("chat_id", String(env.TG_CHAT_ID));
  fd.append("message_thread_id", String(topicId));
  fd.append("video", new Blob([body], { type: request.headers.get("Content-Type") || "video/mp4" }), url.searchParams.get("name") || "video.mp4");
  fd.append("caption", objName);
  const r2 = await fetch(tg + "/sendVideo", { method: "POST", body: fd });
  const j2 = await r2.json();
  if (!j2.ok) return json({ success: false, error: "Отправка: " + j2.description, topicId }, 502);
  const msg = j2.result;
  const fileId = (msg.video && msg.video.file_id) || (msg.document && msg.document.file_id) || "";
  return json({ success: true, topicId, messageId: msg.message_id, fileId });
}

// POST /api/photo?objName=...&topicId=...&name=...&caption=... — фото (бэкап) в Telegram-тему объекта. Требует токен.
// Фото на клиенте уже ужато до ≤1 МБ; Telegram показывает его инлайн в ветке объекта.
async function postPhoto(env, request, url) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json({ success: false, error: "Telegram не настроен" }, 500);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ success: false, error: "Пустой файл" }, 400);
  if (body.byteLength > 10 * 1024 * 1024) return json({ success: false, error: "Фото больше 10 МБ" }, 413);
  const tg = "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;
  const objName = (url.searchParams.get("objName") || "Объект").slice(0, 120);
  const topic = await ensureTopic(env, tg, objName, parseInt(url.searchParams.get("topicId") || "0", 10) || 0);
  if (topic.error) return json({ success: false, error: topic.error }, 502);
  const topicId = topic.topicId;
  const fd = new FormData();
  fd.append("chat_id", String(env.TG_CHAT_ID));
  fd.append("message_thread_id", String(topicId));
  fd.append("photo", new Blob([body], { type: request.headers.get("Content-Type") || "image/jpeg" }), url.searchParams.get("name") || "photo.jpg");
  const caption = url.searchParams.get("caption");
  if (caption) fd.append("caption", caption.slice(0, 1024));
  const r2 = await fetch(tg + "/sendPhoto", { method: "POST", body: fd });
  const j2 = await r2.json();
  if (!j2.ok) return json({ success: false, error: "Отправка: " + j2.description, topicId }, 502);
  return json({ success: true, topicId, messageId: j2.result.message_id });
}

// POST /api/photo-delete?msgId=... — удалить сообщение (фото планировки) из Telegram. Требует токен.
// Портал — главный: удалили планировку → удаляем её фото в Telegram.
async function deletePhoto(env, url) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json({ success: false, error: "Telegram не настроен" }, 500);
  const msgId = parseInt(url.searchParams.get("msgId") || "0", 10) || 0;
  if (!msgId) return json({ success: false, error: "need msgId" }, 400);
  const tg = "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;
  const r = await fetch(tg + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT_ID, message_id: msgId }) });
  const j = await r.json();
  // ok:false бывает если сообщение уже удалено/недоступно — для портала это не критично
  if (!j.ok) return json({ success: false, error: j.description }, 502);
  return json({ success: true });
}

// POST /api/topic-rename?topicId=...&name=... — переименовать тему объекта в Telegram. Требует токен.
async function renameTopic(env, url) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json({ success: false, error: "Telegram не настроен" }, 500);
  const topicId = parseInt(url.searchParams.get("topicId") || "0", 10) || 0;
  const name = (url.searchParams.get("name") || "").slice(0, 128);
  if (!topicId || !name) return json({ success: false, error: "need topicId+name" }, 400);
  const tg = "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;
  const r = await fetch(tg + "/editForumTopic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT_ID, message_thread_id: topicId, name: name }) });
  const j = await r.json();
  if (!j.ok) return json({ success: false, error: j.description }, 502);
  return json({ success: true });
}

// GET /api/tg-video/<fileId> — проксируем просмотр из Telegram (Bot API лимит скачивания 20 МБ).
async function getTgVideo(env, fileId) {
  if (!env.TG_BOT_TOKEN) return new Response("not configured", { status: 500, headers: CORS_HEADERS });
  const tg = "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;
  const r = await fetch(tg + "/getFile?file_id=" + encodeURIComponent(fileId));
  const j = await r.json();
  if (!j.ok || !j.result || !j.result.file_path) return new Response("not found (или больше 20 МБ — смотрите в Telegram)", { status: 404, headers: CORS_HEADERS });
  const fr = await fetch("https://api.telegram.org/file/bot" + env.TG_BOT_TOKEN + "/" + j.result.file_path);
  if (!fr.ok) return new Response("fetch failed", { status: 502, headers: CORS_HEADERS });
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", fr.headers.get("Content-Type") || "video/mp4");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(fr.body, { headers });
}

// ─── Notion (заливка больших файлов через File Upload API) ──────────────────
// Зачем: R2-загрузка (/api/file) режется на 20 МБ, а в Notion можно лить большие
// файлы (видео, тяжёлые PDF) — до 5 ГБ. Notion делает это в 3 шага:
//   1) POST /v1/file_uploads         — создаём объект загрузки (single_part или multi_part)
//   2) POST /v1/file_uploads/:id/send — шлём содержимое (для multi_part — по частям)
//   3) POST /v1/file_uploads/:id/complete — «склеиваем» части (только multi_part)
// Токен интеграции — секрет NOTION_TOKEN (Cloudflare → Worker → Settings → Variables).
// Версия API — var NOTION_VERSION (по умолчанию актуальная ниже).
// Большой файл льём СТРИМОМ (память ≈ один кусок 10 МБ), не буферизуя весь файл.
const NOTION_API        = "https://api.notion.com/v1";
const NOTION_VERSION    = "2026-03-11";              // дефолт; можно переопределить env.NOTION_VERSION
const NOTION_PART       = 10 * 1024 * 1024;          // размер части multi-part (диапазон Notion — 5–20 МБ)
const NOTION_SINGLE_MAX = 20 * 1024 * 1024;          // ≤20 МБ — single_part, больше — multi_part
const NOTION_MAX        = 5 * 1024 * 1024 * 1024;    // 5 ГБ — потолок Notion (платный воркспейс)
// Доп. типы под сценарии портала (видео/аудио/архивы) — поверх FILE_TYPES.
const NOTION_EXTRA_TYPES = {
  mp4:"video/mp4", mov:"video/quicktime", webm:"video/webm", mkv:"video/x-matroska",
  mp3:"audio/mpeg", wav:"audio/wav", m4a:"audio/mp4",
  zip:"application/zip", txt:"text/plain", csv:"text/csv",
  ppt:"application/vnd.ms-powerpoint",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
function notionGuessType(name) {
  const ext = (String(name || "").split(".").pop() || "").toLowerCase();
  return FILE_TYPES[ext] || NOTION_EXTRA_TYPES[ext] || "application/octet-stream";
}
// Заголовки Notion: авторизация + версия. json=true — добавить Content-Type (для JSON-тел).
// Для /send (multipart/form-data) Content-Type НЕ ставим — fetch сам задаст boundary.
function notionHeaders(env, json) {
  const h = { "Authorization": "Bearer " + env.NOTION_TOKEN, "Notion-Version": env.NOTION_VERSION || NOTION_VERSION };
  if (json) h["Content-Type"] = "application/json";
  return h;
}
// Шаг 1. Создать объект загрузки. Для multi_part передаём mode + number_of_parts.
async function notionCreateUpload(env, opts) {
  const body = { filename: opts.filename, content_type: opts.contentType };
  if (opts.numberOfParts) { body.mode = "multi_part"; body.number_of_parts = opts.numberOfParts; }
  const r = await fetch(NOTION_API + "/file_uploads", { method: "POST", headers: notionHeaders(env, true), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Notion create upload: " + (j.message || ("HTTP " + r.status)));
  return j;   // { id, upload_url, ... }
}
// Шаг 2. Отправить содержимое (или одну часть). partNumber задаём только для multi_part.
async function notionSendPart(env, id, bytes, filename, contentType, partNumber) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: contentType || "application/octet-stream" }), filename || "file");
  if (partNumber) fd.append("part_number", String(partNumber));
  const r = await fetch(NOTION_API + "/file_uploads/" + id + "/send", { method: "POST", headers: notionHeaders(env), body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Notion send" + (partNumber ? " part " + partNumber : "") + ": " + (j.message || ("HTTP " + r.status)));
  return j;
}
// Шаг 3. Завершить multi_part-загрузку (для single_part не нужен).
async function notionComplete(env, id) {
  const r = await fetch(NOTION_API + "/file_uploads/" + id + "/complete", { method: "POST", headers: notionHeaders(env, true), body: "{}" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Notion complete: " + (j.message || ("HTTP " + r.status)));
  return j;
}
// Multi-part стримом: читаем тело запроса, копим куски по NOTION_PART и шлём их частями.
// number_of_parts считаем из известного размера (Content-Length). Пик памяти ≈ один кусок.
async function notionUploadMultipart(env, stream, size, name, contentType) {
  const numberOfParts = Math.max(1, Math.ceil(size / NOTION_PART));
  const created = await notionCreateUpload(env, { filename: name, contentType, numberOfParts });
  const reader = stream.getReader();
  let buf = new Uint8Array(0), part = 0;
  const append = (chunk) => { const m = new Uint8Array(buf.length + chunk.length); m.set(buf, 0); m.set(chunk, buf.length); buf = m; };
  const sendFront = async (n) => { part++; await notionSendPart(env, created.id, buf.subarray(0, n), name, contentType, part); buf = buf.slice(n); };
  for (;;) {
    const { done, value } = await reader.read();
    if (value && value.length) append(value);
    // Полные части шлём сразу, но последнюю всегда оставляем финальному циклу (она может быть <5 МБ).
    while (buf.length >= NOTION_PART && part < numberOfParts - 1) await sendFront(NOTION_PART);
    if (done) break;
  }
  while (part < numberOfParts && buf.length > 0) {
    const isLast = (part === numberOfParts - 1);
    await sendFront(isLast ? buf.length : Math.min(NOTION_PART, buf.length));
  }
  await notionComplete(env, created.id);
  return created;
}
// Прикрепить загруженный файл к странице Notion как дочерний блок (image/video/audio/pdf/file).
async function notionAttachToPage(env, pageId, uploadId, contentType) {
  const ref = { type: "file_upload", file_upload: { id: uploadId } };
  const ct = String(contentType || "").toLowerCase();
  let kind = "file";
  if (ct.indexOf("image/") === 0) kind = "image";
  else if (ct.indexOf("video/") === 0) kind = "video";
  else if (ct.indexOf("audio/") === 0) kind = "audio";
  else if (ct === "application/pdf") kind = "pdf";
  const block = { object: "block", type: kind };
  block[kind] = ref;
  const r = await fetch(NOTION_API + "/blocks/" + pageId + "/children", { method: "PATCH", headers: notionHeaders(env, true), body: JSON.stringify({ children: [block] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Notion attach: " + (j.message || ("HTTP " + r.status)));
  return j;
}
// POST /api/notion/upload?name=...&pageId=...  тело = бинарные данные файла. Требует токен портала.
//   name    — имя файла (для типа и подписи в Notion);
//   pageId  — (опц.) id страницы/блока: сразу прикрепим файл к ней (иначе загрузка «висит» ~1 час).
// Возвращает { fileUploadId } — его можно приложить к странице/свойству через Notion API позже.
async function notionUpload(env, request, url) {
  if (!env.NOTION_TOKEN) return json({ success: false, error: "Notion не настроен: добавьте секрет NOTION_TOKEN" }, 500);
  const name = (url.searchParams.get("name") || "file").slice(0, 200);
  const pageId = (url.searchParams.get("pageId") || "").trim();
  const contentType = request.headers.get("Content-Type") || notionGuessType(name);
  // Размер берём из Content-Length (позволяет лить стримом). ?size — запасной вариант.
  let size = parseInt(request.headers.get("Content-Length") || url.searchParams.get("size") || "0", 10) || 0;
  if (size > NOTION_MAX) return json({ success: false, error: "Файл больше 5 ГБ (лимит Notion)" }, 413);

  let created;
  if (size > NOTION_SINGLE_MAX) {
    // Большой файл — multi-part стримом, без буферизации всего файла в память.
    created = await notionUploadMultipart(env, request.body, size, name, contentType);
  } else {
    // ≤20 МБ или размер неизвестен — буферизуем и решаем single/multi по факту.
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength === 0) return json({ success: false, error: "Пустой файл" }, 400);
    if (buf.byteLength > NOTION_MAX) return json({ success: false, error: "Файл больше 5 ГБ (лимит Notion)" }, 413);
    size = buf.byteLength;
    if (size > NOTION_SINGLE_MAX) {
      created = await notionUploadMultipart(env, new Response(buf).body, size, name, contentType);
    } else {
      created = await notionCreateUpload(env, { filename: name, contentType });
      await notionSendPart(env, created.id, buf, name, contentType, null);   // single_part: complete не нужен
    }
  }

  let attached = false;
  if (pageId) { await notionAttachToPage(env, pageId, created.id, contentType); attached = true; }
  return json({ success: true, fileUploadId: created.id, filename: name, contentType, size, attached });
}

// ─── Avito (нейропродавец) ──────────────────────────────────────────
// OAuth-токен Avito (client_credentials), кэшируем в изоляте (живёт ~24ч).
let _avitoTok = null, _avitoExp = 0;
async function avitoToken(env) {
  const now = Date.now();
  if (_avitoTok && now < _avitoExp) return _avitoTok;
  if (!env.AVITO_CLIENT_ID || !env.AVITO_CLIENT_SECRET) throw new Error("Avito не настроен");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.AVITO_CLIENT_ID, client_secret: env.AVITO_CLIENT_SECRET });
  const r = await fetch("https://api.avito.ru/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("Avito token: " + JSON.stringify(j).slice(0, 160));
  _avitoTok = j.access_token;
  _avitoExp = now + ((j.expires_in || 3600) - 120) * 1000;   // -2 мин запас
  return _avitoTok;
}
// GET /api/avito/chats — список чатов аккаунта (для проверки связи). Требует токен.
async function avitoChats(env) {
  const t = await avitoToken(env);
  const r = await fetch("https://api.avito.ru/messenger/v2/accounts/" + env.AVITO_USER_ID + "/chats?limit=30", { headers: { Authorization: "Bearer " + t } });
  const j = await r.json();
  if (!r.ok) return json({ success: false, error: "Avito chats: " + JSON.stringify(j).slice(0, 160) }, 502);
  const chats = (j.chats || []).map(function (c) {
    const ctx = (c.context && c.context.value) || {};
    const lm = c.last_message || {};
    return { id: c.id, title: ctx.title || "", price: ctx.price_string || "", lastText: (lm.content && lm.content.text) || "", lastAt: lm.created || 0 };
  });
  return json({ success: true, count: chats.length, chats });
}

// ─── AI (нейропродавец, OpenAI-совместимый коннектор) ───────────────
// Один и тот же код для DeepSeek/GigaChat/OpenAI/Qwen — отличается base_url+key+model.
// Какой провайдер выбран в портале (settings.aiProvider): "deepseek" (по умолчанию) | "kimi" | "claude".
async function aiProvider(env) {
  try { const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "settings").first(); if (row && row.data) { const s = JSON.parse(row.data); if (s && ["kimi", "claude", "gpt", "dsreasoner", "yandex", "yandexlite", "yandexpro"].indexOf(s.aiProvider) >= 0) return s.aiProvider; } } catch (e) {}
  return "deepseek";
}
// Включён ли нейропродавец (мастер-выключатель settings.aiEnabled, по умолчанию вкл).
async function aiEnabled(env) {
  try { const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "settings").first(); if (row && row.data) { const s = JSON.parse(row.data); return s.aiEnabled !== false; } } catch (e) {}
  return true;
}
// Доступы провайдера. kind:"anthropic"|"yandex" — нативный API; иначе OpenAI-совместимый.
function aiResolve(env, provider) {
  if (provider === "yandexlite") return { key: env.YANDEX_API_KEY, model: "yandexgpt-lite/latest", name: "YandexGPT Lite", kind: "yandex" };
  if (provider === "yandexpro" || provider === "yandex") return { key: env.YANDEX_API_KEY, model: "yandexgpt/latest", name: "YandexGPT Pro", kind: "yandex" };
  if (provider === "dsreasoner") return { key: env.AI_API_KEY, base: env.AI_BASE_URL || "https://api.deepseek.com", model: "deepseek-reasoner", name: "DeepSeek-R" };
  if (provider === "kimi") return { key: env.KIMI_API_KEY, base: env.KIMI_BASE_URL || "https://api.moonshot.ai/v1", model: env.KIMI_MODEL || "moonshot-v1-32k", name: "Kimi" };
  if (provider === "claude") return { key: env.CLAUDE_API_KEY, base: "https://api.anthropic.com", model: env.CLAUDE_MODEL || "claude-sonnet-4-6", name: "Claude", kind: "anthropic" };
  if (provider === "gpt") return { key: env.OPENAI_API_KEY, base: env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: env.OPENAI_MODEL || "gpt-4o-mini", name: "GPT" };
  return { key: env.AI_API_KEY, base: env.AI_BASE_URL || "https://api.deepseek.com", model: env.AI_MODEL || "deepseek-chat", name: "DeepSeek" };
}
async function aiChat(env, messages, opts) {
  opts = opts || {};
  const pr = aiResolve(env, opts.provider);
  if (!pr.key) throw new Error(pr.name + ": ключ не настроен");
  // Anthropic (Claude): свой формат — system отдельным полем, x-api-key, без response_format.
  if (pr.kind === "anthropic") {
    let sys = "", msgs = [];
    messages.forEach(function (m) { if (m.role === "system") sys += (sys ? "\n\n" : "") + m.content; else msgs.push({ role: m.role, content: m.content }); });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": pr.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: opts.model || pr.model, max_tokens: opts.max_tokens || 700, temperature: opts.temperature != null ? opts.temperature : 0.4, system: sys, messages: msgs })
    });
    const j = await r.json();
    if (!r.ok || !j.content) throw new Error(pr.name + ": " + JSON.stringify(j.error || j).slice(0, 200));
    const text = (j.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("").trim();
    return { text: text, usage: j.usage || null };
  }
  // YandexGPT (Yandex Cloud Foundation Models): свой формат — modelUri c folder id, поле text, Api-Key.
  if (pr.kind === "yandex") {
    if (!env.YANDEX_FOLDER_ID) throw new Error("YandexGPT: не задан YANDEX_FOLDER_ID (каталог)");
    let sys = "", msgs = [];
    messages.forEach(function (m) { if (m.role === "system") sys += (sys ? "\n\n" : "") + m.content; else msgs.push({ role: m.role, text: m.content }); });
    const ymsgs = (sys ? [{ role: "system", text: sys }] : []).concat(msgs);
    const r = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Api-Key " + pr.key },
      body: JSON.stringify({ modelUri: "gpt://" + env.YANDEX_FOLDER_ID + "/" + pr.model, completionOptions: { stream: false, temperature: opts.temperature != null ? opts.temperature : 0.4, maxTokens: String(opts.max_tokens || 800) }, messages: ymsgs })
    });
    const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch (e) {}
    if (!r.ok || !j || !j.result) throw new Error(pr.name + " " + r.status + ": " + String(raw || "").replace(/\s+/g, " ").slice(0, 140));
    const alt = j.result.alternatives && j.result.alternatives[0];
    const text = ((alt && alt.message && alt.message.text) || "").trim();
    return { text: text, usage: j.result.usage || null };
  }
  // OpenAI-совместимые (DeepSeek/Kimi)
  const base = pr.base.replace(/\/+$/, "");
  const model = opts.model || pr.model;
  let temperature = opts.temperature != null ? opts.temperature : 0.4;
  let max_tokens = opts.max_tokens || 600;
  let useJson = !!opts.response_format;
  let sendTemp = true;
  // Reasoning-модели (Kimi K2, DeepSeek-R1): не любят response_format, нужен большой бюджет токенов (reasoning+ответ).
  const isKimiK2 = /^kimi-k2/i.test(model);
  const isDsReasoner = /reasoner/i.test(model);
  if (isKimiK2 || isDsReasoner) { if (max_tokens < 4000) max_tokens = 4000; useJson = false; }
  if (isKimiK2) temperature = 1;             // Kimi K2 допускает только temperature=1
  if (isDsReasoner) sendTemp = false;        // DeepSeek-R1 не поддерживает temperature
  const reqInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + pr.key },
    body: JSON.stringify(Object.assign({ model: model, messages: messages, max_tokens: max_tokens }, sendTemp ? { temperature: temperature } : {}, useJson ? { response_format: opts.response_format } : {}))
  };
  let r, raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetch(base + "/chat/completions", reqInit);
    raw = await r.text();
    if (r.ok || r.status < 500) break;                 // не 5xx — не повторяем
    if (attempt === 0) await new Promise(function (res) { setTimeout(res, 1200); });  // 5xx (502/503/перегрузка) — одна повторная попытка
  }
  let j = null; try { j = JSON.parse(raw); } catch (e) {}
  if (!r.ok) throw new Error(pr.name + " " + r.status + ": " + String(raw || "").replace(/\s+/g, " ").slice(0, 140));
  if (!j || !j.choices) throw new Error(pr.name + ": неожиданный ответ — " + String(raw || "").slice(0, 140));
  return { text: ((j.choices[0].message && j.choices[0].message.content) || "").trim(), usage: j.usage || null };
}
// Системная роль нейропродавца КубрДом.
const SELLER_SYSTEM = "Ты — вежливый и толковый менеджер по продажам компании «КубрДом»: строим бани и дома из морских контейнеров под ключ. Отвечай кратко, по-русски, дружелюбно и по делу, веди клиента к замеру/расчёту. Не выдумывай цены и сроки — если не уверен, предложи уточнить у специалиста.";
// Факты для нейропродавца — чтобы не выдумывал цены.
const SELLER_FACTS = "Факты о КубрДом:\n- Строим бани и дома из морских контейнеров под ключ.\n- Баня из контейнера под ключ — ориентир 1 300 000–1 390 000 ₽ (по текущим объявлениям), точная цена зависит от планировки, комплектации и отделки.\n- Цену НЕ называй как окончательную — это ориентир, точную считает специалист после уточнения деталей и замера.\n- Всегда веди клиента к следующему шагу: уточнить детали, договориться о звонке/замере, попросить телефон.";

// Редактируемая в портале инструкция. Выбор по типу объявления (баня/дом):
// sel = { itemId } (определяем kind по settings.listingKind) или { kind } (явно, для теста).
async function aiSellerPrompt(env, sel) {
  sel = sel || {};
  try {
    const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "settings").first();
    if (row && row.data) {
      const s = JSON.parse(row.data) || {};
      const kind = sel.kind || (sel.itemId && s.listingKind ? s.listingKind[String(sel.itemId)] : null);
      const pick = kind === "banya" ? s.aiSellerPromptBanya : kind === "house" ? s.aiSellerPromptHouse : null;
      const chosen = (pick && String(pick).trim()) ? pick : ((typeof s.aiSellerPrompt === "string" && s.aiSellerPrompt.trim()) ? s.aiSellerPrompt : null);
      if (chosen) return String(chosen).slice(0, 8000);
    }
  } catch (e) {}
  return SELLER_SYSTEM + "\n\n" + SELLER_FACTS;
}
// Авто-режим включён? (settings.aiAutoSend) — простые 🟢-ответы уходят клиенту без кнопки.
async function aiAutoSendEnabled(env) {
  try {
    const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "settings").first();
    if (row && row.data) { const s = JSON.parse(row.data); return !!(s && s.aiAutoSend); }
  } catch (e) {}
  return false;
}
// Структурная часть (НЕ редактируется пользователем — иначе сломается гибрид-логика).
const JSON_INSTRUCTION = "\n\nВажно: верни СТРОГО JSON {\"reply\":\"текст ответа клиенту\",\"needsApproval\":true|false,\"reason\":\"кратко\"}. needsApproval=true, если ответ касается конкретной цены, скидки, сроков, договора, предоплаты или обязательств; иначе false.";
// Нейроответ продавца с гибрид-классификацией (нужно ли одобрение). sel — выбор инструкции (item/kind).
async function aiSellerReply(env, history, sel) {
  const sys = await aiSellerPrompt(env, sel);
  const provider = await aiProvider(env);
  const messages = [
    { role: "system", content: sys + JSON_INSTRUCTION }
  ].concat(history);
  const out = await aiChat(env, messages, { max_tokens: 500, response_format: { type: "json_object" }, provider: provider });
  let p = null;
  try { p = JSON.parse(out.text); }
  catch (e) { try { const mm = out.text.match(/\{[\s\S]*\}/); if (mm) p = JSON.parse(mm[0]); } catch (_) {} }
  if (!p) p = { reply: out.text, needsApproval: true, reason: "json parse fail" };
  let reply = (p.reply || out.text || "").trim();
  if (!reply) reply = "Здравствуйте! Уточните, пожалуйста, детали — подскажу по размерам, комплектации и расчёту.";
  return { reply: reply, needsApproval: p.needsApproval !== false, reason: p.reason || "", usage: out.usage };
}

// ── Голосовой обзвон (Voximplant + YandexGPT) ───────────────────────────
// Мозг робота: одна реплика. Reuse aiChat (YandexGPT уже настроен). VoxEngine зовёт
// этот эндпоинт каждый ход диалога и получает {reply,intent,date} строгим JSON.
const VOICE_JSON_INSTRUCTION = "\n\nВ КОНЦЕ верни СТРОГО JSON одной строкой: {\"reply\":\"что сказать клиенту вслух\",\"intent\":\"talking|booked|callback|refused\",\"date\":\"дата и время просмотра текстом, или пусто\"}. intent=booked — если договорились о просмотре И есть дата; callback — если просят перезвонить позже; refused — если отказ; иначе talking. reply — короткая разговорная фраза, без разметки и эмодзи.";
function voiceProvider(model) { return (/lite/i.test(model || "")) ? "yandexlite" : "yandexpro"; }
async function voiceBrain(env, request) {
  const body = await request.json().catch(function () { return {}; });
  const cfg = body.config || {};
  const history = Array.isArray(body.history) ? body.history : [];
  const sys = (cfg.prompt || "Ты — голосовой ассистент компании КубрДом.") + "\n\nЦель звонка: " + (cfg.goal || "записать на просмотр") + "." + VOICE_JSON_INSTRUCTION;
  const messages = [{ role: "system", content: sys }].concat(history.map(function (m) {
    return { role: (m.role === "assistant" || m.role === "bot") ? "assistant" : "user", content: String((m.content != null ? m.content : m.text) || "") };
  }));
  let out;
  try { out = await aiChat(env, messages, { provider: voiceProvider(cfg.model), max_tokens: Number(cfg.maxTokens) || 120, temperature: 0.5 }); }
  catch (e) { return json({ success: false, error: String((e && e.message) || e) }, 200); }
  let p = null;
  try { p = JSON.parse(out.text); }
  catch (e) { try { const mm = out.text.match(/\{[\s\S]*\}/); if (mm) p = JSON.parse(mm[0]); } catch (_) {} }
  if (!p) p = { reply: out.text, intent: "talking", date: "" };
  const reply = (p.reply || out.text || "").trim() || "Извините, повторите, пожалуйста.";
  const intent = ["talking", "booked", "callback", "refused"].indexOf(p.intent) >= 0 ? p.intent : "talking";
  return json({ success: true, reply: reply, intent: intent, date: p.date || "" });
}
// Результаты звонков — work_id=voiceCalls (владеет Worker; панель НЕ перезаписывает, читает через GET).
async function voiceLoad(env) {
  const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "voiceCalls").first();
  if (!row || !row.data) return [];
  try { const a = JSON.parse(row.data); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function voiceSave(env, list) {
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(storage_key, work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind("admin_panel", "voiceCalls", JSON.stringify(list.slice(-500)), Date.now()).run();
}
async function voiceResult(env, request) {
  const b = await request.json().catch(function () { return {}; });
  const lead = b.lead || {};
  const list = await voiceLoad(env);
  list.push({
    id: "vc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    leadId: lead.id || "", name: lead.name || "", phone: lead.phone || "",
    status: String(b.status || "").slice(0, 40),
    intent: String(b.intent || "").slice(0, 20),
    bookedAt: String(b.bookedAt || b.date || "").slice(0, 80),
    transcript: String(b.transcript || "").slice(0, 4000),
    ts: Date.now()
  });
  await voiceSave(env, list);
  return json({ success: true });
}
async function voiceCallsList(env) { return json({ success: true, calls: await voiceLoad(env) }); }
// Старт исходящего звонка: Voximplant Management API StartScenarios + customData (лид, конфиг, callback).
async function voiceStartCall(env, request, url) {
  const b = await request.json().catch(function () { return {}; });
  const lead = b.lead || {}, cfg = b.config || {};
  const phone = String(lead.phone || "").replace(/[^\d+]/g, "");
  if (!phone) return json({ success: false, note: "у лида нет телефона" }, 200);
  if (!env.VOX_ACCOUNT_ID || !env.VOX_API_KEY || !env.VOX_RULE_ID) {
    return json({ success: false, note: "Voximplant не настроен (нужны секреты VOX_ACCOUNT_ID, VOX_API_KEY и var VOX_RULE_ID)" }, 200);
  }
  const callbackBase = env.PUBLIC_BASE_URL || url.origin;
  const customData = JSON.stringify({
    lead: { id: lead.id || "", name: lead.name || "", phone: phone, msg: lead.msg || "", notes: lead.notes || "" },
    config: { goal: cfg.goal || "", voice: cfg.voice || "alena", model: cfg.model || "yandexgpt-lite", maxTokens: Number(cfg.maxTokens) || 120, prompt: cfg.prompt || "" },
    callerId: env.VOX_CALLER_ID || "", callbackBase: callbackBase, secret: env.WEBHOOK_SECRET || ""
  });
  const api = "https://api.voximplant.com/platform_api/StartScenarios/?account_id=" + encodeURIComponent(env.VOX_ACCOUNT_ID) +
    "&api_key=" + encodeURIComponent(env.VOX_API_KEY) + "&rule_id=" + encodeURIComponent(env.VOX_RULE_ID) +
    "&script_custom_data=" + encodeURIComponent(customData);
  let r, raw = "";
  try { r = await fetch(api, { method: "POST" }); raw = await r.text(); }
  catch (e) { return json({ success: false, error: "Voximplant: " + String((e && e.message) || e) }, 200); }
  let j = null; try { j = JSON.parse(raw); } catch (e) {}
  if (!r.ok || !j || j.error) return json({ success: false, error: "Voximplant: " + String((j && j.error && j.error.msg) || raw).replace(/\s+/g, " ").slice(0, 160) }, 200);
  return json({ success: true, mediaSessionAccessUrl: j.media_session_access_url || "", result: j.result || null });
}

// ── Telegram sales-бот (отдельный от видео-бота) ──
function salesTg(env, method, payload) {
  return fetch("https://api.telegram.org/bot" + env.TG_SALES_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  }).then(function (r) { return r.json(); });
}
// Диалоги ИИ-продавца храним в work_states под work_id=aiChats (владеет Worker; панель не перезаписывает).
async function aiLoadChats(env) {
  const row = await env.DB.prepare("SELECT data FROM work_states WHERE storage_key=? AND work_id=?").bind("admin_panel", "aiChats").first();
  if (!row || !row.data) return {};
  try { return JSON.parse(row.data) || {}; } catch (e) { return {}; }
}
async function aiSaveChats(env, chats) {
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(storage_key, work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind("admin_panel", "aiChats", JSON.stringify(chats), Date.now()).run();
}
async function ensureClientTopic(env, chats, clientKey, name) {
  let c = chats[clientKey];
  if (c && c.topicId) return c;
  const j = await salesTg(env, "createForumTopic", { chat_id: env.TG_SALES_CHAT_ID, name: (name || clientKey).slice(0, 128) });
  if (!j.ok) throw new Error("createForumTopic: " + j.description);
  c = c || { name: name || clientKey, source: "manual", messages: [] };
  c.topicId = j.result.message_thread_id; c.name = name || c.name;
  chats[clientKey] = c;
  return c;
}
function findClientByTopic(chats, topicId) {
  for (const k in chats) { if (chats[k] && chats[k].topicId === topicId) return k; }
  return null;
}

// POST /api/ai/incoming {clientKey,clientName,text,source} — входящее сообщение (симулятор/Avito).
// Общий конвейер входящего (вызывается и симулятором, и вебхуком Avito).
async function aiProcessIncoming(env, opt) {
  const clientName = (opt.clientName || "Клиент").toString().slice(0, 80);
  const clientKey = (opt.clientKey || "").toString().trim() || ("manual:" + clientName);
  const text = (opt.text || "").toString().slice(0, 2000);
  const source = (opt.source || "manual").toString();
  if (!text) return { success: false, error: "empty text" };
  if (!env.TG_SALES_BOT_TOKEN || !env.TG_SALES_CHAT_ID) return { success: false, error: "sales-бот не настроен" };
  const chats = await aiLoadChats(env);
  const c = await ensureClientTopic(env, chats, clientKey, clientName);
  c.source = source;
  if (opt.avitoChatId) c.avitoChatId = opt.avitoChatId;
  if (opt.itemId) c.itemId = opt.itemId;
  c.messages.push({ role: "user", text: text, status: "in", ts: Date.now() });
  await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "👤 Клиент:\n" + text });
  // Мастер-выключатель: нейропродавец на паузе — лид сохранён, но ИИ не отвечает (ответ вручную).
  if (!(await aiEnabled(env))) {
    await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "🔕 Нейропродавец выключен — ответьте клиенту вручную." });
    c.updatedAt = Date.now(); await aiSaveChats(env, chats);
    return { success: true, paused: true };
  }
  const history = c.messages.filter(function (m) { return m.role === "user" || m.role === "assistant"; }).slice(-12)
    .map(function (m) { return { role: m.role === "assistant" ? "assistant" : "user", content: m.text }; });
  let ai;
  try { ai = await aiSellerReply(env, history, { itemId: c.itemId }); }
  catch (e) {
    await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "⚠️ Ошибка ИИ: " + (e.message || e) });
    await aiSaveChats(env, chats);
    return { success: false, error: String(e) };
  }
  const idx = c.messages.length;
  // Авто-режим: простой ответ (🟢) + реальный Avito-чат → отправляем клиенту сразу.
  let autoOk = false;
  if (!ai.needsApproval && c.avitoChatId && await aiAutoSendEnabled(env)) {
    try { const sr = await avitoSend(env, c.avitoChatId, ai.reply); autoOk = !!(sr && sr.id); } catch (e) {}
  }
  if (autoOk) {
    c.messages.push({ role: "assistant", text: ai.reply, status: "sent", auto: true, needsApproval: false, ts: Date.now() });
    await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "🟢 Автоответ отправлен клиенту:\n\n" + ai.reply + (ai.reason ? ("\n\n— " + ai.reason) : "") });
  } else {
    c.messages.push({ role: "assistant", text: ai.reply, status: "draft", needsApproval: ai.needsApproval, ts: Date.now() });
    const tag = ai.needsApproval ? "🟠 нужно одобрение" : "🟢 можно авто";
    const sent = await salesTg(env, "sendMessage", {
      chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId,
      text: "🤖 Черновик (" + tag + "):\n\n" + ai.reply + (ai.reason ? ("\n\n— " + ai.reason) : ""),
      reply_markup: { inline_keyboard: [[{ text: "✅ Отправить", callback_data: "send:" + idx }, { text: "✏️ Изменить", callback_data: "edit:" + idx }]] }
    });
    if (sent && sent.ok && sent.result) c.messages[idx].tgMsgId = sent.result.message_id;
  }
  c.updatedAt = Date.now();
  await aiSaveChats(env, chats);
  return { success: true, topicId: c.topicId, reply: ai.reply, needsApproval: ai.needsApproval };
}
// POST /api/ai/incoming — тонкая обёртка симулятора над общим конвейером.
async function aiIncoming(env, request) {
  let body = {}; try { body = await request.json(); } catch (_) {}
  const out = await aiProcessIncoming(env, body || {});
  return json(out, out.success ? 200 : 500);
}

// POST /api/ai/webhook — вебхук sales-бота (кнопки + ручные ответы в ветке). Публичный, проверка по секрет-токену.
async function aiWebhook(env, request) {
  const upd = await request.json().catch(function () { return {}; });
  // нажатие кнопки
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const topicId = (cq.message && cq.message.message_thread_id) || 0;
    const chats = await aiLoadChats(env);
    const key = findClientByTopic(chats, topicId);
    const parts = (cq.data || "").split(":"); const act = parts[0]; const idx = parseInt(parts[1] || "-1", 10);
    if (key && chats[key].messages[idx]) {
      const c = chats[key], m = c.messages[idx];
      if (act === "send") {
        let note = " (демо — это не Avito-чат)";
        if (c.avitoChatId) {
          try { const sr = await avitoSend(env, c.avitoChatId, m.text); note = (sr && sr.id) ? " клиенту в Avito ✅" : ("\n⚠️ Avito: " + JSON.stringify(sr).slice(0, 140)); }
          catch (e) { note = "\n⚠️ Avito ошибка: " + (e.message || e); }
        }
        m.status = "sent"; c.updatedAt = Date.now(); await aiSaveChats(env, chats);
        await salesTg(env, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
        await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: topicId, text: "✅ Ответ отправлен" + note });
        await salesTg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Отправлено" });
      } else if (act === "edit") {
        await salesTg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Напишите свой вариант ответом в этой ветке" });
        await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: topicId, text: "✏️ Напишите свой вариант ответа сообщением в этой ветке — он заменит черновик." });
      }
    } else {
      await salesTg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Диалог не найден" });
    }
    return json({ ok: true });
  }
  // обычное сообщение в ветке от человека = ответ клиенту (ручной/правка)
  const msg = upd.message;
  if (msg && msg.message_thread_id && msg.text && !(msg.from && msg.from.is_bot)) {
    const chats = await aiLoadChats(env);
    const key = findClientByTopic(chats, msg.message_thread_id);
    if (key) {
      let note = " (записан; это не Avito-чат)";
      if (chats[key].avitoChatId) {
        try { const sr = await avitoSend(env, chats[key].avitoChatId, msg.text); note = (sr && sr.id) ? " клиенту в Avito ✅" : ("\n⚠️ Avito: " + JSON.stringify(sr).slice(0, 140)); }
        catch (e) { note = "\n⚠️ Avito ошибка: " + (e.message || e); }
      }
      chats[key].messages.push({ role: "assistant", text: msg.text, status: "sent", manual: true, ts: Date.now() });
      chats[key].updatedAt = Date.now();
      await aiSaveChats(env, chats);
      await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: msg.message_thread_id, text: "✅ Ваш ответ отправлен" + note });
    }
  }
  return json({ ok: true });
}

// POST /api/ai/send {clientKey,text} — ответ клиенту из карточки CRM. Шлёт в Avito + лог + Telegram. Требует токен.
async function aiSend(env, request) {
  let body = {}; try { body = await request.json(); } catch (_) {}
  const key = (body.clientKey || "").toString();
  const text = (body.text || "").toString().slice(0, 2000);
  if (!key || !text) return json({ success: false, error: "need clientKey+text" }, 400);
  const chats = await aiLoadChats(env);
  const c = chats[key];
  if (!c) return json({ success: false, error: "chat not found" }, 404);
  let ok = false, note = "(не Avito-чат)";
  if (c.avitoChatId) {
    try { const sr = await avitoSend(env, c.avitoChatId, text); ok = !!(sr && sr.id); if (!ok) note = JSON.stringify(sr).slice(0, 140); }
    catch (e) { note = e.message || String(e); }
  }
  c.messages.push({ role: "assistant", text: text, status: ok ? "sent" : "draft", manual: true, ts: Date.now() });
  c.updatedAt = Date.now();
  await aiSaveChats(env, chats);
  if (c.topicId) { try { await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: (ok ? "✅ Ответ из CRM отправлен клиенту:\n\n" : "⚠️ Ответ из CRM НЕ ушёл (" + note + "):\n\n") + text }); } catch (e) {} }
  return json({ success: ok || !c.avitoChatId, sent: ok, note: ok ? "" : note });
}

// GET /api/ai/chats — диалоги для CRM (с токеном).
async function aiChatsList(env) {
  const chats = await aiLoadChats(env);
  return json({ success: true, chats });
}

// POST /api/ai/test-chat {history:[{role,content}]} — песочница диалога (вы клиент, отвечает ИИ).
// Ничего не сохраняет и не шлёт — только ответ по текущей инструкции. Требует токен.
async function aiTestChat(env, request) {
  let body = {}; try { body = await request.json(); } catch (_) {}
  const hist = Array.isArray(body.history) ? body.history.slice(-16).map(function (m) {
    return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || m.text || "").slice(0, 2000) };
  }) : [];
  if (!hist.length) return json({ success: false, error: "empty" }, 400);
  const kind = (body.kind === "banya" || body.kind === "house") ? body.kind : null;
  const out = await aiSellerReply(env, hist, { kind: kind });
  return json({ success: true, reply: out.reply, needsApproval: out.needsApproval, reason: out.reason });
}

// POST /api/ai/test {q} — проверка мозга. Требует токен.
async function aiTest(env, request) {
  let body = {}; try { body = await request.json(); } catch (_) {}
  const q = (body.q || "Здравствуйте, сколько стоит баня?").toString().slice(0, 500);
  const out = await aiChat(env, [
    { role: "system", content: SELLER_SYSTEM },
    { role: "user", content: q }
  ], { max_tokens: 250, provider: await aiProvider(env) });
  return json({ success: true, reply: out.text, usage: out.usage });
}

// GET /api/avito/listings — объявления аккаунта (для привязки инструкций). Требует токен.
async function avitoListings(env) {
  const t = await avitoToken(env);
  let all = [], page = 1;
  for (let i = 0; i < 6; i++) {                  // до 6×50 = 300 объявлений
    const r = await fetch("https://api.avito.ru/core/v1/items?per_page=50&page=" + page, { headers: { Authorization: "Bearer " + t } });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.resources)) break;
    all = all.concat(j.resources.map(function (x) { return { id: x.id, title: x.title, price: x.price, url: x.url, status: x.status }; }));
    if (j.resources.length < 50) break;
    page++;
  }
  return json({ success: true, count: all.length, listings: all });
}
// Отправка текста в чат Avito (вызывается по кнопке «Отправить» — действие пользователя).
async function avitoSend(env, chatId, text) {
  const t = await avitoToken(env);
  const r = await fetch("https://api.avito.ru/messenger/v1/accounts/" + env.AVITO_USER_ID + "/chats/" + chatId + "/messages", {
    method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { text: text }, type: "text" })
  });
  return r.json();
}
// Вебхук Avito: новое сообщение клиента → общий конвейер. Фильтруем свои/системные/не-текст.
async function avitoWebhook(env, request) {
  const upd = await request.json().catch(function () { return {}; });
  const v = upd && upd.payload && upd.payload.value;
  if (!v || (upd.payload.type && upd.payload.type !== "message")) return json({ ok: true });
  if (v.type && v.type !== "text") return json({ ok: true });
  if (String(v.author_id) === String(env.AVITO_USER_ID)) return json({ ok: true });  // наше исходящее — игнор
  const text = (v.content && v.content.text) || "";
  if (!text) return json({ ok: true });
  await aiProcessIncoming(env, { clientKey: "avito:" + v.chat_id, clientName: "Avito · " + (v.author_id || v.chat_id), text: text, source: "avito", avitoChatId: v.chat_id, itemId: v.item_id });
  return json({ ok: true });
}

// «Дожим»: раз в сутки (cron) напоминаем молчащим Avito-клиентам.
async function aiNudge(env) {
  if (!env.TG_SALES_BOT_TOKEN || !env.TG_SALES_CHAT_ID) return;
  if (!(await aiEnabled(env))) return;   // нейропродавец на паузе — без дожима
  const chats = await aiLoadChats(env);
  const now = Date.now(), DAY = 86400000, SILENCE = 2 * DAY, SPACING = 2 * DAY, MAX = 2;
  let changed = false, autoOn = false;
  try { autoOn = await aiAutoSendEnabled(env); } catch (e) {}
  for (const k in chats) {
    const c = chats[k]; if (!c || !c.avitoChatId) continue;
    const msgs = c.messages || []; const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") continue;          // ждём ответа клиента
    if ((now - (c.updatedAt || 0)) < SILENCE) continue;        // ещё рано
    if ((c.nudgeCount || 0) >= MAX) continue;                  // лимит напоминаний
    if (c.lastNudge && (now - c.lastNudge) < SPACING) continue;
    const silentDays = Math.max(1, Math.round((now - (c.updatedAt || now)) / DAY));
    const history = msgs.filter(function (m) { return m.role === "user" || m.role === "assistant"; }).slice(-8)
      .map(function (m) { return { role: m.role === "assistant" ? "assistant" : "user", content: m.text }; });
    history.push({ role: "user", content: "[Система] Клиент молчит " + silentDays + " дн. Напиши короткое вежливое напоминание-дожим: верни клиента в диалог, мягко подведи к следующему шагу (звонок/замер). Без навязчивости, 1-2 предложения." });
    let ai; try { ai = await aiSellerReply(env, history, { itemId: c.itemId }); } catch (e) { continue; }
    c.nudgeCount = (c.nudgeCount || 0) + 1; c.lastNudge = now; c.updatedAt = now;
    const idx = c.messages.length; let autoOk = false;
    if (!ai.needsApproval && autoOn) { try { const sr = await avitoSend(env, c.avitoChatId, ai.reply); autoOk = !!(sr && sr.id); } catch (e) {} }
    if (autoOk) {
      c.messages.push({ role: "assistant", text: ai.reply, status: "sent", auto: true, nudge: true, ts: now });
      await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "⏰🟢 Авто-дожим отправлен (молчал " + silentDays + " дн.):\n\n" + ai.reply });
    } else {
      c.messages.push({ role: "assistant", text: ai.reply, status: "draft", nudge: true, needsApproval: ai.needsApproval, ts: now });
      const sent = await salesTg(env, "sendMessage", { chat_id: env.TG_SALES_CHAT_ID, message_thread_id: c.topicId, text: "⏰ Клиент молчит " + silentDays + " дн. — напоминание (черновик):\n\n" + ai.reply, reply_markup: { inline_keyboard: [[{ text: "✅ Отправить", callback_data: "send:" + idx }, { text: "✏️ Изменить", callback_data: "edit:" + idx }]] } });
      if (sent && sent.ok && sent.result) c.messages[idx].tgMsgId = sent.result.message_id;
    }
    changed = true;
  }
  if (changed) await aiSaveChats(env, chats);
}

// ── Цена из магазина (best-effort) ──────────────────────────────────────────
// Озон/Лемана почти всегда блокируют серверный доступ или рендерят цену в JS —
// тогда вернём ошибку, фронт предложит ввести цену вручную. Для «сговорчивых»
// магазинов (JSON-LD / og:price / itemprop) цену достаём.
function parsePriceFromHtml(html){
  if(!html) return null;
  let m = html.match(/"price"\s*:\s*"?(\d[\d\s\u00a0.,]*)"?/i);
  if(!m) m = html.match(/property=["']og:price:amount["'][^>]*content=["'](\d[\d\s\u00a0.,]*)["']/i);
  if(!m) m = html.match(/itemprop=["']price["'][^>]*content=["'](\d[\d\s\u00a0.,]*)["']/i);
  if(!m) m = html.match(/content=["'](\d[\d\s\u00a0.,]*)["'][^>]*itemprop=["']price["']/i);
  if(!m) m = html.match(/"(?:finalPrice|cardPrice|salePrice|priceValue)"\s*:\s*"?(\d[\d\s\u00a0.,]*)"?/i);
  if(!m) return null;
  let num = String(m[1]).replace(/[\s\u00a0]/g,"");
  if(num.indexOf(",")>=0 && num.indexOf(".")<0) num=num.replace(",", ".");       // запятая-десятичная
  num = num.replace(/\.(?=\d{3}(\D|$))/g,"");                                   // точка-разделитель тысяч
  const v = Math.round(parseFloat(num));
  return (v>0 && v<100000000) ? v : null;
}
// SSRF-защита /api/price: приватные/служебные IP и нестандартные порты недопустимы.
// Эндпоинт за ADMIN_TOKEN, но токен общий на всех — не даём использовать Worker как прокси
// к внутренним/облачным адресам (напр. link-local 169.254.169.254 — метадата).
function _ipv4Blocked(ip){
  const p = ip.split(".").map(Number);
  if(p.length!==4 || p.some(function(x){ return isNaN(x)||x<0||x>255; })) return true;
  const a=p[0], b=p[1];
  if(a===0||a===127||a===10) return true;            // this-host / loopback / private
  if(a===169&&b===254) return true;                  // link-local (в т.ч. cloud metadata)
  if(a===172&&b>=16&&b<=31) return true;             // private
  if(a===192&&b===168) return true;                  // private
  if(a===100&&b>=64&&b<=127) return true;            // CGNAT
  if(a>=224) return true;                            // multicast/reserved
  return false;
}
function _hostIsBlocked(hostname){
  const h=(hostname||"").toLowerCase().replace(/^\[/,"").replace(/\]$/,"");   // снять скобки IPv6
  if(!h) return true;
  if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h==="metadata.google.internal") return true;
  if(h==="::1"||h==="::"||h.startsWith("fe80:")||h.startsWith("fc")||h.startsWith("fd")) return true;  // IPv6 loopback/link-local/ULA
  const m6=h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);          // IPv4-mapped IPv6
  if(m6) return _ipv4Blocked(m6[1]);
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return _ipv4Blocked(h);               // IPv4-литерал
  return false;   // обычный домен магазина — разрешаем
}
async function getPrice(url){
  let u; try{ u=new URL(url); }catch(e){ return { success:false, error:"некорректная ссылка" }; }
  // Редиректы ведём ВРУЧНУЮ (redirect:manual), проверяя КАЖДЫЙ хоп — иначе редирект на
  // приватный адрес обошёл бы проверку начального URL.
  let r, hops=0;
  while(true){
    if(u.protocol!=="http:" && u.protocol!=="https:") return { success:false, error:"некорректная ссылка" };
    if(u.port && u.port!=="80" && u.port!=="443") return { success:false, error:"недопустимый порт" };
    if(_hostIsBlocked(u.hostname)) return { success:false, error:"адрес недоступен" };
    try{
      r = await fetch(u.toString(), { redirect:"manual", headers:{
        "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"ru-RU,ru;q=0.9,en;q=0.8"
      }});
    }catch(e){ return { success:false, error:"магазин недоступен ("+String(e.message||e).slice(0,60)+")" }; }
    const loc = (r.status>=300 && r.status<400) ? r.headers.get("location") : null;
    if(!loc) break;
    if(++hops>4) return { success:false, error:"слишком много редиректов" };
    try{ u=new URL(loc, u); }catch(e){ return { success:false, error:"некорректный редирект" }; }
  }
  if(!r.ok) return { success:false, error:"магазин блокирует доступ (HTTP "+r.status+")" };
  let html=""; try{ html=(await r.text()).slice(0, 2_000_000); }catch(e){ return { success:false, error:"не удалось прочитать страницу" }; }
  const price = parsePriceFromHtml(html);
  if(price==null) return { success:false, error:"цена не найдена (магазин рисует её скриптом)" };
  return { success:true, price };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(aiNudge(env));
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Публичная отдача файлов из R2 (для <img src>) — ДО авторизации, т.к. <img> не шлёт заголовки.
    const fileMatch = url.pathname.match(/^\/api\/file\/(.+)$/);
    if (fileMatch && request.method === "GET") {
      try { return await getFile(env, decodeURIComponent(fileMatch[1])); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Публичный просмотр видео из Telegram (для <video src>) — ДО авторизации.
    const tgMatch = url.pathname.match(/^\/api\/tg-video\/(.+)$/);
    if (tgMatch && request.method === "GET") {
      try { return await getTgVideo(env, decodeURIComponent(tgMatch[1])); }
      catch (err) { return new Response(String(err), { status: 500, headers: CORS_HEADERS }); }
    }

    // Вебхук sales-бота (Telegram) — ДО авторизации (Telegram не шлёт X-Admin-Token).
    // Защита: секрет-токен в заголовке (ставим его при setWebhook = ADMIN_TOKEN).
    if (url.pathname === "/api/ai/webhook" && request.method === "POST") {
      const wts = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!env.WEBHOOK_SECRET || !safeEqual(wts, env.WEBHOOK_SECRET)) return unauthorized();
      try { return await aiWebhook(env, request); }
      catch (err) { return json({ ok: false, error: String(err) }, 200); }   // 200 — чтобы Telegram не ретраил вечно
    }

    // Вебхук Avito (входящие сообщения клиентов) — ДО авторизации. Защита: ?s=<ADMIN_TOKEN> в URL подписки.
    if (url.pathname === "/api/avito/webhook" && request.method === "POST") {
      const ws = url.searchParams.get("s") || "";
      if (!env.WEBHOOK_SECRET || !safeEqual(ws, env.WEBHOOK_SECRET)) return unauthorized();
      try { return await avitoWebhook(env, request); }
      catch (err) { return json({ ok: false, error: String(err) }, 200); }
    }

    // Голосовой робот: мозг (VoxEngine зовёт каждую реплику диалога). Секрет в ?s=.
    if (url.pathname === "/api/voice-brain" && request.method === "POST") {
      const vs = url.searchParams.get("s") || "";
      if (!env.WEBHOOK_SECRET || !safeEqual(vs, env.WEBHOOK_SECRET)) return unauthorized();
      try { return await voiceBrain(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 200); }
    }
    // Голосовой робот: итог звонка (VoxEngine по завершении). Секрет в ?s=.
    if (url.pathname === "/api/voice-result" && request.method === "POST") {
      const vs = url.searchParams.get("s") || "";
      if (!env.WEBHOOK_SECRET || !safeEqual(vs, env.WEBHOOK_SECRET)) return unauthorized();
      try { return await voiceResult(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 200); }
    }

    // Вход сотрудника (userId/телефон + PIN → персональный токен) — ДО авторизации: токен тут и выдаётся.
    if (url.pathname === "/api/login" && request.method === "POST") {
      try { return await loginUser(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // Вход клиента (номер договора/фамилия + PIN → клиентский токен + срез) — ДО авторизации.
    if (url.pathname === "/api/client-login" && request.method === "POST") {
      try { return await clientLogin(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Авторизация для всего остального. Fail-closed. Принимаем мастер-ADMIN_TOKEN (break-glass
    // владельца) ИЛИ персональный токен сотрудника. Права (adm/fin) — в объекте auth.
    const auth = await resolveAuth(env, request);
    if (!auth) {
      return unauthorized();
    }

    // Смена своего PIN (с токеном сотрудника).
    if (url.pathname === "/api/change-pin" && request.method === "POST") {
      try { return await changePin(env, request, auth); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Загрузка файла в R2 (с токеном).
    if (url.pathname === "/api/file" && request.method === "POST") {
      try { return await putFile(env, request, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Загрузка видео в Telegram-тему объекта (с токеном).
    if (url.pathname === "/api/video" && request.method === "POST") {
      try { return await postVideo(env, request, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Заливка большого файла в Notion (multi-part, с токеном).
    if (url.pathname === "/api/notion/upload" && request.method === "POST") {
      try { return await notionUpload(env, request, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // AI: тест-диалог (песочница, с токеном).
    if (url.pathname === "/api/ai/test-chat" && request.method === "POST") {
      try { return await aiTestChat(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // AI: проверка мозга нейропродавца (с токеном).
    if (url.pathname === "/api/ai/test" && request.method === "POST") {
      try { return await aiTest(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // Голосовой ИИ: тест мозга из панели (с токеном, без Voximplant) — тот же voiceBrain.
    if (url.pathname === "/api/voice-test" && request.method === "POST") {
      try { return await voiceBrain(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // AI: входящее сообщение (симулятор/Avito) → черновик в Telegram-ветку (с токеном).
    if (url.pathname === "/api/ai/incoming" && request.method === "POST") {
      try { return await aiIncoming(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // AI: ответ клиенту из карточки CRM (с токеном).
    if (url.pathname === "/api/ai/send" && request.method === "POST") {
      try { return await aiSend(env, request); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // AI: список диалогов для CRM (с токеном).
    if (url.pathname === "/api/ai/chats" && request.method === "GET") {
      try { return await aiChatsList(env); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Голосовой робот: старт исходящего звонка (с токеном).
    if (url.pathname === "/api/voice-call" && request.method === "POST") {
      try { return await voiceStartCall(env, request, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // Голосовой робот: результаты звонков для панели (с токеном).
    if (url.pathname === "/api/voice-calls" && request.method === "GET") {
      try { return await voiceCallsList(env); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Avito: список объявлений (для привязки инструкций, с токеном).
    if (url.pathname === "/api/avito/listings" && request.method === "GET") {
      try { return await avitoListings(env); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }
    // Avito: список чатов (проверка связи, с токеном).
    if (url.pathname === "/api/avito/chats" && request.method === "GET") {
      try { return await avitoChats(env); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Дублирование фото в Telegram-тему объекта (с токеном).
    if (url.pathname === "/api/photo" && request.method === "POST") {
      try { return await postPhoto(env, request, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Удаление фото планировки из Telegram (с токеном).
    if (url.pathname === "/api/photo-delete" && request.method === "POST") {
      try { return await deletePhoto(env, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Переименование темы объекта (с токеном).
    if (url.pathname === "/api/topic-rename" && request.method === "POST") {
      try { return await renameTopic(env, url); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    // Цена материала из магазина (best-effort, с токеном).
    if (url.pathname === "/api/price" && request.method === "GET") {
      try { return json(await getPrice(url.searchParams.get("url") || "")); }
      catch (err) { return json({ success: false, error: String(err) }, 500); }
    }

    const match = url.pathname.match(/^\/api\/state\/([^\/]+)\/?$/);
    if (!match) {
      return json({ success: false, error: "Not found" }, 404);
    }

    const storageKey = decodeURIComponent(match[1]);

    try {
      if (request.method === "GET")  return await getState(env, storageKey, auth);
      if (request.method === "POST") return await postState(env, storageKey, request, auth);
      return json({ success: false, error: "Method not allowed" }, 405);
    } catch (err) {
      return json({ success: false, error: err.message ?? String(err) }, 500);
    }
  },
};
