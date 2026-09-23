import assert from "node:assert/strict";
import { sqliteDB } from "./harness/sqlite-db.js";
import {
  deliverSiteCard,
  extractPhone,
  parseDue,
  upsertSalesCard,
  salesWebhook,
  salesTick,
  topicName,
} from "../src/sales-workspace.js";
const db = sqliteDB({
  crmClients: [
    {
      id: "linked",
      avitoKey: "avito:abc",
      name: "Александр",
      phone: "+79991234567",
      notes: "keep",
      stage: "kp",
    },
  ],
});
const env = {
  DB: db.db,
  TG_SALES_BOT_TOKEN: "fake",
  TG_SALES_CHAT_ID: "-100123",
};
const calls = [];
const topicNames = new Map();
let seq = 10,
  admin = true,
  failContact = false;
globalThis.fetch = async (url, opt) => {
  const method = url.split("/").at(-1),
    body = JSON.parse(opt.body);
  calls.push({ method, ...body });
  if (method === "editForumTopic") {
    const key = body.chat_id + ":" + body.message_thread_id;
    if (topicNames.get(key) === body.name)
      return Response.json(
        { ok: false, description: "Bad Request: TOPIC_NOT_MODIFIED" },
        { status: 400 },
      );
    topicNames.set(key, body.name);
  }
  if (method === "sendContact" && failContact)
    return Response.json({ ok: false, description: "temporary" });
  return Response.json({
    ok: true,
    result:
      method === "getChatMember"
        ? { status: admin ? "creator" : "member" }
        : { message_id: ++seq, message_thread_id: seq },
  });
};
assert.equal(
  extractPhone("Мой номер 8 (999) 123-45-67, баня 6 на 3"),
  "+79991234567",
);
assert.equal(extractPhone("номер +375 29 123-45-67"), "+375291234567");
assert.equal(parseDue("31.02.2027 10:00"), 0);
assert.equal(parseDue("25:00"), 0);
assert.equal(
  parseDue("25.09.2026 10:30", Date.parse("2026-09-23T00:00:00Z")),
  Date.parse("2026-09-25T07:30:00Z"),
);
let c = await upsertSalesCard(env, {
  id: "avito:abc",
  crmId: "avito-abc",
  source: "avito",
  name: "Avito · 123",
  topicId: 4,
  summary: "Баня",
});
assert.equal(c.name, "Александр");
assert.equal(c.crmId, "linked");
assert.equal(db.get("crmClients").data.length, 1);
assert.equal(db.get("crmClients").data[0].notes, "keep");
assert.equal(db.get("crmClients").data[0].stage, "kp");
assert.equal(calls.filter((x) => x.method === "sendContact").length, 1);
await upsertSalesCard(env, { id: c.id, summary: "Повтор" });
assert.equal(calls.filter((x) => x.method === "sendContact").length, 1);
assert.equal(
  calls.filter(
    (x) =>
      x.method === "sendMessage" &&
      x.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "sales:call",
  ).length,
  1,
);
const msg = {
  chat: { id: -100123 },
  message_thread_id: 4,
  message_id: c.cardId,
};
const cb = (action) => ({
  callback_query: {
    id: "cb",
    from: { id: 1 },
    message: msg,
    data: "sales:" + action,
  },
});
await salesWebhook(env, cb("note"));
const prompt = calls.filter((x) => x.reply_markup?.force_reply).at(-1);
const p = await env.DB.prepare("SELECT * FROM sales_prompts").first();
assert.equal(
  await salesWebhook(env, {
    message: {
      ...msg,
      from: { id: 1 },
      text: "Внутренняя заметка",
      reply_to_message: { message_id: p.message_id, text: prompt.text },
    },
  }),
  true,
);
assert.match(db.get("crmClients").data[0].salesNote, /Внутренняя заметка/);
assert.equal(
  await salesWebhook(env, {
    message: {
      ...msg,
      from: { id: 2 },
      text: "Чужой ответ",
      reply_to_message: { message_id: p.message_id, text: prompt.text },
    },
  }),
  true,
);
admin = false;
await salesWebhook(env, cb("contract"));
assert.equal(db.get("crmClients").data[0].stage, "kp");
admin = true;
await salesWebhook(env, cb("hour"));
let row = await env.DB.prepare("SELECT data FROM sales_cards WHERE id=?")
  .bind(c.id)
  .first();
c = JSON.parse(row.data);
assert.equal(c.status, "callback");
c.due = Date.now() - 1000;
await env.DB.prepare("UPDATE sales_cards SET data=? WHERE id=?")
  .bind(JSON.stringify(c), c.id)
  .run();
await salesTick(env);
await salesTick(env);
assert.equal(calls.filter((x) => x.text?.startsWith("⏰ Пора")).length, 1);
await salesWebhook(env, cb("contract"));
assert.equal(db.get("crmClients").data[0].stage, "contract");
// Same topic ID in a different chat must never select this client's card.
await salesWebhook(env, {
  callback_query: {
    ...cb("reopen").callback_query,
    message: { ...msg, chat: { id: -100999 } },
  },
});
assert.equal(db.get("crmClients").data[0].salesStatus, "contract");
assert.ok(topicName({ name: "X", status: "new" }).includes("X"));
const beforeService = calls.filter((x) => x.name?.includes("Служебное")).length;
await deliverSiteCard(env, {
  id: "site-real",
  name: "Иван",
  phone: "+79991234567",
  msg: "Хочу протестировать баню",
});
assert.equal(
  calls.filter((x) => x.name?.includes("Служебное")).length,
  beforeService,
);
assert.ok(
  await env.DB.prepare("SELECT id FROM sales_cards WHERE id=?")
    .bind("site-real")
    .first(),
);
await deliverSiteCard(env, {
  id: "site-test",
  name: "ТЕСТ САЙТА — НЕ ОБРАБАТЫВАТЬ",
  msg: "Проверка",
});
assert.equal(
  await env.DB.prepare("SELECT id FROM sales_cards WHERE id=?")
    .bind("site-test")
    .first(),
  null,
);
db.close();
console.log(
  "✓ Sales workspace: contact, deduplication, linked CRM, private notes, authorization, dates, reminders, chat isolation",
);
