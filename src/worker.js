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
async function getPrice(url){
  let u; try{ u=new URL(url); }catch(e){ return { success:false, error:"некорректная ссылка" }; }
  if(u.protocol!=="http:" && u.protocol!=="https:") return { success:false, error:"некорректная ссылка" };
  let r;
  try{
    r = await fetch(u.toString(), { redirect:"follow", headers:{
      "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language":"ru-RU,ru;q=0.9,en;q=0.8"
    }});
  }catch(e){ return { success:false, error:"магазин недоступен ("+String(e.message||e).slice(0,60)+")" }; }
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
      if (request.method === "GET")  return await getState(env, storageKey);
      if (request.method === "POST") return await postState(env, storageKey, request);
      return json({ success: false, error: "Method not allowed" }, 405);
    } catch (err) {
      return json({ success: false, error: err.message ?? String(err) }, 500);
    }
  },
};
