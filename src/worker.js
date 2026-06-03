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
  return json({ success: true, key, url: url.origin + "/api/file/" + key });
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
