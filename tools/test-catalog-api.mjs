#!/usr/bin/env node
// Ручка каталога POST /api/catalog/add (src/catalog.js через настоящий worker.fetch, D1 замокан).
//
// Это ЕДИНСТВЕННАЯ ручка записи, открытая наружу, поэтому под тестом держим не
// удобства, а обещания:
//   • без секрета эндпоинта нет вовсе, с чужим токеном — 401, панельный токен не пускает;
//   • пишется ТОЛЬКО expProducts — ни один другой раздел снимка не трогается;
//   • добавление и ничего кроме: чужие карточки остаются как были, тёзка не заводится;
//   • карточка выходит той же формы, что у панели (общий normProduct).
import worker from "../src/worker.js";
import { normProduct, planAdd, nameKey } from "../src/catalog.js";

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra ? "\n      " + extra : ""));
};

const TOKEN = "catalog-secret-token";
const ADMIN = "admin-secret";

// ─── Мок D1: (storage_key, work_id) → {data, updated_at}, плюс лог запросов ───
function makeDB(seed = {}) {
  const rows = new Map();
  Object.entries(seed).forEach(([k, v]) => rows.set(k, { work_id: k, data: JSON.stringify(v), updated_at: 1000 }));
  const log = [];
  const run = (sql, args) => {
    log.push({ sql, args });
    if (/CREATE (TABLE|INDEX)|INSERT INTO audit_log|DELETE FROM audit_log/.test(sql)) return { results: [], meta: { changes: 1 } };
    if (/SELECT .* FROM audit_log/.test(sql)) return { results: [] };
    if (/SELECT data, updated_at FROM work_states/.test(sql)) {
      const r = rows.get(args[0]);
      return { results: r ? [{ data: r.data, updated_at: r.updated_at }] : [] };
    }
    if (/SELECT work_id, data FROM work_states/.test(sql)) {
      const want = args.slice(1);
      return { results: [...rows.values()].filter((r) => want.indexOf(r.work_id) >= 0).map((r) => ({ work_id: r.work_id, data: r.data })) };
    }
    if (/UPDATE work_states/.test(sql)) {
      const [data, now, workId, base] = args;
      const r = rows.get(workId);
      if (!r || r.updated_at !== base) return { results: [], meta: { changes: 0 } };
      rows.set(workId, { work_id: workId, data, updated_at: now });
      return { results: [], meta: { changes: 1 } };
    }
    return { results: [], meta: { changes: 0 } };
  };
  const prepare = (sql) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      async all() { return run(sql, args); },
      async run() { return run(sql, args); },
      async first() { return (run(sql, args).results || [])[0] || null; },
    });
    return make([]);
  };
  return { db: { prepare, async batch(list) { return Promise.all(list.map((s) => s.run())); } }, rows, log };
}

const CTX = { waitUntil(p) { return p; } };
const call = async (db, body, opt = {}) => {
  const env = { DB: db, ADMIN_TOKEN: ADMIN };
  if (opt.token !== null) env.CATALOG_TOKEN = TOKEN;
  const init = { method: opt.method || "POST", headers: {} };
  if (opt.auth !== null) init.headers.Authorization = "Bearer " + (opt.auth || TOKEN);
  if (opt.headers) Object.assign(init.headers, opt.headers);
  if (init.method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body);
  const r = await worker.fetch(new Request("https://portal.kubrdom.ru/api/catalog/add", init), env, CTX);
  let out = null; try { out = await r.json(); } catch {}
  return { status: r.status, body: out };
};
const products = (rows) => JSON.parse(rows.get("expProducts").data);

const SEED = {
  expProducts: [{ id: "p_old", name: "ОСП 9 мм", unitCost: 900, mode: "sheet" }],
  objects: [{ id: "o1", name: "Баня" }],
  users: [{ id: "u1", name: "Юрий", pin: "1234" }],
  finTxns: [{ id: "t1", sum: 100000 }],
};

