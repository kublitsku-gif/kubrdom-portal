#!/usr/bin/env node
// API состояния панели (src/worker.js): версия снимка и запись по разделам.
//
// Гоняем настоящий worker.fetch с моком D1. Ради этих двух вещей:
//   • опрос живых правок должен стоить одно число, а не мегабайтный снимок;
//   • сторож оптимистичной блокировки должен смотреть ТОЛЬКО на присланные разделы,
//     иначе правка снабженца отклоняет сохранение финансиста и наоборот.
import worker from "../src/worker.js";

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra ? "\n      " + extra : ""));
};

const TOKEN = "master-secret";

// Мок D1 поверх обычной Map: (storage_key, work_id) → {data, updated_at}.
function makeDB(seed = {}) {
  const rows = new Map();
  Object.entries(seed).forEach(([k, v]) => rows.set("admin_panel|" + k, { work_id: k, data: JSON.stringify(v.data), updated_at: v.at }));
  const log = [];
  const run = (sql, args) => {
    log.push({ sql, args });
    if (/CREATE (TABLE|INDEX)|INSERT INTO audit_log/.test(sql)) return { results: [] };

    if (/SELECT MAX\(updated_at\)/.test(sql)) {
      const key = args[0];
      let v = 0;
      for (const r of rows.values()) if (r.updated_at > v && rows.has(key + "|" + r.work_id)) v = r.updated_at;
      return { results: [{ v: v || null }] };
    }
    if (/SELECT work_id, data, updated_at FROM work_states/.test(sql)) {
      return { results: [...rows.values()].map((r) => ({ work_id: r.work_id, data: r.data, updated_at: r.updated_at })) };
    }
    if (/SELECT work_id, data FROM work_states/.test(sql)) {
      const want = args.slice(1);
      return { results: [...rows.values()].filter((r) => want.indexOf(r.work_id) >= 0).map((r) => ({ work_id: r.work_id, data: r.data })) };
    }
    // Запись: повторяем сторожа base — отклоняем, если ЛЮБОЙ из записываемых разделов
    // новее base. Именно ради скоупа этот мок и написан.
    if (/INSERT INTO work_states/.test(sql)) {
      const [, workId, data, now] = args;
      const key = args[0] + "|" + workId;
      if (args.length > 4) {
        const base = args[5], ids = args.slice(7);
        const stale = [...rows.values()].some((r) => ids.indexOf(r.work_id) >= 0 && r.updated_at > base && r.updated_at !== now);
        if (stale) return { results: [], meta: { changes: 0 } };
      }
      rows.set(key, { work_id: workId, data, updated_at: now });
      return { results: [], meta: { changes: 1 } };
    }
    return { results: [] };
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

const CTX = { waitUntil() {} };
const call = async (db, path, init = {}) => {
  const r = await worker.fetch(new Request("https://portal.kubrdom.ru" + path, init), { DB: db, ADMIN_TOKEN: TOKEN }, CTX);
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const auth = (extra = {}) => Object.assign({ "X-Admin-Token": TOKEN }, extra);

// ── 1. Версия снимка ─────────────────────────────────────────────────────────
{
  console.log("Версия снимка");
  const { db } = makeDB({
    objects: { data: [{ id: "o1" }], at: 1700 },
    finTxns: { data: [], at: 2500 },
  });
  const v = await call(db, "/api/state/admin_panel/version", { headers: auth() });
  ok("версия = максимум updated_at", v.status === 200 && v.body.version === 2500, JSON.stringify(v.body));
  ok("ответ не тащит данные", v.body.items === undefined && JSON.stringify(v.body).length < 120, JSON.stringify(v.body));

  const empty = await call(db, "/api/state/unknown_key/version", { headers: auth() });
  ok("незнакомый ключ — нулевая версия, а не ошибка", empty.status === 200 && empty.body.version === 0, JSON.stringify(empty.body));

  const noAuth = await call(db, "/api/state/admin_panel/version", {});
  ok("без токена не отдаём", noAuth.status === 401, String(noAuth.status));

  const full = await call(db, "/api/state/admin_panel", { headers: auth() });
  ok("обычный маршрут состояния не сломан", full.status === 200 && Array.isArray(full.body.items) && full.body.items.length === 2,
    JSON.stringify(full.body).slice(0, 120));
}

// ── 2. Сторож пишет только присланные разделы ────────────────────────────────
{
  console.log("Скоуп оптимистичной блокировки");
  const { db, rows } = makeDB({
    objects: { data: [{ id: "o1" }], at: 1000 },
    finTxns: { data: [{ id: "t1" }], at: 5000 },   // финансист сохранил ПОЗЖЕ нашего base
  });
  const body = (items, base) => ({ method: "POST", headers: auth({ "Content-Type": "application/json" }), body: JSON.stringify({ items, base }) });

  // Снабженец правит только материалы, его base — 1000 (финансовую правку он не видел).
  const narrow = await call(db, "/api/state/admin_panel", body([{ work_id: "objects", data: [{ id: "o1", n: 1 }] }], 1000));
  ok("правка чужого раздела не мешает сохранению", narrow.status === 200 && narrow.body.success === true,
    "именно это ломалось, когда панель слала все разделы разом: " + JSON.stringify(narrow.body));
  ok("раздел записан", JSON.parse(rows.get("admin_panel|objects").data)[0].n === 1);

  // А вот запись РАЗДЕЛА, который кто-то обновил после base, обязана отклониться.
  const clash = await call(db, "/api/state/admin_panel", body([{ work_id: "finTxns", data: [] }], 1000));
  ok("устаревшая правка того же раздела отклонена", clash.status === 409 && clash.body.conflict === true, JSON.stringify(clash.body));
  ok("в ответе свежий снимок для слияния", Array.isArray(clash.body.items) && clash.body.items.length === 2);
  ok("данные не затёрты", JSON.parse(rows.get("admin_panel|finTxns").data).length === 1);
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : "\n✓ все проверки прошли");
process.exit(failed ? 1 : 0);
