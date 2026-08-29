// Эскалация вопросов без Telegram и без D1: мок базы по подстроке SQL, мок fetch
// по методу Bot API. Проверяем ровно то, ради чего эскалация и делалась: вопрос
// стареет по РАБОЧИМ дням, на 2-й день дёргаем адресата, на 5-й поднимаем наверх,
// и одно и то же напоминание не уходит дважды за день.
import { runReminders } from "../src/reminders.js";

// «Сегодня» для крона — четверг 2026-08-27. Даты вопросов подобраны от него.
const TODAY = "2026-08-27";
const realNow = Date.now;
Date.now = () => new Date(TODAY + "T09:00:00Z").getTime() - 3 * 3600 * 1000;

const store = {
  work_states: {
    objects: [
      { id: "o1", name: "Баня с хозблоком", stages: [] },
      { id: "o2", name: "Дом по безналу", stages: [] },
    ],
    contractDocs: [
      { id: "c1", objId: "o1", status: "signed", responsible: ["u_valera", "u_dima"] },
      { id: "c2", objId: "o2", status: "signed", responsible: ["u_valera"] },
    ],
    users: [
      { id: "u_valera", name: "Валера", roles: ["brigadier"] },
      { id: "u_dima", name: "Дима", roles: ["supply"] },
      { id: "u_petya", name: "Петя", roles: ["supply"] },       // снабженец НЕ на объекте
      { id: "u_rop", name: "Николай", roles: ["prod_head"] },
      { id: "u_admin", name: "Юрий", roles: ["admin"] },
    ],
    issues: [
      // 26.08 (среда) → 1 рабочий день. Порог 2 не достигнут: молчим.
      { id: "i_fresh", objId: "o1", kind: "supply", to: "supply", status: "new",
        at: "2026-08-26 09:00", by: "u_valera", byName: "Валера", text: "Свежий вопрос" },
      // 25.08 (вторник) → 2 рабочих дня. Напоминание адресату, без подъёма.
      { id: "i_nudge", objId: "o1", kind: "supply", to: "supply", status: "new",
        at: "2026-08-25 09:00", by: "u_valera", byName: "Валера", text: "Не хватило вагонки" },
      // 20.08 (четверг) → 5 рабочих дней. Подъём наверх + письмо автору.
      { id: "i_hot", objId: "o1", kind: "supply", to: "supply", status: "new",
        at: "2026-08-20 09:00", by: "u_valera", byName: "Валера", text: "Полок недовезли" },
      // Закрытый не стареет и не шлётся вовсе.
      { id: "i_done", objId: "o1", kind: "supply", to: "supply", status: "done",
        at: "2026-08-10 09:00", by: "u_valera", byName: "Валера", text: "Давно закрыт" },
    ],
    purchased: {}, arrived: {}, finTxns: [],
  },
  tg_links: [
    { uid: "u_valera", chat_id: "111" },
    { uid: "u_dima", chat_id: "222" },
    { uid: "u_petya", chat_id: "555" },
    { uid: "u_rop", chat_id: "666" },
    { uid: "u_admin", chat_id: "333" },
  ],
  notify_log: new Set(),
};

const sent = [];
function stmt(sql) {
  let args = [];
  const api = {
    bind(...a) { args = a; return api; },
    async all() {
      if (sql.includes("FROM work_states")) {
        return { results: args.filter(k => store.work_states[k] !== undefined)
          .map(k => ({ work_id: k, data: JSON.stringify(store.work_states[k]) })) };
      }
      if (sql.includes("FROM tg_links")) {
        return { results: store.tg_links.map(l => ({ uid: l.uid, chat_id: l.chat_id, prefs: null })) };
      }
      return { results: [] };
    },
    async first() { return null; },
    async run() {
      // Страж «одно напоминание одного вида по одному поводу»: INSERT OR IGNORE.
      if (sql.includes("INSERT OR IGNORE INTO notify_log")) {
        const k = args.slice(0, 3).join("|");
        const fresh = !store.notify_log.has(k);
        store.notify_log.add(k);
        return { meta: { changes: fresh ? 1 : 0 } };
      }
      if (sql.includes("DELETE FROM notify_log")) { store.notify_log.delete(args.join("|")); return { meta: { changes: 1 } }; }
      return { meta: { changes: 1 } };
    },
  };
  return api;
}
const env = { TG_BOT_TOKEN: "T", DB: { prepare: stmt, batch: async (xs) => xs } };
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (String(url).includes("/sendMessage")) { sent.push({ chat: body.chat_id, text: body.text }); }
  return { json: async () => ({ ok: true }) };
};

let fails = 0;
function check(name, ok, got) {
  if (ok) { console.log("  OK  " + name); return; }
  fails++; console.log("ФЕЙЛ  " + name + (got !== undefined ? "  << " + JSON.stringify(got) : ""));
}
const to = (chat) => sent.filter(m => m.chat === chat).map(m => m.text);
const anyMatch = (chat, re) => to(chat).some(t => re.test(t));

console.log("── Утренний крон: эскалация вопросов");
await runReminders(env, "0 6 * * *");

console.log("\n1. Свежий вопрос (1 раб. день) не тревожит никого");
check("про свежий не писали", !sent.some(m => /Свежий вопрос/.test(m.text)), sent.map(m => m.text.slice(0, 40)));

console.log("\n2. Два рабочих дня → напоминание адресату объекта");
check("Диме ушло", anyMatch("222", /Не хватило вагонки/), to("222"));
check("возраст посчитан в рабочих днях", anyMatch("222", /без ответа 2 раб\. дн/), to("222"));
check("чужому снабженцу НЕ ушло", !anyMatch("555", /Не хватило вагонки/), to("555"));
check("на 2 днях наверх НЕ поднимаем", !anyMatch("666", /Не хватило вагонки/), to("666"));

console.log("\n3. Пять рабочих дней → подъём начальнику производства и автору");
check("адресат получил", anyMatch("222", /Полок недовезли/), to("222"));
check("нач. производства получил", anyMatch("666", /Полок недовезли/), to("666"));
check("в подъёме указано, кому адресовано", anyMatch("666", /Адресовано снабженцу/), to("666"));
check("автор узнал, что вопрос поднят", anyMatch("111", /Ваш вопрос ждёт 5 раб\. дн/), to("111"));
check("ссылка в портал есть", anyMatch("666", /#tab=issues/), to("666"));

console.log("\n4. Закрытый вопрос не стареет");
check("про закрытый молчим", !sent.some(m => /Давно закрыт/.test(m.text)));

console.log("\n5. Повторный прогон в тот же день ничего не дублирует");
const was = sent.length;
await runReminders(env, "0 6 * * *");
check("новых сообщений нет", sent.length === was, sent.length - was);

Date.now = realNow;
console.log("\n" + (fails ? "❌ ПРОВАЛЕНО: " + fails : "✅ Все проверки пройдены"));
process.exit(fails ? 1 : 0);
