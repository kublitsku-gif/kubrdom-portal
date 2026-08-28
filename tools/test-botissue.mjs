// Прогон диалога «❓ Вопрос» без Telegram и без D1: мок базы по подстроке SQL,
// мок fetch по методу Bot API. Проверяем маршрут целиком — от кнопки до тикета в снимке.
import { issueText, issueCallback, issueMedia, issueReplyToAuthor } from "../src/botissue.js";

const store = {
  work_states: {
    objects: [
      { id: "o1", name: "Баня с хозблоком", icon: "🛁", stages: [{ id: "s1", n: "ЭТАП 3", works: [{ id: "w1", n: "Стены парной", done: false }] }] },
      { id: "o2", name: "Дом по безналу", icon: "🏠", stages: [] },
      { id: "o3", name: "Чужой объект", icon: "🏚", stages: [] },
    ],
    contractDocs: [
      { id: "c1", objId: "o1", status: "signed", responsible: ["u_valera"] },
      { id: "c2", objId: "o2", status: "signed", responsible: ["u_valera"] },
      { id: "c3", objId: "o3", status: "signed", responsible: ["u_other"] },
    ],
    users: [
      { id: "u_valera", name: "Валера", roles: ["brigadier"] },
      { id: "u_dima", name: "Дима", roles: ["supply"] },
      { id: "u_admin", name: "Юрий", roles: ["admin"] },
      { id: "u_dasha", name: "Дарья", roles: ["client_mgr"] },
    ],
    issues: [],
  },
  tg_links: [
    { uid: "u_valera", chat_id: "111" },
    { uid: "u_dima", chat_id: "222" },
    { uid: "u_admin", chat_id: "333" },
    { uid: "u_dasha", chat_id: "444" },
  ],
  tg_dialog: {},
};

const sent = [];       // исходящие сообщения бота
const copied = [];     // копии в тему объекта

function stmt(sql) {
  let args = [];
  const api = {
    bind(...a) { args = a; return api; },
    async all() {
      if (sql.includes("FROM work_states")) {
        const keys = args;
        return { results: keys.filter(k => store.work_states[k] !== undefined)
          .map(k => ({ work_id: k, data: JSON.stringify(store.work_states[k]) })) };
      }
      if (sql.includes("FROM tg_links")) return { results: store.tg_links };
      return { results: [] };
    },
    async first() {
      if (sql.includes("FROM tg_dialog")) {
        const st = store.tg_dialog[args[0]];
        return st ? { state: st } : null;
      }
      if (sql.includes("FROM tg_links")) {
        const r = store.tg_links.find(x => x.uid === args[0]);
        return r || null;
      }
      return null;
    },
    async run() {
      if (sql.includes("INSERT INTO work_states")) {
        const wid = sql.includes("'issues'") ? "issues" : sql.includes("'objects'") ? "objects" : null;
        if (wid) store.work_states[wid] = JSON.parse(args[0]);
        return {};
      }
      if (sql.includes("INSERT INTO tg_dialog")) { store.tg_dialog[args[0]] = args[1]; return {}; }
      if (sql.includes("DELETE FROM tg_dialog")) { delete store.tg_dialog[args[0]]; return {}; }
      return {};
    },
  };
  return api;
}
const env = {
  TG_BOT_TOKEN: "T", TG_CHAT_ID: "-1001234567890",
  DB: { prepare: stmt, batch: async (xs) => xs },
};

globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (String(url).includes("/sendMessage")) { sent.push({ chat: body.chat_id, text: body.text, kb: body.reply_markup }); return { json: async () => ({ ok: true }) }; }
  if (String(url).includes("/createForumTopic")) return { json: async () => ({ ok: true, result: { message_thread_id: 77 } }) };
  if (String(url).includes("/copyMessage")) { copied.push(body); return { json: async () => ({ ok: true, result: { message_id: 900 } }) }; }
  return { json: async () => ({ ok: true, result: {} }) };
};

const ROLES = ["brigadier"];
const UID = "u_valera", CHAT = "111";
let fails = 0;
const check = (name, cond, extra) => { console.log((cond ? "  OK  " : "ФЕЙЛ  ") + name + (cond ? "" : "  << " + JSON.stringify(extra))); if (!cond) fails++; };
const last = () => sent[sent.length - 1];

console.log("\n── 1. Кнопка «❓ Вопрос» → выбор объекта");
let handled = await issueText(env, UID, CHAT, "❓ Вопрос", ROLES);
check("перехвачено модулем", handled === true);
check("спрашивает объект", /Вопрос по какому объекту/.test(last().text));
const objBtns = last().kb.inline_keyboard.flat().map(b => b.text);
check("показаны только свои объекты (2 из 3)", objBtns.length === 2, objBtns);
check("чужой объект не предложен", !objBtns.some(t => /Чужой/.test(t)), objBtns);

console.log("\n── 2. Выбор объекта → выбор типа");
await issueCallback(env, UID, CHAT, "i:o:o1", ROLES);
check("предложены три типа", last().kb.inline_keyboard.length === 3);

console.log("\n── 3. Чужой объект недоступен даже по прямому callback");
await issueCallback(env, UID, CHAT, "i:o:o3", ROLES);
check("отказ по правам", /недоступен/.test(last().text), last().text);

