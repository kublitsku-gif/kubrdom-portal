// ─── MCP-СЕРВЕР ПОРТАЛА (ТОЛЬКО ЧТЕНИЕ) ──────────────────────────────────────
// POST /api/mcp — Model Context Protocol поверх Streamable HTTP, без состояния.
// Даёт ИИ-клиентам (Claude Code, Claude Desktop, коннектор claude.ai) спрашивать портал
// напрямую: «что просрочено», «что докупить», «кто что менял».
//
// Почему /api/mcp, а НЕ /mcp: functions/api/[[path]].js проксирует в Worker только /api/*,
// остальное на portal.kubrdom.ru отдаёт Pages. На /mcp пришёл бы 404 своего домена, и
// остался бы только *.workers.dev, который в РФ режется по SNI. Путь тут — часть обхода.
//
// Почему считаем НА СЕРВЕРЕ, а не отдаём снимок: раздел objects — сотни килобайт, и
// «какие этапы горят» из него клиент вычислял бы, затащив всё в контекст. Здесь тот же
// stagesNeedingAttention, что зовёт крон Telegram-напоминаний, и наружу уходит десяток строк.
//
// Почему только чтение: снимок панели пишется целиком разделами со сторожем base, и
// серверной проверки прав по work_id у записи нет (панель — доверенный клиент). Пока её
// нет, писать через открытый наружу токен нельзя: это была бы вторая дверь в тот же обход.
// Финансовые разделы (finSalaries/finTxns/finContracts/finExtraWorks) не читаются ВООБЩЕ —
// ни один тул их не запрашивает, поэтому утечь через MCP им неоткуда.

import { stagesNeedingAttention, objWorstStage, stageSchedule } from "./stages.js";
import { needStatus, needState, needQty } from "./supply.js";
import { readAudit } from "./audit.js";
import { loadState, mskToday, money } from "./reminders.js";
import { objStats } from "./botview.js";

// Версии протокола, на которые отвечаем. Клиент присылает свою в initialize; если она из
// списка — эхо, иначе отдаём свою последнюю (так велит спека: договориться на общей).
const MCP_VERSIONS = ["2026-07-28", "2025-06-18", "2025-03-26"];
const MCP_LATEST = "2025-06-18";
const SERVER_INFO = { name: "kubrdom-portal", title: "Портал КубрДом", version: "1.0.0" };

// Потолок ответа тула. Смысл сервера — не таскать мегабайты в контекст, и тул, который
// раздулся, должен обрезаться с подсказкой сузить запрос, а не молча съесть окно.
const MAX_TEXT = 20000;
const AUDIT_MAX = 100;
const SUPPLY_MAX = 60;

