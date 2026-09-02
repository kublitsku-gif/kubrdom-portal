#!/usr/bin/env node
// Кто читает чертёж: Claude или Kimi (src/worker.js, ручка /api/plan-read).
//
// Ключ Claude на воркере может быть не задан или протухнуть — и тогда чтение
// чертежа мертво целиком, хотя всё остальное работает. Здесь сторожим выбор
// читателя: настроен один — читает он; настроены оба — читает Claude, а на
// «ключ не тот» подхватывает Kimi; сказано явно — слушаемся без самодеятельности.
// И чей это ответ, всегда написано: человек сверяет метры и должен знать, чьи они.
import worker from "../src/worker.js";

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra ? "\n      " + extra : ""));
};

const TOKEN = "master-secret";
const CTX = { waitUntil() {} };

const READ = {
  length: 11952, width: 2352, height: 2500,
  bays: [{ name: "Санузел", len: 2000 }, { name: "Кухня-гостиная", len: 6400 }, { name: "Спальня", len: 3200 }],
  walls: [], rooms: [], openings: [], notes: "",
};

// R2 с одним листом: воркер читает байты сам, а нам важно, куда он их отправит.
function makeFiles(type = "image/png") {
  return {
    get: async () => ({
      httpMetadata: { contentType: type },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  };
}

// Мок сети: запоминает, куда ушёл запрос, и отвечает за названного провайдера.
function net(plan) {
  const seen = [];
  const fetchMock = async (url, init) => {
    const u = String(url);
    seen.push({ url: u, headers: (init && init.headers) || {}, body: JSON.parse((init && init.body) || "{}") });
    const who = u.indexOf("anthropic.com") >= 0 ? "claude" : "kimi";
    const r = plan[who];
    if (typeof r === "function") return r();
    return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "Content-Type": "application/json" } });
  };
  return { seen, fetchMock };
}

const CLAUDE_OK = { status: 200, body: { model: "claude-opus-5", content: [{ type: "tool_use", name: "plan_read", input: READ }] } };
const KIMI_OK = { status: 200, body: { model: "kimi-latest", choices: [{ message: { tool_calls: [{ function: { name: "plan_read", arguments: JSON.stringify(READ) } }] } }] } };
const BAD_KEY = { status: 401, body: { error: { message: "invalid x-api-key" } } };

async function read(env, plan, type) {
  const { seen, fetchMock } = net(plan);
  const real = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const r = await worker.fetch(
      new Request("https://portal.kubrdom.ru/api/plan-read", {
        method: "POST",
        headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ keys: ["plan.png"], names: { "plan.png": "план.png" } }),
      }),
      Object.assign({ ADMIN_TOKEN: TOKEN, FILES: makeFiles(type) }, env), CTX);
    return { j: await r.json(), status: r.status, seen };
  } finally { globalThis.fetch = real; }
}

console.log("Выбор читателя");
{
  const a = await read({ CLAUDE_API_KEY: "k" }, { claude: CLAUDE_OK });
  ok("настроен только Claude — читает он", a.j.success && a.j.provider === "Claude", JSON.stringify(a.j).slice(0, 200));
  ok("и ушло в Anthropic", a.seen[0].url.indexOf("api.anthropic.com") >= 0);
  ok("метры доехали", a.j.plan.bays[1].len === 6400);

  const b = await read({ KIMI_API_KEY: "k" }, { kimi: KIMI_OK });
  ok("настроен только Kimi — читает он", b.j.success && b.j.provider === "Kimi");
  ok("и ушло в Moonshot", b.seen[0].url.indexOf("/chat/completions") >= 0);
  ok("ключ — заголовком Authorization", String(b.seen[0].headers.Authorization || "").indexOf("Bearer ") === 0);
  ok("схема та же, инструмент обязателен", b.seen[0].body.tool_choice.function.name === "plan_read");

  const c = await read({ CLAUDE_API_KEY: "k", KIMI_API_KEY: "k" }, { claude: CLAUDE_OK, kimi: KIMI_OK });
  ok("настроены оба — первым Claude", c.j.provider === "Claude" && c.seen.length === 1);
}

console.log("Ключ не тот");
{
  // Ровно тот случай, из-за которого всё это и написано: «invalid x-api-key».
  const a = await read({ CLAUDE_API_KEY: "bad", KIMI_API_KEY: "k" }, { claude: BAD_KEY, kimi: KIMI_OK });
  ok("Claude отказал по ключу — дочитал Kimi", a.j.success && a.j.provider === "Kimi", JSON.stringify(a.j).slice(0, 200));
  ok("и это видно по двум запросам", a.seen.length === 2);

  const b = await read({ CLAUDE_API_KEY: "bad" }, { claude: BAD_KEY });
  ok("без второго ключа — честная ошибка", !b.j.success && /invalid x-api-key/.test(b.j.error));
  ok("и сказано, чей это ответ", /^Claude:/.test(b.j.error));

  // Явный выбор — без самодеятельности: сказано «Kimi», значит Kimi.
  const c = await read({ PLAN_PROVIDER: "kimi", CLAUDE_API_KEY: "k", KIMI_API_KEY: "k" }, { kimi: KIMI_OK });
  ok("PLAN_PROVIDER=kimi слушаемся", c.j.provider === "Kimi" && c.seen[0].url.indexOf("moonshot") >= 0);
  const d = await read({ PLAN_PROVIDER: "kimi", CLAUDE_API_KEY: "k" }, {});
  ok("и говорим, если ключа под это нет", !d.j.success && /KIMI_API_KEY/.test(d.j.error));
}

console.log("Чего не умеем");
{
  const a = await read({}, {});
  ok("без ключей — понятная настройка, а не 500", a.status === 400 && /CLAUDE_API_KEY или KIMI_API_KEY/.test(a.j.error));
  // У OpenAI-совместимого протокола нет блока «документ»: PDF туда слать нечего.
  const b = await read({ KIMI_API_KEY: "k" }, {}, "application/pdf");
  ok("PDF для Kimi — объяснение, а не пустой ответ", !b.j.success && /снимок листа/.test(b.j.error), b.j.error);
  ok("сеть при этом не дёргалась", b.seen.length === 0);
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : "\n✓ все проверки прошли");
process.exit(failed ? 1 : 0);