console.log("\n── 4. Тип → просьба описать");
await issueCallback(env, UID, CHAT, "i:k:o1:supply", ROLES);
check("просит описание", /Опишите вопрос/.test(last().text), last().text);

console.log("\n── 5. Текст вопроса → тикет + адресные уведомления");
sent.length = 0;
await issueText(env, UID, CHAT, "Не хватило вагонки на парную, нужно ещё 6 м2", ROLES);
const iss = store.work_states.issues;
check("тикет создан", iss.length === 1, iss);
check("привязан к объекту", iss[0] && iss[0].objId === "o1");
check("тип supply", iss[0] && iss[0].kind === "supply");
check("статус new, автор Валера, src bot", iss[0] && iss[0].status === "new" && iss[0].byName === "Валера" && iss[0].src === "bot", iss[0]);
const notified = sent.filter(m => m.chat !== CHAT).map(m => m.chat).sort();
check("уведомлены снабженец и админ", JSON.stringify(notified) === JSON.stringify(["222", "333"]), notified);
check("сопровождение НЕ уведомлено (это материал)", !notified.includes("444"), notified);
check("автор получил подтверждение", sent.some(m => m.chat === CHAT && /Записал вопрос/.test(m.text)));

console.log("\n── 6. Голосовое следом → доклеивается к тому же тикету");
sent.length = 0;
handled = await issueMedia(env, UID, CHAT, { message_id: 5, voice: { file_id: "v1", duration: 14 } }, ROLES);
check("медиа перехвачено", handled === true);
check("новый тикет НЕ создан", store.work_states.issues.length === 1, store.work_states.issues.length);
check("копия ушла в тему объекта", copied.length === 1 && copied[0].message_thread_id === 77, copied[0]);
check("ссылка на тему записана", /t\.me\/c\/1234567890\/77\/900/.test(store.work_states.issues[0].tgLink || ""), store.work_states.issues[0].tgLink);
check("topicId сохранён в объекте", store.work_states.objects[0].tgTopicId === 77);
check("автору сказали, что добавлено", /Голосовое добавлен/.test(last().text), last().text);

console.log("\n── 7. Голос ПЕРВЫМ сообщением (без текста) — тоже заводит тикет");
store.tg_dialog = {}; sent.length = 0; copied.length = 0;
await issueCallback(env, UID, CHAT, "i:k:o2:change", ROLES);
await issueMedia(env, UID, CHAT, { message_id: 9, voice: { file_id: "v2" } }, ROLES);
const iss2 = store.work_states.issues;
check("второй тикет создан", iss2.length === 2, iss2.length);
check("текст-заглушка про голосовое", iss2[1].text === "(голосовое сообщение)", iss2[1].text);
const n2 = sent.filter(m => m.chat !== CHAT).map(m => m.chat).sort();
check("для «изменения» уведомлены админ и сопровождение", JSON.stringify(n2) === JSON.stringify(["333", "444"]), n2);
check("снабженец НЕ уведомлён", !n2.includes("222"), n2);

console.log("\n── 8. Ответ из панели → автору в личку");
store.work_states.issues = store.work_states.issues.map(t => t.id !== iss2[0].id ? t
  : Object.assign({}, t, { status: "done", answer: "Везу завтра 8 м2, оплатил", answerBy: "u_dima", linkedNote: "в докупку: Вагонка · 9 400 ₽" }));
sent.length = 0;
const r = await issueReplyToAuthor(env, iss2[0].id);
check("отправлено", r.success && r.sent, r);
check("ушло автору, а не кому попало", sent.length === 1 && sent[0].chat === "111", sent.map(s => s.chat));
check("в тексте ответ", /Везу завтра/.test(sent[0].text));
check("в тексте куда ушло", /в докупку/.test(sent[0].text));

console.log("\n── 9. Кнопка меню посреди диалога выпускает из него");
store.tg_dialog = {}; sent.length = 0;
await issueCallback(env, UID, CHAT, "i:k:o1:question", ROLES);
const before = store.work_states.issues.length;
const esc = await issueText(env, UID, CHAT, "🏗 Объекты", ROLES);
check("отдано дальше по цепочке", esc === false);
check("кнопка НЕ стала тикетом", store.work_states.issues.length === before, store.work_states.issues.length);
check("диалог сброшен", Object.keys(store.tg_dialog).length === 0, store.tg_dialog);
sent.length = 0;
await issueCallback(env, UID, CHAT, "i:k:o1:question", ROLES);
await issueText(env, UID, CHAT, "Куда вести розетку в комнате отдыха?", ROLES);
const cnt = store.work_states.issues.length;
check("команда /start тоже выпускает", (await issueText(env, UID, CHAT, "/start", ROLES)) === false);
check("текст команды не дописан в вопрос", !/start/.test(store.work_states.issues[cnt-1].text), store.work_states.issues[cnt-1].text);

console.log("\n── 10. Посторонний текст вне диалога модуль не трогает");
store.tg_dialog = {};
check("возвращает false", (await issueText(env, UID, CHAT, "💰 Финансы", ROLES)) === false);
check("медиа тоже отдаёт дальше", (await issueMedia(env, UID, CHAT, { message_id: 1, photo: [{ file_id: "p" }] }, ROLES)) === false);

console.log("\n" + (fails ? "❌ ПРОВАЛЕНО: " + fails : "✅ Все проверки пройдены"));
process.exit(fails ? 1 : 0);
