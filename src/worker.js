// Cloudflare Worker: API для KUBRDOM-portal.
//   GET  /api/state/:storageKey  → текущее состояние объекта (массив работ)
//   POST /api/state/:storageKey  → сохранить состояние объекта
//
// Привязки из wrangler.toml:
//   env.DB — D1Database (banya-db)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age":       "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
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