// ── 1. Доступ ────────────────────────────────────────────────────────────────
{
  console.log("Доступ");
  const items = [{ name: "Кабель ВВГнг 3х1,5", cost: 90, unit: "м.п." }];

  let { db, rows } = makeDB(SEED);
  let r = await call(db, { items }, { token: null });
  ok("секрет не задан — эндпоинта нет (404)", r.status === 404, "статус " + r.status);
  ok("и ничего не записано", products(rows).length === 1);

  ({ db, rows } = makeDB(SEED));
  r = await call(db, { items }, { auth: "wrong" });
  ok("чужой токен — 401", r.status === 401, "статус " + r.status);

  ({ db, rows } = makeDB(SEED));
  r = await call(db, { items }, { auth: ADMIN });
  ok("панельный ADMIN_TOKEN сюда не пускают", r.status === 401, "статус " + r.status);

  ({ db, rows } = makeDB(SEED));
  r = await call(db, { items }, { auth: null });
  ok("без заголовка — 401", r.status === 401, "статус " + r.status);

  ({ db, rows } = makeDB(SEED));
  r = await call(db, null, { method: "GET" });
  ok("GET не принимаем (405)", r.status === 405, "статус " + r.status);

  ({ db, rows } = makeDB(SEED));
  r = await call(db, null, { method: "OPTIONS" });
  ok("OPTIONS — префлайт (204)", r.status === 204, "статус " + r.status);
}

// ── 2. Добавление и ничего кроме ─────────────────────────────────────────────
{
  console.log("Добавление");
  const { db, rows, log } = makeDB(SEED);
  const r = await call(db, {
    items: [
      { name: "Кабель ВВГнг 3х1,5", cost: 90, unit: "м.п.", store: "Озон", url: "https://www.ozon.ru/product/1" },
      { name: "Пароизоляция Изоспан B", cost: 1800, unit: "рулон", packPer: 70, packBase: "м²" },
    ],
  });
  ok("200 и два товара заведены", r.status === 200 && r.body.added.length === 2, JSON.stringify(r.body));

  const list = products(rows);
  ok("в разделе стало три карточки", list.length === 3, "стало " + list.length);
  ok("свежие идут первыми", list[0].name === "Кабель ВВГнг 3х1,5" && list[1].name.indexOf("Изоспан") >= 0);
  ok("чужая карточка не тронута", JSON.stringify(list[2]) === JSON.stringify(SEED.expProducts[0]));

  const cab = list[0];
  ok("единица «м.п.» стала режимом mp", cab.mode === "mp", cab.mode);
  ok("магазин и ссылка на месте", cab.store === "Озон" && /^https:\/\/www\.ozon\.ru/.test(cab.url));
  ok("цена округлена в копейки", cab.unitCost === 90);
  ok("id уникальные и непустые", !!cab.id && cab.id !== list[1].id);

  const iso = list[1];
  ok("«рулон» остался словом покупки", iso.packName === "рулон" && iso.mode === "pack", JSON.stringify(iso));
  ok("делитель упаковки записан", iso.packPer === 70 && iso.packBase === "м²");

  // Главное обещание: наружу открыта одна секция.
  const written = log.filter((e) => /UPDATE work_states/.test(e.sql)).map((e) => e.args[2]);
  ok("писали ТОЛЬКО expProducts", written.length === 1 && written[0] === "expProducts", written.join(","));
  const read = log.filter((e) => /FROM work_states/.test(e.sql)).map((e) => JSON.stringify(e.args));
  ok("другие разделы не читались", !read.some((a) => /objects|users|finTxns/.test(a)), read.join(" | "));
  ok("в истории есть запись о заведении", log.some((e) => /INSERT INTO audit_log/.test(e.sql)));
  ok("ответ не отдаёт чужие карточки", !JSON.stringify(r.body).includes("p_old"));
}

// ── 3. Тёзка не заводится, чужое не правится ─────────────────────────────────
{
  console.log("Тёзки");
  const { db, rows, log } = makeDB(SEED);
  const r = await call(db, { items: [{ name: "осп  9 ММ", cost: 1500 }] });
  ok("тёзка (регистр и пробелы) отсечена", r.status === 200 && r.body.added.length === 0 && r.body.skipped.length === 1, JSON.stringify(r.body));
  ok("в ответе сказано, почему", r.body.skipped[0].why === "уже есть" && r.body.skipped[0].id === "p_old");
  const list = products(rows);
  ok("цена чужой карточки НЕ переписана", list.length === 1 && list[0].unitCost === 900);
  ok("холостой записи не было", !log.some((e) => /UPDATE work_states/.test(e.sql)));

  const { db: db2, rows: rows2 } = makeDB(SEED);
  const r2 = await call(db2, { items: [{ name: "Саморез 4х70", cost: 2 }, { name: "саморез 4х70", cost: 3 }] });
  ok("дубль внутри одного запроса тоже отсекается", r2.body.added.length === 1 && r2.body.skipped.length === 1, JSON.stringify(r2.body));
  ok("карточка заведена одна", products(rows2).length === 2);
}

