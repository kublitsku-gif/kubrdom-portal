#!/usr/bin/env node
// Портал внутри Telegram (Mini App): вход без PIN по подписи Telegram, кнопка «Портал»
// в меню бота и кнопки напоминаний, которые открывают нужный раздел.
//
// Вход гоняем через НАСТОЯЩИЙ worker.fetch с моком D1, подпись initData собираем
// node:crypto независимо от серверного кода: если алгоритм на сервере разойдётся
// с телеграмовским, упадёт первый же кейс, а не прод у бригадира.
import crypto from "node:crypto";
import worker from "../src/worker.js";
import { verifyInitData, TG_INIT_MAX_AGE_S } from "../src/tgauth.js";
import { portalButton, ensureMenuButton, ensureChatUi, tgWebhook, KB_VER } from "../src/notify.js";

const BOT = "123456:TEST-bot-token";
let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra !== undefined ? "\n      " + JSON.stringify(extra) : ""));
};

// Так подписывает Telegram: секрет = HMAC(ключ «WebAppData», токен бота),
// hash = HMAC(секрет, отсортированные «ключ=значение» через перевод строки).
function sign(fields, token = BOT) {
  const dcs = Object.keys(fields).sort().map((k) => k + "=" + fields[k]).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const nowS = () => Math.floor(Date.now() / 1000);
const tgUser = (id) => JSON.stringify({ id, first_name: "Валера", language_code: "ru" });
const initFor = (id, extra = {}) => sign({ auth_date: String(nowS()), query_id: "AAE1", user: tgUser(id), ...extra });

// ── 1. Проверка подписи ──────────────────────────────────────────────────────
{
  console.log("Подпись initData");
  const good = await verifyInitData(initFor(777), BOT, Date.now());
  ok("честная подпись принимается", good.ok === true, good);
  ok("из подписи достаётся id пользователя Telegram", good.tgUserId === "777", good.tgUserId);

  const forged = initFor(777).replace(encodeURIComponent('"id":777'), encodeURIComponent('"id":778'));
  ok("подмена id ломает подпись", (await verifyInitData(forged, BOT, Date.now())).ok === false);
  ok("подпись чужим ботом не принимается", (await verifyInitData(initFor(777), "999:other", Date.now())).ok === false);

  const old = sign({ auth_date: String(nowS() - TG_INIT_MAX_AGE_S - 60), user: tgUser(777) });
  const oldR = await verifyInitData(old, BOT, Date.now());
  ok("устаревшая подпись не пускает (защита от повтора)", oldR.ok === false, oldR);

  const noHash = new URLSearchParams({ auth_date: String(nowS()), user: tgUser(777) }).toString();
  ok("без hash — отказ", (await verifyInitData(noHash, BOT, Date.now())).ok === false);
  ok("пустая строка — отказ", (await verifyInitData("", BOT, Date.now())).ok === false);
  ok("не строка — отказ", (await verifyInitData({ user: 1 }, BOT, Date.now())).ok === false);
  ok("нет токена бота — отказ", (await verifyInitData(initFor(777), "", Date.now())).ok === false);
}

// ── 2. /api/tg-login ─────────────────────────────────────────────────────────
const USERS = [
  { id: "u1", name: "Валера", roles: ["brigadier"], pin: "4271" },
  { id: "u2", name: "Юрий", roles: ["admin"], pin: "1234" },
];
const LINKS = { "777": "u1", "555": "u_fired" };        // chat_id → uid

function makeDB() {
  const stats = { audit: 0 };
  const run = (sql, args) => {
    if (/FROM tg_links/.test(sql)) {
      const uid = LINKS[String(args[0])];
      return { results: uid ? [{ uid }] : [] };
    }
    if (/FROM work_states/.test(sql)) {
      const rows = [
        { work_id: "users", data: JSON.stringify(USERS) },
        { work_id: "rolePermissions", data: JSON.stringify({ brigadier: ["assign"] }) },
      ];
      return { results: rows.filter((r) => sql.indexOf("'" + r.work_id + "'") >= 0 || (args || []).indexOf(r.work_id) >= 0) };
    }
    if (/INSERT INTO audit_log/.test(sql)) stats.audit++;
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
  return { db: { prepare, async batch(list) { return Promise.all(list.map((s) => s.run())); } }, stats };
}
const CTX = { waitUntil() {} };
async function tgLogin(body, env) {
  const r = await worker.fetch(new Request("https://portal.kubrdom.ru/api/tg-login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env, CTX);
  return { status: r.status, body: await r.json() };
}
const payloadOf = (token) => JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));

{
  console.log("Вход через Telegram");
  const { db, stats } = makeDB();
  const env = { DB: db, ADMIN_TOKEN: "master-secret", TG_BOT_TOKEN: BOT };

  const r = await tgLogin({ initData: initFor(777) }, env);
  ok("привязанный сотрудник входит без PIN", r.status === 200 && r.body.success === true, r.body);
  ok("выдан личный токен", typeof r.body.token === "string" && r.body.token.indexOf("v1.") === 0);
  ok("токен именно этого сотрудника", r.body.token && payloadOf(r.body.token).u === "u1", r.body.token && payloadOf(r.body.token));
  ok("бригадир не получает прав админа", r.body.token && payloadOf(r.body.token).adm === false);
  ok("в ответе тот же профиль, что и при входе по PIN", r.body.user && r.body.user.id === "u1" && r.body.user.name === "Валера", r.body.user);
  ok("PIN наружу не отдаётся", r.body.user && r.body.user.pin === undefined, r.body.user);
  ok("вход записан в историю", stats.audit > 0);

  const stranger = await tgLogin({ initData: initFor(888) }, env);
  ok("Telegram без привязки к порталу — отказ", stranger.status === 403 && !stranger.body.token, stranger);
  ok("отказ объясняет, что делать", /Привязать Telegram/.test(stranger.body.error || ""), stranger.body.error);

  const fired = await tgLogin({ initData: initFor(555) }, env);
  ok("привязка осталась, а сотрудника удалили — отказ", fired.status === 403 && !fired.body.token, fired);

  const forged = await tgLogin({ initData: initFor(777, {}).replace("hash=", "hash=0") }, env);
  ok("битая подпись — 401", forged.status === 401 && !forged.body.token, forged);

  const empty = await tgLogin({}, env);
  ok("без initData — 400", empty.status === 400, empty);

  const noBot = await tgLogin({ initData: initFor(777) }, { DB: db, ADMIN_TOKEN: "master-secret" });
  ok("бот не настроен — вход закрыт, а не открыт", noBot.status === 503 && !noBot.body.token, noBot);
}

// ── 3. Кнопки, открывающие портал в Telegram ─────────────────────────────────
{
  console.log("Кнопки портала");
  const kb = portalButton({}, "tab=supply", "Открыть снабжение");
  const b = kb && kb.inline_keyboard && kb.inline_keyboard[0] && kb.inline_keyboard[0][0];
  ok("кнопка открывает мини-приложение, а не браузер", !!(b && b.web_app && !b.url), b);
  ok("подпись кнопки", b && b.text === "Открыть снабжение", b);
  // Раздел передаём в query, а не в #hash: хеш занимает сам Telegram (#tgWebAppData=…).
  ok("раздел передан параметром go", b && b.web_app.url === "https://portal.kubrdom.ru/admin?go=tab%3Dsupply", b && b.web_app.url);
  const kb2 = portalButton({ PUBLIC_BASE_URL: "https://staging.example/" }, "obj=o1&view=receive", "Записать часы");
  ok("адрес берётся из PUBLIC_BASE_URL", kb2.inline_keyboard[0][0].web_app.url === "https://staging.example/admin?go=obj%3Do1%26view%3Dreceive", kb2.inline_keyboard[0][0].web_app.url);

  // Отказ Telegram не должен тонуть молча: без лога не отличить отказ от кэша телефона.
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(" "));
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error_code: 400, description: "Bad Request: test refusal" }) });
  const failedSet = await ensureMenuButton({ TG_BOT_TOKEN: BOT });
  console.error = realError;
  ok("отказ Telegram — кнопка не считается поставленной", failedSet === false, failedSet);
  ok("отказ виден в логе Worker'а с причиной", errors.some((e) => /setChatMenuButton/.test(e) && /test refusal/.test(e)), errors);

  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { json: async () => ({ ok: true, result: true }) };
  };
  await ensureMenuButton({ TG_BOT_TOKEN: BOT });
  await ensureMenuButton({ TG_BOT_TOKEN: BOT });
  const menu = calls.filter((c) => /setChatMenuButton/.test(c.url));
  ok("кнопка меню ставится", menu.length >= 1, calls.map((c) => c.url));
  ok("повторно Telegram не дёргаем", menu.length === 1, menu.length);
  const mb = menu[0] && menu[0].body && menu[0].body.menu_button;
  ok("это кнопка мини-приложения «Портал»", mb && mb.type === "web_app" && mb.text === "Портал", mb);
  ok("ведёт на портал без раздела", mb && mb.web_app && mb.web_app.url === "https://portal.kubrdom.ru/admin", mb);
  ok("ставится всем личным чатам сразу (без chat_id)", menu[0] && menu[0].body && menu[0].body.chat_id === undefined, menu[0] && menu[0].body);
}