const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function httpJson(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...MCP_CORS, ...extra },
  });
}
const rpcOk = (id, result) => httpJson({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => httpJson({ jsonrpc: "2.0", id, error: { code, message } });

// Сравнение токенов в постоянное время — как safeEqual в worker.js: длину и префикс
// секрета нельзя сливать через тайминг.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Форматирование ──────────────────────────────────────────────────────────
const STATE_RU = {
  overdue: "просрочен", notStarted: "не начат", soon: "срок близко",
  lateDone: "закрыт с опозданием", go: "идёт в сроке", done: "закрыт", none: "плана нет",
};
const NEED_RU = { none: "не куплено", partial: "куплено частично", bought: "куплено, не приехало", partialGot: "приехало частично", got: "на объекте" };

function clip(text) {
  if (text.length <= MAX_TEXT) return text;
  return text.slice(0, MAX_TEXT) + "\n\n… обрезано (" + text.length
    + " символов). Сузьте запрос: конкретный объект, этап или limit.";
}

// Объект по имени или id. Имя — подстрокой без регистра: человек говорит «Олег Тула»,
// а в портале «Баня Александр  Тула» с двойным пробелом — точное сравнение тут бесполезно.
function findObject(objects, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const byId = (objects || []).find(function (o) { return String(o.id) === q; });
  if (byId) return byId;
  const words = q.split(/\s+/);
  return (objects || []).find(function (o) {
    const name = String(o.name || "").toLowerCase();
    return words.every(function (w) { return name.indexOf(w) >= 0; });
  }) || null;
}

function objLine(st, o, today) {
  const s = objStats(st, o);
  const worst = objWorstStage(o, today);
  const parts = ["работы " + s.done + "/" + s.works + " (" + s.pct + "% по деньгам)"];
  if (worst) {
    parts.push("этап «" + (worst.stage.n || "без имени") + "» — " + STATE_RU[worst.sc.state]
      + (worst.sc.days ? " " + worst.sc.days + " раб. дн" : ""));
  }
  if (s.notBought) parts.push("не куплено " + s.notBought + " поз. на " + money(s.notBoughtSum));
  if (s.notArrived) parts.push("куплено, не принято на объекте: " + s.notArrived + " поз.");
  return "• " + (o.name || "без имени") + " [" + o.id + "]: " + parts.join("; ");
}

// ─── Тулы ────────────────────────────────────────────────────────────────────
async function toolObjectsList(env) {
  const st = await loadState(env, ["objects", "purchases", "purchased", "arrived"]);
  const objects = st.objects || [];
  if (!objects.length) return "В портале нет объектов.";
  const today = mskToday();
  return "Объекты портала (" + objects.length + "), на " + today + ":\n"
    + objects.map(function (o) { return objLine(st, o, today); }).join("\n");
}

async function toolObjectGet(env, args) {
  const st = await loadState(env, ["objects", "purchases", "purchased", "arrived"]);
  const o = findObject(st.objects, args.object);
  if (!o) return "Объект «" + (args.object || "") + "» не найден. Список — тул objects_list.";
  const today = mskToday();
  const detail = args.detail || "stages";
  const out = [objLine(st, o, today), ""];

  (o.stages || []).forEach(function (s) {
    const sc = stageSchedule(s, today);
    const plan = sc.plan.start || sc.plan.end ? " (план " + (sc.plan.start || "?") + " → " + (sc.plan.end || "?") + ")" : "";
    out.push("▸ " + (s.n || "этап") + plan + " — " + STATE_RU[sc.state]
      + (sc.days ? " " + sc.days + " раб. дн" : "") + "; работы " + sc.fact.done + "/" + sc.fact.total);
    if (detail === "stages") return;
    (s.works || []).forEach(function (w) {
      out.push("    " + (w.done ? "✓" : "·") + " " + (w.n || "работа")
        + (w.cost ? " — " + money(w.cost) : "")
        + (detail === "materials" && (w.mats || []).length ? "\n        мат.: " + w.mats.map(function (m) {
          return (m.n || "?") + " ×" + needQty(m) + (m.cost ? " по " + money(m.cost) : "");
        }).join("; ") : ""));
    });
  });
  return out.join("\n");
}

async function toolStagesAttention(env) {
  const st = await loadState(env, ["objects"]);
  const today = mskToday();
  const hot = stagesNeedingAttention(st.objects || [], today);
  if (!hot.length) return "На " + today + " горящих этапов нет: всё либо в сроке, либо закрыто.";
  return "Этапы, требующие внимания на " + today + " (" + hot.length + "):\n"
    + hot.map(function (x) {
      return "• " + STATE_RU[x.sc.state] + (x.sc.days ? " " + x.sc.days + " раб. дн" : "")
        + " · " + (x.obj.name || "объект") + " · " + (x.stage.n || "этап")
        + " (план " + (x.sc.plan.start || "?") + " → " + (x.sc.plan.end || "?")
        + ", закрыто " + x.sc.fact.done + "/" + x.sc.fact.total + ")";
    }).join("\n");
}

// Что докупить. Считаем тем же needStatus/needState, что панель и бот: «не куплено» на
// экране снабженца и «не куплено» здесь обязаны совпадать до позиции.
async function toolSupplyNeeds(env, args) {
  const st = await loadState(env, ["objects", "purchases", "purchased", "arrived"]);
  let objects = st.objects || [];
  if (args.object) {
    const one = findObject(objects, args.object);
    if (!one) return "Объект «" + args.object + "» не найден. Список — тул objects_list.";
    objects = [one];
  }
  const rows = [];
  objects.forEach(function (o) {
    (o.stages || []).forEach(function (s) {
      (s.works || []).forEach(function (w) {
        (w.mats || []).forEach(function (m) {
          const stt = needStatus(m.id, m, st.purchases || [], st.purchased || {}, st.arrived || {});
          const state = needState(stt);
          if (state === "got" || state === "bought") return;      // уже куплено/на объекте
          const left = stt.want - stt.bought;
          rows.push({
            sum: left * (Number(m.cost) || 0), left: left, state: state,
            text: "• " + (o.name || "объект") + " · " + (m.n || "материал")
              + ": " + NEED_RU[state] + ", нужно ещё " + left
              + (m.cost ? " на " + money(left * Number(m.cost)) : "")
              + (m.store ? " (" + m.store + ")" : ""),
          });
        });
      });
    });
  });
  if (!rows.length) return "Незакрытых потребностей нет" + (args.object ? " по этому объекту." : ".");
  rows.sort(function (a, b) { return b.sum - a.sum; });
  const limit = Math.min(Math.max(Number(args.limit) || SUPPLY_MAX, 1), SUPPLY_MAX);
  const total = rows.reduce(function (a, r) { return a + r.sum; }, 0);
  const head = "К закупке " + rows.length + " позиций на " + money(total) + ":";
  const tail = rows.length > limit ? "\n… и ещё " + (rows.length - limit) + " позиций подешевле" : "";
  return head + "\n" + rows.slice(0, limit).map(function (r) { return r.text; }).join("\n") + tail;
}

// История правок — поверх готового readAudit (тот же источник, что вкладка «История»).
async function toolAuditRecent(env, args) {
  const url = new URL("https://portal.kubrdom.ru/api/audit");
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), AUDIT_MAX);
  url.searchParams.set("limit", String(limit));
  if (args.section) url.searchParams.set("section", args.section);
  if (args.q) url.searchParams.set("q", args.q);
  const days = Number(args.since_days);
  if (isFinite(days) && days > 0) url.searchParams.set("from", String(Date.now() - days * 86400000));

  const res = await readAudit(env, url);
  const rows = res.rows || [];
  if (!rows.length) return "Записей в истории по такому фильтру нет.";
  return rows.map(function (r) {
    const when = new Date(r.ts + 3 * 3600000).toISOString().replace("T", " ").slice(0, 16);
    const val = r.new_val ? ": " + String(r.old_val || "—") + " → " + String(r.new_val) : "";
    return "• " + when + " · " + (r.uname || r.uid) + " · " + r.action + " · "
      + (res.sections[r.section] || r.section) + " · " + (r.title || "") + (r.field ? " [" + r.field + "]" : "") + val
      + (r.cnt > 1 ? " (правок: " + r.cnt + ")" : "");
  }).join("\n");
}

