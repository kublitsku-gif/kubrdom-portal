#!/usr/bin/env node
// MCP-сервер портала (src/mcp.js через настоящий worker.fetch, D1 замокан).
//
// Проверяем ровно то, что может тихо сломаться и дорого стоить:
//   • эндпоинт закрыт: без секрета его нет вовсе, с чужим токеном — 401;
//   • это действительно JSON-RPC: initialize/tools/list/tools/call и коды ошибок;
//   • тулы считают ТЕМИ ЖЕ модулями, что панель и бот (просрочка, «не куплено»);
//   • финансовые разделы не читаются НИ ОДНИМ запросом — это обещание безопасности,
//     а не деталь реализации, и его надо держать под тестом.
import worker from "../src/worker.js";

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra ? "\n      " + extra : ""));
};

const MCP_TOKEN = "mcp-secret-token";
const FIN_KEYS = ["finSalaries", "finTxns", "finContracts", "finExtraWorks"];

// ─── Данные ──────────────────────────────────────────────────────────────────
const OBJECTS = [{
  id: "o1", name: "Баня Олег Акиньшино",
  stages: [
    {
      id: "s1", n: "ЭТАП 1 Каркас", planStart: "2020-01-01", planEnd: "2020-02-01",
      works: [
        { id: "w1", n: "Обшивка стен", cost: 30000, done: true, doneAt: "2020-01-20", mats: [{ id: "m1", n: "Доска 45x145", cost: 1000, qty: 10, store: "Леруа" }] },
        { id: "w2", n: "Кровля", cost: 70000, mats: [{ id: "m2", n: "Профлист", cost: 2000, qty: 20, store: "Металлбаза" }] },
      ],
    },
    { id: "s2", n: "ЭТАП 2 Отделка", works: [{ id: "w3", n: "Полы", cost: 20000, mats: [] }] },
  ],
}];
const PURCHASES = [{ id: "p1", date: "2020-01-10", store: "Леруа", objId: "o1", items: [{ id: "pi1", needId: "m1", name: "Доска", qty: 10, price: 1000, gotQty: 10 }] }];
const AUDIT_ROW = { id: 7, ts: 1750000000000, uid: "u1", uname: "Юрий", section: "objects", action: "edit", title: "Баня › ЭТАП 1 › Кровля", field: "cost", old_val: "60000", new_val: "70000", cnt: 1 };

// ─── Мок D1 ──────────────────────────────────────────────────────────────────
// Пишем в sqlLog каждый запрос: по нему же проверяем, что финансов никто не спрашивал.
function makeDB(sqlLog) {
  const sections = { objects: OBJECTS, purchases: PURCHASES, purchased: {}, arrived: {} };
  const run = (sql, args) => {
    sqlLog.push({ sql, args });
    if (/CREATE (TABLE|INDEX)/.test(sql)) return { results: [] };
    if (/FROM audit_log/.test(sql)) return { results: [AUDIT_ROW] };
    if (/SELECT work_id, data FROM work_states/.test(sql)) {
      return { results: args.filter((k) => sections[k] !== undefined).map((k) => ({ work_id: k, data: JSON.stringify(sections[k]) })) };
    }
    return { results: [] };
  };
  const prepare = (sql) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      async all() { return run(sql, args); },
      async run() { return run(sql, args); },
      async first() { const r = run(sql, args); return (r.results || [])[0] || null; },
    });
    return make([]);
  };
  return { prepare, batch: async (sts) => sts };
}

const sqlLog = [];
const ENV = { DB: makeDB(sqlLog), ADMIN_TOKEN: "master-secret", MCP_TOKEN };

const post = (body, { token = MCP_TOKEN, env = ENV, method = "POST" } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return worker.fetch(new Request("https://portal.kubrdom.ru/api/mcp", {
    method, headers, body: method === "POST" ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {} });
};
let seq = 0;
const call = async (name, args = {}) => {
  const r = await post({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } });
  const j = await r.json();
  return { status: r.status, json: j, text: j.result && j.result.content ? j.result.content[0].text : "" };
};

console.log("MCP: доступ");
{
  const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { env: { DB: ENV.DB, ADMIN_TOKEN: "x" } });
  ok("без секрета MCP_TOKEN эндпоинта нет (404)", r.status === 404, "получено " + r.status);
}
{
  const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { token: "wrong-token" });
  ok("чужой Bearer → 401", r.status === 401 && /Bearer/.test(r.headers.get("WWW-Authenticate") || ""), "получено " + r.status);
}
{
  const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize" }, { token: ENV.ADMIN_TOKEN });
  ok("ADMIN_TOKEN панели сюда не пускает", r.status === 401, "получено " + r.status);
}
{
  const r = await post(null, { method: "GET" });
  ok("GET → 405 (потока нет намеренно)", r.status === 405 && r.headers.get("Allow") === "POST, OPTIONS");
}

