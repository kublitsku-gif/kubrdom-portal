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

// GET /api/state/:storageKey
async function getState(env, storageKey) {
  const result = await env.DB
    .prepare("SELECT work_id, data, updated_at FROM work_states WHERE storage_key = ?")
    .bind(storageKey)
    .all();

  const items = result.results.map(row => ({
    work_id:    row.work_id,
    data:       JSON.parse(row.data),
    updated_at: row.updated_at,
  }));

  return json({ success: true, storage_key: storageKey, items });
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
async function postState(env, storageKey, request) {
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

  if (body.items.length === 0) {
    return json({ success: true, written: 0, updated_at: now });
  }

  const upsert = env.DB.prepare(`
    INSERT INTO work_states (storage_key, work_id, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(storage_key, work_id)
    DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);

  const batch = body.items.map(item =>
    upsert.bind(storageKey, item.work_id, JSON.stringify(item.data ?? null), now)
  );

  await env.DB.batch(batch);

  return json({ success: true, written: batch.length, updated_at: now });
}

// Разрешённые типы изображений (тип задаём САМИ по расширению, не доверяя клиенту —
// иначе можно залить text/html или svg и получить XSS при отдаче).
const IMG_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", heic:"image/heic", heif:"image/heif" };

// GET /api/file/<key> — публичная отдача файла из R2 (для <img>, без токена).
async function getFile(env, key) {
  if (!env.FILES) return json({ success: false, error: "R2 not configured" }, 500);
  const obj = await env.FILES.get(key);
  if (!obj) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // Защита: не угадывать тип, не исполнять как страницу.
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(obj.body, { headers });
}

// POST /api/file?name=... — загрузка изображения в R2 (тело = бинарные данные). Требует токен.
async function putFile(env, request, url) {
  if (!env.FILES) return json({ success: false, error: "R2 not configured" }, 500);
  const name = url.searchParams.get("name") || "";
  const ext = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const ct = IMG_TYPES[ext];
  if (!ct) return json({ success: false, error: "Можно загружать только изображения (png, jpg, webp, gif, heic)" }, 415);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ success: false, error: "Пустой файл" }, 400);
  if (body.byteLength > 15 * 1024 * 1024) return json({ success: false, error: "Файл больше 15 МБ" }, 413);
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
async function aiChat(env, messages, opts) {
  opts = opts || {};
  if (!env.AI_API_KEY) throw new Error("AI ключ не настроен");
  const base = (env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.AI_API_KEY },
    body: JSON.stringify({
      model: opts.model || env.AI_MODEL || "deepseek-chat",
      messages: messages,
      temperature: opts.temperature != null ? opts.temperature : 0.4,
      max_tokens: opts.max_tokens || 600
    })
  });
  const j = await r.json();
  if (!r.ok || !j.choices) throw new Error("AI: " + JSON.stringify(j.error || j).slice(0, 200));
  return { text: ((j.choices[0].message && j.choices[0].message.content) || "").trim(), usage: j.usage || null };
}
// Системная роль нейропродавца КубрДом.
const SELLER_SYSTEM = "Ты — вежливый и толковый менеджер по продажам компании «КубрДом»: строим бани и дома из морских контейнеров под ключ. Отвечай кратко, по-русски, дружелюбно и по делу, веди клиента к замеру/расчёту. Не выдумывай цены и сроки — если не уверен, предложи уточнить у специалиста.";
// POST /api/ai/test {q} — проверка мозга. Требует токен.
async function aiTest(env, request) {
  let body = {}; try { body = await request.json(); } catch (_) {}
  const q = (body.q || "Здравствуйте, сколько стоит баня?").toString().slice(0, 500);
  const out = await aiChat(env, [
    { role: "system", content: SELLER_SYSTEM },
    { role: "user", content: q }
  ], { max_tokens: 250 });
  return json({ success: true, reply: out.text, usage: out.usage });
}

export default {
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

    // Авторизация для всего остального. Fail-closed.
    const token = request.headers.get("X-Admin-Token") || "";
    if (!env.ADMIN_TOKEN || !safeEqual(token, env.ADMIN_TOKEN)) {
      return unauthorized();
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

    // AI: проверка мозга нейропродавца (с токеном).
    if (url.pathname === "/api/ai/test" && request.method === "POST") {
      try { return await aiTest(env, request); }
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

    const match = url.pathname.match(/^\/api\/state\/([^\/]+)\/?$/);
    if (!match) {
      return json({ success: false, error: "Not found" }, 404);
    }

    const storageKey = decodeURIComponent(match[1]);

    try {
      if (request.method === "GET")  return await getState(env, storageKey);
      if (request.method === "POST") return await postState(env, storageKey, request);
      return json({ success: false, error: "Method not allowed" }, 405);
    } catch (err) {
      return json({ success: false, error: err.message ?? String(err) }, 500);
    }
  },
};
