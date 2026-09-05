#!/usr/bin/env node
// Прогон MCP-тулов на БОЕВЫХ данных — как tools/render-harness.js для вёрстки панели.
// Мок теста синтетический, а на проде объекты живут по-своему: пустые этапы, работы без
// материалов, старые флаги закупки. Здесь тулы гоняются по настоящему снимку, и заодно
// видно ГЛАВНОЕ число — во сколько раз ответ тула короче сырого раздела.
//
//   npm run mcp:live
//
// Ничего не пишет: ни в D1, ни на диск. Снимок приходит по stdin от wrangler и остаётся
// в памяти процесса.
import worker from "../src/worker.js";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
if (!raw.trim()) {
  console.error("Пусто на stdin. Запускать через npm run mcp:live (wrangler отдаёт снимок в пайп).");
  process.exit(1);
}
const rows = JSON.parse(raw)[0].results;
const sections = {};
for (const r of rows) sections[r.work_id] = r.data;       // строка JSON, как лежит в D1

// Мок D1 только на чтение разделов: больше тулам ничего и не нужно.
const DB = {
  prepare(sql) {
    const make = (args) => ({
      bind: (...a) => make(a),
      async all() {
        if (/SELECT work_id, data FROM work_states/.test(sql)) {
          return { results: args.filter((k) => sections[k] !== undefined).map((k) => ({ work_id: k, data: sections[k] })) };
        }
        return { results: [] };
      },
      async run() { return { results: [] }; },
      async first() { return null; },
    });
    return make([]);
  },
};

const TOKEN = "local-harness-token";
const env = { DB, MCP_TOKEN: TOKEN };
const call = async (name, args = {}) => {
  const r = await worker.fetch(new Request("https://portal.kubrdom.ru/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), env, { waitUntil() {} });
  const j = await r.json();
  return (j.result && j.result.content && j.result.content[0].text) || JSON.stringify(j);
};

const rawChars = Object.values(sections).join("").length;
console.log("Сырые разделы: " + (rawChars / 1024).toFixed(0) + " КБ\n");

const CASES = [["objects_list", {}], ["stages_attention", {}], ["supply_needs", { limit: 8 }]];
for (const [name, args] of CASES) {
  const text = await call(name, args);
  console.log("═══ " + name + " → " + text.length + " символов (в " + Math.round(rawChars / Math.max(text.length, 1)) + " раз меньше сырого снимка) ═══");
  console.log(text.slice(0, 1200) + (text.length > 1200 ? "\n…" : ""));
  console.log("");
}