// ── 4. Разбор тела ───────────────────────────────────────────────────────────
{
  console.log("Разбор тела");
  const { db, rows } = makeDB(SEED);
  ok("не JSON — 400", (await call(db, "{не json", {})).status === 400);
  ok("нет items — 400", (await call(db, { foo: 1 })).status === 400);
  ok("пустой список — 400", (await call(db, { items: [] })).status === 400);
  const many = Array.from({ length: 101 }, (_, i) => ({ name: "Товар " + i, cost: 1 }));
  ok("больше сотни за раз — 413", (await call(db, { items: many })).status === 413);
  ok("после отказов раздел не изменился", products(rows).length === 1);

  const r = await call(db, { items: [{ name: "x" }, { name: "Уголок 50х50", cost: 40 }] });
  ok("строка без имени пропущена, соседняя заведена",
    r.body.added.length === 1 && r.body.skipped.length === 1 && r.body.added[0].name === "Уголок 50х50", JSON.stringify(r.body));
}

// ── 5. Сторож updated_at ─────────────────────────────────────────────────────
{
  console.log("Сторож записи");
  const { db, rows } = makeDB(SEED);
  // Панель сохранила раздел между чтением и записью — база сдвинула updated_at.
  const orig = db.prepare;
  let once = false;
  db.prepare = (sql) => {
    const st = orig(sql);
    if (/SELECT data, updated_at FROM work_states/.test(sql)) {
      return { bind: (...a) => ({ async first() {
        const r = await st.bind(...a).first();
        if (!once) { once = true; rows.set("expProducts", { work_id: "expProducts", data: rows.get("expProducts").data, updated_at: 2000 }); }
        return r;
      } }) };
    }
    return st;
  };
  const r = await call(db, { items: [{ name: "Гофра ПВХ 20", cost: 25 }] });
  ok("разошлась версия — товар всё равно заведён на второй попытке",
    r.status === 200 && r.body.added.length === 1, JSON.stringify(r.body));
  ok("и записан ровно один раз", products(rows).filter((p) => p.name === "Гофра ПВХ 20").length === 1);
}

// ── 6. Чистые правила (без D1) ───────────────────────────────────────────────
{
  console.log("Правила формы карточки");
  const p = normProduct({ name: "  Клей-пена POLYNOR\n ", cost: "6 843,50", unit: "коробка", shopPer: 12, url: "javascript:alert(1)" }, "id1", "2026-09-06");
  ok("перевод строки и пробелы вычищены", p.name === "Клей-пена POLYNOR", JSON.stringify(p.name));
  ok("цена с пробелами и запятой разобрана", p.unitCost === 6843.5, String(p.unitCost));
  ok("делитель магазина сохранён", p.shopPer === 12);
  ok("не-http ссылка выброшена", p.url === "");
  ok("режим и слово покупки из единицы", p.mode === "pack" && p.packName === "коробка");

  ok("ноль в делителе не пишем", normProduct({ name: "Лист", packPer: 0 }, "i", "d").packPer === undefined);
  ok("минус в цене не пишем", normProduct({ name: "Лист", cost: -5 }, "i", "d").unitCost === 0);
  ok("явный mode сильнее единицы", normProduct({ name: "Лист", mode: "sheet", unit: "шт" }, "i", "d").mode === "sheet");
  ok("выдуманный mode отбрасывается", normProduct({ name: "Лист", mode: "hack" }, "i", "d").mode === "piece");
  ok("имя короче двух букв — не товар", normProduct({ name: "x" }, "i", "d") === null);
  ok("имя обрезается по 160", normProduct({ name: "я".repeat(400) }, "i", "d").name.length === 160);
  ok("ключ имени схлопывает регистр и пробелы", nameKey(" ОСП   9 мм ") === nameKey("осп 9 мм"));

  const plan = planAdd([{ name: "А1 брус" }, { name: "а1 БРУС" }, { name: "" }], [{ id: "e", name: "Другой" }]);
  ok("planAdd: один к заведению, два в отказ", plan.add.length === 1 && plan.skip.length === 2, JSON.stringify(plan));
}

console.log(failed ? "\n" + failed + " проверок упало" : "\nВсе проверки прошли");
process.exit(failed ? 1 : 0);