async function toolPriceCheck(deps, args) {
  if (typeof deps.getPrice !== "function") return "Проверка цены недоступна.";
  const r = await deps.getPrice(String(args.url || ""));
  return r.success ? "Цена: " + money(r.price) : "Не вышло: " + r.error;
}

const TOOLS = [
  {
    name: "objects_list",
    title: "Объекты портала",
    description: "Список объектов КубрДом одной строкой на каждый: готовность работ, худший этап по срокам, сколько позиций не куплено. Начинать отсюда: тут видны имена и id для остальных тулов.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: function (env) { return toolObjectsList(env); },
  },
  {
    name: "object_get",
    title: "Объект подробно",
    description: "Один объект по имени (можно частью, без регистра) или id: этапы с планом и состоянием, при detail=works — работы, при detail=materials — ещё и материалы.",
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", description: "Имя объекта или его часть, либо id" },
        detail: { type: "string", enum: ["stages", "works", "materials"], description: "Глубина ответа, по умолчанию stages" },
      },
      required: ["object"], additionalProperties: false,
    },
    run: function (env, args) { return toolObjectGet(env, args); },
  },
  {
    name: "stages_attention",
    title: "Горящие этапы",
    description: "Этапы, о которых стоит знать сейчас: просрочены, не начаты вовремя или срок в пределах двух рабочих дней. Та же выборка, что уходит в Telegram утренним напоминанием.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: function (env) { return toolStagesAttention(env); },
  },
  {
    name: "supply_needs",
    title: "Что докупить",
    description: "Незакрытые потребности в материалах по всем объектам или по одному, от дорогих к дешёвым: что, сколько ещё нужно, на какую сумму и в каком магазине.",
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", description: "Ограничить одним объектом (имя или id)" },
        limit: { type: "integer", minimum: 1, maximum: SUPPLY_MAX, description: "Сколько позиций показать, по умолчанию 60" },
      },
      additionalProperties: false,
    },
    run: function (env, args) { return toolSupplyNeeds(env, args); },
  },
  {
    name: "audit_recent",
    title: "История правок",
    description: "Кто что менял в портале: время (МСК), сотрудник, раздел, что стало вместо чего. Фильтры: раздел, поиск по заголовку, глубина в днях.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: AUDIT_MAX, description: "Сколько записей, по умолчанию 30" },
        section: { type: "string", description: "Раздел снимка: objects, estimates, contractDocs, purchases…" },
        q: { type: "string", description: "Поиск по заголовку записи или имени сотрудника" },
        since_days: { type: "integer", minimum: 1, description: "Только за последние N дней" },
      },
      additionalProperties: false,
    },
    run: function (env, args) { return toolAuditRecent(env, args); },
  },
  {
    name: "price_check",
    title: "Цена по ссылке",
    description: "Достать цену товара со страницы магазина по ссылке (тот же разбор, что кнопка проверки цены в снабжении).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Ссылка на карточку товара" } },
      required: ["url"], additionalProperties: false,
    },
    run: function (env, args, deps) { return toolPriceCheck(deps, args); },
  },
];