// ── 4. Кнопка «Портал» в конкретном чате ─────────────────────────────────────
// Кнопку «по умолчанию» Telegram в приложения не рассылает: телефон узнаёт о ней, когда
// сам обновит сведения о боте. У Юрия после деплоя и /start её так и не было. Кнопка,
// поставленная конкретному чату, приходит в приложение сразу.
{
  console.log("Кнопка «Портал» в конкретном чате");
  const kb = {};                                          // uid → записанная версия
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { json: async () => ({ ok: true, result: true }) };
  };
  const prepare = (sql) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      async first() {
        if (/FROM tg_kb/.test(sql)) return kb[args[0]] ? { ver: kb[args[0]] } : null;
        if (/FROM tg_links/.test(sql)) return String(args[0]) === "317208397" ? { uid: "yuriy" } : null;
        return null;
      },
      async run() { if (/INSERT INTO tg_kb/.test(sql)) kb[args[0]] = args[1]; return { meta: { changes: 1 } }; },
      async all() { return { results: [] }; },
    });
    return make([]);
  };
  const env = { TG_BOT_TOKEN: BOT, DB: { prepare, async batch(list) { return Promise.all(list.map((s) => s.run())); } } };
  const perChat = () => calls.filter((c) => /setChatMenuButton/.test(c.url) && c.body && c.body.chat_id !== undefined);
  const kbMsgs = () => calls.filter((c) => /sendMessage/.test(c.url) && c.body && c.body.reply_markup && c.body.reply_markup.keyboard);

  kb.yuriy = KB_VER;                                      // так запись выглядела после прошлого деплоя
  await ensureChatUi(env, "yuriy", "317208397");
  ok("клавиатура уже свежая — кнопку ставим в его чат", perChat().length === 1 && String(perChat()[0].body.chat_id) === "317208397", perChat());
  ok("это «Портал» мини-приложения", perChat()[0] && perChat()[0].body.menu_button.type === "web_app" && perChat()[0].body.menu_button.text === "Портал", perChat()[0]);
  ok("клавиатуру повторно не шлём", kbMsgs().length === 0, kbMsgs());
  ok("версия чата обновлена", !!kb.yuriy && kb.yuriy !== KB_VER, kb.yuriy);
  calls.length = 0;
  await ensureChatUi(env, "yuriy", "317208397");
  ok("второй раз Telegram не дёргаем", calls.length === 0, calls.map((c) => c.url));

  calls.length = 0;
  await ensureChatUi(env, "inna", "111");
  ok("новичку — и клавиатура, и кнопка в чат", kbMsgs().length === 1 && perChat().some((c) => String(c.body.chat_id) === "111"), calls.map((c) => c.url));

  calls.length = 0;
  delete kb.yuriy;
  const upd = { message: { message_id: 1, chat: { id: 317208397, type: "private" }, from: { id: 317208397 }, text: "/start" } };
  await tgWebhook(env, new Request("https://portal.kubrdom.ru/api/tg/webhook", { method: "POST", body: JSON.stringify(upd) }), {});
  ok("/start сразу ставит кнопку «Портал» в чат", perChat().some((c) => String(c.body.chat_id) === "317208397"), calls.map((c) => c.url));
  ok("после /start чат помечен свежим", !!kb.yuriy && kb.yuriy !== KB_VER, kb.yuriy);
}

console.log("\n" + (failed ? "❌ ПРОВАЛЕНО: " + failed : "✅ Все проверки пройдены"));
process.exit(failed ? 1 : 0);