console.log("MCP: протокол");
{
  const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const j = await r.json();
  ok("initialize отдаёт версию и serverInfo",
    j.result && j.result.protocolVersion === "2025-06-18" && j.result.serverInfo.name === "kubrdom-portal",
    JSON.stringify(j).slice(0, 160));
  ok("объявлены tools", !!(j.result && j.result.capabilities && j.result.capabilities.tools));
}
{
  const r = await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  const j = await r.json();
  ok("неизвестную версию не эхаем, отдаём свою", j.result.protocolVersion === "2025-06-18", j.result.protocolVersion);
}
{
  const r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  ok("уведомление без id → 202 без тела", r.status === 202);
}
{
  const r = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  const j = await r.json();
  const names = (j.result.tools || []).map((t) => t.name).sort();
  ok("tools/list отдаёт шесть тулов", names.length === 6, names.join(","));
  ok("у каждого тула есть inputSchema", (j.result.tools || []).every((t) => t.inputSchema && t.inputSchema.type === "object"));
  ok("тулов на запись нет", !names.some((n) => /add|set|save|delete|update|post/i.test(n)), names.join(","));
}
{
  const r = await post({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  const j = await r.json();
  ok("неизвестный метод → -32601", j.error && j.error.code === -32601);
}
{
  const r = await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "нет_такого" } });
  const j = await r.json();
  ok("неизвестный тул → -32602", j.error && j.error.code === -32602);
}
{
  const r = await worker.fetch(new Request("https://portal.kubrdom.ru/api/mcp", {
    method: "POST", headers: { Authorization: "Bearer " + MCP_TOKEN, "Content-Type": "application/json" }, body: "{не json",
  }), ENV, { waitUntil() {} });
  const j = await r.json();
  ok("битый JSON → -32700", j.error && j.error.code === -32700);
}

console.log("MCP: тулы считают то же, что панель");
{
  const { text } = await call("objects_list");
  ok("объект в списке", /Баня Олег Акиньшино \[o1\]/.test(text), text);
  ok("работы посчитаны 1/3", /работы 1\/3/.test(text), text);
  ok("видно, что не куплено (профлист 20×2000)", /не куплено 1 поз\. на 40\s?000/.test(text.replace(/ /g, " ")), text);
}
{
  const { text } = await call("stages_attention");
  ok("просроченный этап найден", /просрочен .* · Баня Олег Акиньшино · ЭТАП 1 Каркас/.test(text), text);
  ok("этап без плана не считается горящим", !/ЭТАП 2/.test(text), text);
}
{
  const { text } = await call("supply_needs");
  ok("к закупке — профлист", /Профлист.*не куплено, нужно ещё 20/.test(text), text);
  ok("купленная доска в списке не висит", !/Доска/.test(text), text);
  const one = await call("supply_needs", { object: "олег акиньшино" });
  ok("объект ищется частью имени без регистра", /Профлист/.test(one.text), one.text);
  const none = await call("supply_needs", { object: "нет такого" });
  ok("несуществующий объект — понятный ответ, не падение", /не найден/.test(none.text), none.text);
}
{
  const { text } = await call("object_get", { object: "o1", detail: "materials" });
  ok("по id находится", /Баня Олег Акиньшино/.test(text), text);
  ok("этап показан с планом и состоянием", /ЭТАП 1 Каркас \(план 2020-01-01 → 2020-02-01\) — просрочен/.test(text), text);
  ok("работы и материалы видны при detail=materials", /Кровля/.test(text) && /Профлист ×20/.test(text), text);
  const brief = await call("object_get", { object: "o1" });
  ok("по умолчанию работ нет — только этапы", !/Кровля/.test(brief.text), brief.text);
}
{
  const { text } = await call("audit_recent", { limit: 5 });
  ok("история читается и разворачивается в «было → стало»", /Юрий/.test(text) && /60000 → 70000/.test(text), text);
}

console.log("MCP: границы");
{
  const asked = sqlLog.flatMap((e) => e.args || []).map(String);
  const leaked = FIN_KEYS.filter((k) => asked.indexOf(k) >= 0);
  ok("финансовые разделы не запрашивались ни разу", leaked.length === 0, leaked.join(","));
  ok("записи в work_states не было", !sqlLog.some((e) => /INSERT INTO work_states|DELETE FROM work_states/.test(e.sql)));
}

console.log(failed ? "\n✘ провалено проверок: " + failed : "\n✓ все проверки прошли");
process.exit(failed ? 1 : 0);