const toolDescriptor = (t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema });

async function callTool(env, deps, params) {
  const tool = TOOLS.find(function (t) { return t.name === (params && params.name); });
  if (!tool) return { error: { code: -32602, message: "Нет такого тула: " + ((params && params.name) || "") } };
  try {
    const text = await tool.run(env, (params && params.arguments) || {}, deps);
    return { result: { content: [{ type: "text", text: clip(String(text)) }] } };
  } catch (e) {
    // Ошибка ВНУТРИ тула — это результат с isError, а не ошибка протокола: клиент должен
    // показать её модели и дать переспросить, а не считать сервер сломанным.
    return { result: { content: [{ type: "text", text: "Ошибка тула: " + String((e && e.message) || e) }], isError: true } };
  }
}

async function dispatch(env, deps, msg) {
  const id = msg && msg.id !== undefined ? msg.id : null;
  const method = msg && msg.method;

  if (method === "initialize") {
    const want = msg.params && msg.params.protocolVersion;
    return rpcOk(id, {
      protocolVersion: MCP_VERSIONS.indexOf(want) >= 0 ? want : MCP_LATEST,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: "Портал строительной компании КубрДом: объекты, этапы, снабжение, история правок. Только чтение. Имена объектов ищутся по части строки — сначала objects_list.",
    });
  }
  if (method === "ping") return rpcOk(id, {});
  if (method === "tools/list") return rpcOk(id, { tools: TOOLS.map(toolDescriptor) });
  if (method === "tools/call") {
    const out = await callTool(env, deps, msg.params);
    return out.error ? rpcErr(id, out.error.code, out.error.message) : rpcOk(id, out.result);
  }
  return rpcErr(id, -32601, "Метод не поддерживается: " + String(method));
}

// ─── Точка входа ─────────────────────────────────────────────────────────────
export async function mcpFetch(request, env, deps = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS });

  // Fail-closed: пока секрет не задан, эндпоинта как будто нет. Не «пускаем всех» и не
  // подсказываем 401-ом, что тут что-то есть.
  if (!env.MCP_TOKEN) return httpJson({ error: "Not found" }, 404);

  const hdr = request.headers.get("Authorization") || "";
  const token = hdr.indexOf("Bearer ") === 0 ? hdr.slice(7).trim() : "";
  if (!safeEqual(token, env.MCP_TOKEN)) {
    return httpJson({ error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="kubrdom-mcp"' });
  }

  // GET/SSE не поддерживаем намеренно: сервер без состояния, серверных уведомлений нет,
  // а поток держал бы соединение впустую.
  if (request.method !== "POST") return httpJson({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });

  let msg;
  try { msg = await request.json(); } catch { return rpcErr(null, -32700, "Тело не разобралось как JSON"); }
  if (Array.isArray(msg)) return rpcErr(null, -32600, "Пакетные запросы не поддерживаются");
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return rpcErr(null, -32600, "Ожидается JSON-RPC 2.0");

  // Уведомление (без id) — ответа не ждут: 202 без тела, как велит транспорт.
  if (msg.id === undefined) return new Response(null, { status: 202, headers: MCP_CORS });

  return await dispatch(env, deps, msg);
}
