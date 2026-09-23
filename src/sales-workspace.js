// Telegram sales workspace. Per-client rows avoid overwriting unrelated dialogs.
const states = {
  new: "🆕 Новый",
  callback: "📞 Перезвонить",
  waiting: "⏳ Ждём клиента",
  contract: "✅ Договор",
  refused: "⚪ Отказ",
  closed: "⚪ Неактуально",
};
const closed = (s) => ["contract", "refused", "closed"].includes(s);
export const normalizePhone = (s) => {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  return /^\d{11,12}$/.test(d) ? "+" + d : "";
};
export function extractPhone(text) {
  return normalizePhone(
    String(text || "").match(
      /(?:\+?7|8)(?:[ ()-]*\d){10}(?!\d)|\+375(?:[ ()-]*\d){9}(?!\d)/,
    )?.[0],
  );
}
export function readableText(s) {
  return String(s || "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}
const stamp = (t) =>
  new Date(t).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function topicName(c) {
  return (
    (states[c.status] || states.new).split(" ")[0] +
    " " +
    c.name +
    (c.name === "Новый клиент"
      ? " · №" + (c.topicId || String(c.id).slice(-6))
      : "") +
    (c.location ? " · " + c.location : "") +
    (c.interest ? " · " + c.interest : "")
  ).slice(0, 128);
}
export function cardText(c) {
  return [
    (states[c.status] || states.new) +
      " · " +
      (c.source === "website" ? "Сайт" : "Авито"),
    c.name,
    c.phone ? "📞 " + c.phone : "📞 Телефон не получен",
    c.location ? "📍 " + c.location : "",
    c.interest ? "🏠 " + c.interest : "",
    c.summary ? "💬 " + readableText(c.summary).slice(0, 900) : "",
    c.due
      ? "Перезвонить: " + stamp(c.due) + " МСК"
      : "Следующее действие: " +
        (c.status === "new"
          ? "первый контакт"
          : c.status === "waiting"
            ? "дождаться ответа"
            : closed(c.status)
              ? "заявка закрыта"
              : "связаться с клиентом"),
    c.note ? "📝 " + c.note.slice(-700) : "",
    "CRM: https://portal.kubrdom.ru/admin",
  ]
    .filter(Boolean)
    .join("\n");
}
const button = (text, action) => ({ text, callback_data: "sales:" + action });
function keyboard() {
  return {
    inline_keyboard: [
      [button("📞 Перезвонить", "call"), button("📝 Итог звонка", "note")],
      [button("⏳ Ждём клиента", "wait"), button("✅ Закрыть", "close")],
      [
        button("✏️ Имя / город / интерес", "profile"),
        button("🆕 В работу", "reopen"),
      ],
    ],
  };
}
export async function tg(env, method, payload) {
  const r = await fetch(
    "https://api.telegram.org/bot" + env.TG_SALES_BOT_TOKEN + "/" + method,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    },
  );
  const j = await r.json();
  if (!r.ok || !j.ok)
    throw new Error(method + ": " + (j.description || r.status));
  return j.result;
}
const initializedDatabases = new WeakSet();
export async function ensureSales(env) {
  if (initializedDatabases.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sales_cards (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, topic_id INTEGER, data TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sales_meta (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sales_prompts (chat_id TEXT, message_id INTEGER, user_id TEXT, card_id TEXT, action TEXT, expires INTEGER, PRIMARY KEY(chat_id,message_id,user_id))",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS state_write_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))",
    ),
  ]);
  initializedDatabases.add(env.DB);
}
async function save(env, c) {
  await env.DB.prepare(
    "INSERT INTO sales_cards VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,topic_id=excluded.topic_id,data=excluded.data,updated_at=excluded.updated_at",
  )
    .bind(
      c.id,
      String(c.chatId),
      c.topicId || null,
      JSON.stringify(c),
      Date.now(),
    )
    .run();
}
async function get(env, id) {
  const r = await env.DB.prepare("SELECT data FROM sales_cards WHERE id=?")
    .bind(id)
    .first();
  return r ? JSON.parse(r.data) : null;
}
async function meta(env, id) {
  const r = await env.DB.prepare("SELECT data FROM sales_meta WHERE id=?")
    .bind(id)
    .first();
  return r ? JSON.parse(r.data) : null;
}
async function setMeta(env, id, value) {
  await env.DB.prepare(
    "INSERT INTO sales_meta VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  )
    .bind(id, JSON.stringify(value))
    .run();
}
export async function salesDestination(env, source) {
  await ensureSales(env);
  const cfg = (await meta(env, "groups")) || {};
  return String(cfg[source] || env.TG_SALES_CHAT_ID);
}
async function syncCRM(env, c) {
  for (let n = 0; n < 4; n++) {
    const row = await env.DB.prepare(
      "SELECT data,updated_at FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients'",
    ).first();
    if (!row) throw new Error("CRM unavailable");
    const clients = JSON.parse(row.data);
    let lead = clients.find(
      (x) => x.id === c.crmId || (c.source === "avito" && x.avitoKey === c.id),
    );
    if (lead) c.crmId = lead.id;
    if (!lead) {
      if (c.source === "website") return;
      lead = {
        id: c.crmId,
        source: "Авито",
        stage: "new",
        date: new Date().toISOString().slice(0, 10),
        msg: c.summary || "",
        avitoKey: c.id,
      };
      clients.push(lead);
    }
    if (
      c.syncedName !== undefined &&
      lead.name !== c.syncedName &&
      c.name === c.syncedName
    )
      c.name = lead.name;
    if (
      c.syncedPhone !== undefined &&
      normalizePhone(lead.phone) !== c.syncedPhone &&
      c.phone === c.syncedPhone
    )
      c.phone = normalizePhone(lead.phone);
    if (
      ["contract", "montaj"].includes(lead.stage) &&
      c.syncedStage !== lead.stage
    ) {
      c.status = "contract";
      c.due = 0;
    }
    Object.assign(lead, {
      name: c.name,
      phone: c.phone || lead.phone || "",
      salesStatus: c.status,
      salesFollowupAt: c.due || 0,
      salesNote: c.note || "",
      salesTopicUrl: topicUrl(c),
    });
    if (c.status === "contract" && lead.stage !== "montaj")
      lead.stage = "contract";
    c.syncedName = c.name;
    c.syncedPhone = c.phone;
    c.syncedStage = lead.stage;
    const guard = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO state_write_guard VALUES (?,CASE WHEN (SELECT updated_at FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients')=? THEN 1 ELSE 0 END)",
        ).bind(guard, row.updated_at),
        env.DB.prepare(
          "UPDATE work_states SET data=?,updated_at=? WHERE storage_key='admin_panel' AND work_id='crmClients'",
        ).bind(
          JSON.stringify(clients),
          Math.max(Date.now(), Number(row.updated_at) + 1),
        ),
        env.DB.prepare("DELETE FROM state_write_guard WHERE id=?").bind(guard),
      ]);
      return;
    } catch (e) {
      if (!/CHECK constraint/.test(String(e))) throw e;
    }
  }
  throw new Error("CRM busy");
}
function topicUrl(c) {
  return (
    "https://t.me/c/" + String(c.chatId).replace(/^-100/, "") + "/" + c.topicId
  );
}
async function refresh(env, c) {
  if (!c.topicId) {
    const t = await tg(env, "createForumTopic", {
      chat_id: c.chatId,
      name: topicName(c),
    });
    c.topicId = t.message_thread_id;
    await save(env, c);
  }
  await syncCRM(env, c);
  const text = cardText(c);
  if (c.cardId) {
    try {
      await tg(env, "editMessageText", {
        chat_id: c.chatId,
        message_id: c.cardId,
        text,
        reply_markup: keyboard(),
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      if (!/message is not modified/.test(String(e))) throw e;
    }
  } else {
    const m = await tg(env, "sendMessage", {
      chat_id: c.chatId,
      message_thread_id: c.topicId,
      text,
      reply_markup: keyboard(),
      link_preview_options: { is_disabled: true },
    });
    c.cardId = m.message_id;
    await save(env, c);
  }
  await tg(env, "editForumTopic", {
    chat_id: c.chatId,
    message_thread_id: c.topicId,
    name: topicName(c),
  }).catch((e) => {
    if (!/not[ _]modified/i.test(String(e))) throw e;
  });
  if (!c.pinned) {
    await tg(env, "pinChatMessage", {
      chat_id: c.chatId,
      message_id: c.cardId,
      disable_notification: true,
    });
    c.pinned = true;
    await save(env, c);
  }
  if (c.phone && c.contactPhone !== c.phone) {
    await tg(env, "sendContact", {
      chat_id: c.chatId,
      message_thread_id: c.topicId,
      phone_number: c.phone,
      first_name: c.name,
    });
    c.contactPhone = c.phone;
    await save(env, c);
  }
  c.dirty = false;
  await save(env, c);
}
export async function upsertSalesCard(env, input) {
  await ensureSales(env);
  let c = await get(env, input.id);
  if (!c) {
    const row = await env.DB.prepare(
      "SELECT data FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients'",
    ).first();
    const lead = JSON.parse(row?.data || "[]").find(
      (x) =>
        x.id === input.crmId ||
        (input.source === "avito" && x.avitoKey === input.id),
    );
    if (lead) {
      input = {
        ...input,
        crmId: lead.id,
        name: lead.name || input.name,
        phone: lead.phone || input.phone,
      };
    }
  }
  if (!c) {
    c = {
      ...input,
      status: "new",
      createdAt: Date.now(),
      chatId: String(
        input.chatId || (await salesDestination(env, input.source)),
      ),
    };
  } else {
    if (input.phone) c.phone = input.phone;
    if (
      c.name === "Новый клиент" &&
      input.name &&
      !/^Avito ·|^Новый клиент/.test(input.name)
    )
      c.name = input.name;
    if (input.summary) {
      c.summary = input.summary;
      if (c.status === "waiting") c.status = "new";
    }
  }
  if (!c.interest) {
    const text = String(input.interestText || input.summary || "");
    const kind = /бан[яюиь]/i.test(text)
      ? "Баня"
      : /дом(?:а|ик)?\b/i.test(text)
        ? "Дом"
        : "";
    const size = text.match(/\b\d{1,2}\s*[xх×]\s*\d{1,2}\b/i)?.[0];
    if (kind) c.interest = kind + (size ? " " + size.replace(/\s/g, "") : "");
  }
  delete c.interestText;
  c.phone = normalizePhone(c.phone);
  if (/^Avito ·/.test(c.name || "")) c.name = "Новый клиент";
  if (!c.name) c.name = "Новый клиент";
  c.dirty = true;
  await save(env, c);
  await refresh(env, c);
  return c;
}
export async function deliverSiteCard(env, lead) {
  if (
    /^ТЕСТ(?:\s|$|[:—-])|НЕ ОБРАБАТЫВАТЬ|^техническая проверка/i.test(
      lead.name + " " + lead.msg,
    )
  ) {
    await salesService(
      env,
      "🧪 Тестовая заявка с сайта сохранена в CRM.\n" + lead.name,
    );
    return;
  }
  return upsertSalesCard(env, {
    id: lead.id,
    crmId: lead.id,
    source: "website",
    name: lead.name,
    phone: lead.phone,
    summary: lead.msg,
  });
}
export async function salesService(env, text) {
  await ensureSales(env);
  let cfg = await meta(env, "service");
  if (!cfg) {
    const chatId = await salesDestination(env, "service");
    const t = await tg(env, "createForumTopic", {
      chat_id: chatId,
      name: "⚙️ Служебное · тесты и ошибки",
    });
    cfg = { chatId, topicId: t.message_thread_id };
    await setMeta(env, "service", cfg);
  }
  await tg(env, "sendMessage", {
    chat_id: cfg.chatId,
    message_thread_id: cfg.topicId,
    text: String(text).slice(0, 3500),
    disable_notification: true,
  });
}
async function isAdmin(env, chat, user) {
  try {
    const m = await tg(env, "getChatMember", { chat_id: chat, user_id: user });
    return ["creator", "administrator"].includes(m.status);
  } catch {
    return false;
  }
}
async function prompt(env, c, user, action, text) {
  const m = await tg(env, "sendMessage", {
    chat_id: c.chatId,
    message_thread_id: c.topicId,
    text:
      "🔒 Внутренняя запись. Клиенту не отправляется.\n" +
      text +
      "\nОтветьте именно на это сообщение. /cancel — отмена.",
    reply_markup: { force_reply: true, selective: false },
  });
  await env.DB.prepare(
    "INSERT OR REPLACE INTO sales_prompts VALUES (?,?,?,?,?,?)",
  )
    .bind(
      c.chatId,
      m.message_id,
      String(user),
      c.id,
      action,
      Date.now() + 86400000,
    )
    .run();
}
export function parseDue(text, now = Date.now()) {
  const m = String(text)
    .trim()
    .match(/^(?:(\d{2})\.(\d{2})(?:\.(\d{4}))?\s+)?(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const today = new Date(now + 10800000);
  const y = Number(m[3] || today.getUTCFullYear()),
    mo = Number(m[2] || today.getUTCMonth() + 1),
    d = Number(m[1] || today.getUTCDate()),
    h = Number(m[4]),
    min = Number(m[5]);
  if (h > 23 || min > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  const local = new Date(Date.UTC(y, mo - 1, d, h, min));
  if (local.getUTCDate() !== d) return 0;
  const due = local.getTime() - 10800000;
  return due > now ? due : 0;
}
export async function salesWebhook(env, upd) {
  await ensureSales(env);
  const cq = upd.callback_query,
    msg = cq?.message || upd.message;
  if (!msg) return false;
  const chat = String(msg.chat.id),
    user = cq?.from?.id || msg.from?.id;
  if (upd.message?.text?.startsWith("/sales_bind ")) {
    if (
      !(await isAdmin(env, env.TG_SALES_CHAT_ID, user)) ||
      !(await isAdmin(env, chat, user))
    )
      return true;
    const source = msg.text.split(/\s+/)[1];
    if (!["website", "avito", "service"].includes(source)) return true;
    const cfg = (await meta(env, "groups")) || {};
    cfg[source] = chat;
    await setMeta(env, "groups", cfg);
    await tg(env, "sendMessage", {
      chat_id: chat,
      text: "✅ Группа подключена: " + source,
    });
    return true;
  }
  const row = await env.DB.prepare(
    "SELECT data FROM sales_cards WHERE chat_id=? AND topic_id=?",
  )
    .bind(chat, msg.message_thread_id || 0)
    .first();
  const c = row ? JSON.parse(row.data) : null;
  if (cq?.data?.startsWith("sales:")) {
    if (!c || !(await isAdmin(env, chat, user))) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "Действие доступно администратору заявки",
      });
      return true;
    }
    const action = cq.data.slice(6);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    if (action === "call") {
      await tg(env, "sendMessage", {
        chat_id: chat,
        message_thread_id: c.topicId,
        text: "Когда перезвонить? Время московское.",
        reply_markup: {
          inline_keyboard: [
            [button("Через час", "hour"), button("Завтра в 10:00", "tomorrow")],
            [button("Указать время", "time")],
          ],
        },
      });
      return true;
    }
    if (action === "close") {
      await tg(env, "sendMessage", {
        chat_id: chat,
        message_thread_id: c.topicId,
        text: "Результат заявки:",
        reply_markup: {
          inline_keyboard: [
            [
              button("Договор", "contract"),
              button("Отказ", "refused"),
              button("Неактуально", "closed"),
            ],
          ],
        },
      });
      return true;
    }
    if (["note", "time", "profile"].includes(action)) {
      await prompt(
        env,
        c,
        user,
        action,
        action === "note"
          ? "Напишите итог разговора."
          : action === "time"
            ? "Введите 17:30 или 25.09.2026 10:00 (МСК)."
            : "Введите: Имя | Город | Предмет интереса",
      );
      return true;
    }
    if (action === "hour" || action === "tomorrow") {
      c.status = "callback";
      c.due =
        action === "hour"
          ? Date.now() + 3600000
          : Date.UTC(
              new Date(Date.now() + 10800000).getUTCFullYear(),
              new Date(Date.now() + 10800000).getUTCMonth(),
              new Date(Date.now() + 10800000).getUTCDate() + 1,
              7,
            );
      c.reminded = 0;
    } else if (
      ["wait", "reopen", "contract", "refused", "closed"].includes(action)
    ) {
      c.status =
        action === "wait" ? "waiting" : action === "reopen" ? "new" : action;
      c.due = 0;
    } else return true;
    c.dirty = true;
    await save(env, c);
    await refresh(env, c);
    await refreshToday(env);
    return true;
  }
  if (!upd.message || msg.from?.is_bot) return false;
  if (c && msg.text === "/cancel") {
    await env.DB.prepare(
      "DELETE FROM sales_prompts WHERE chat_id=? AND card_id=? AND user_id=?",
    )
      .bind(chat, c.id, String(user))
      .run();
    await tg(env, "sendMessage", {
      chat_id: chat,
      message_thread_id: c.topicId,
      text: "Ввод внутренней записи отменён.",
    });
    return true;
  }
  if (c && !msg.reply_to_message) {
    const pending = await env.DB.prepare(
      "SELECT message_id FROM sales_prompts WHERE chat_id=? AND card_id=? AND user_id=? AND expires>? LIMIT 1",
    )
      .bind(chat, c.id, String(user), Date.now())
      .first();
    if (pending) {
      await tg(env, "sendMessage", {
        chat_id: chat,
        message_thread_id: c.topicId,
        text: "Сейчас открыта внутренняя запись. Ответьте на сообщение бота или напишите /cancel. Клиенту ничего не отправлено.",
      });
      return true;
    }
  }
  if (msg.reply_to_message) {
    const p = await env.DB.prepare(
      "SELECT * FROM sales_prompts WHERE chat_id=? AND message_id=? AND user_id=?",
    )
      .bind(chat, msg.reply_to_message.message_id, String(user))
      .first();
    const internal = msg.reply_to_message.text?.startsWith(
      "🔒 Внутренняя запись.",
    );
    if (!p) return !!internal;
    if (!c || p.card_id !== c.id || !(await isAdmin(env, chat, user)))
      return true;
    const text = msg.text || "";
    if (text === "/cancel") {
      await env.DB.prepare(
        "DELETE FROM sales_prompts WHERE chat_id=? AND message_id=? AND user_id=?",
      )
        .bind(chat, p.message_id, String(user))
        .run();
      return true;
    }
    if (p.expires < Date.now()) {
      await tg(env, "sendMessage", {
        chat_id: chat,
        message_thread_id: c.topicId,
        text: "Срок ввода истёк. Нажмите кнопку ещё раз.",
      });
      return true;
    }
    if (p.action === "note") {
      if (!text.trim()) return true;
      c.note =
        (c.note ? c.note + "\n" : "") +
        stamp(Date.now()) +
        " — " +
        text.slice(0, 1800);
      c.note = c.note.slice(-5000);
    }
    if (p.action === "time") {
      const due = parseDue(text);
      if (!due) {
        await prompt(
          env,
          c,
          user,
          "time",
          "Не удалось распознать будущую дату. Пример: 25.09.2026 17:30.",
        );
        return true;
      }
      c.due = due;
      c.status = "callback";
      c.reminded = 0;
    }
    if (p.action === "profile") {
      const [name, location, interest] = text.split("|").map((s) => s.trim());
      if (!name) return true;
      Object.assign(c, {
        name: name.slice(0, 60),
        location: (location || "").slice(0, 70),
        interest: (interest || "").slice(0, 70),
      });
    }
    c.dirty = true;
    await save(env, c);
    await refresh(env, c);
    await env.DB.prepare(
      "DELETE FROM sales_prompts WHERE chat_id=? AND message_id=? AND user_id=?",
    )
      .bind(chat, p.message_id, String(user))
      .run();
    await tg(env, "sendMessage", {
      chat_id: chat,
      message_thread_id: c.topicId,
      text: "✅ Сохранено в карточке и CRM.",
    });
    return true;
  }
  // Never forward command text or website/internal topic messages to Avito.
  if (msg.text?.startsWith("/")) return true;
  if (c && c.source === "website") return true;
  return false;
}
export async function refreshToday(env) {
  const rows = await env.DB.prepare(
    "SELECT data FROM sales_cards ORDER BY updated_at DESC",
  ).all();
  const cards = rows.results
    .map((r) => JSON.parse(r.data))
    .filter((c) => !closed(c.status));
  let cfg = await meta(env, "today");
  if (!cfg) {
    const chatId = String(env.TG_SALES_CHAT_ID);
    const t = await tg(env, "createForumTopic", {
      chat_id: chatId,
      name: "📋 Сегодня · все заявки",
    });
    cfg = { chatId, topicId: t.message_thread_id };
    await setMeta(env, "today", cfg);
  }
  const now = Date.now();
  const end = new Date(now + 10800000);
  const endTime =
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1) -
    10800000;
  const list = cards
    .filter((c) => c.status === "new" || (c.due && c.due < endTime))
    .sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
  const text = (
    "📋 Заявки на сегодня · МСК\n" +
    (list.length
      ? list
          .slice(0, 25)
          .map(
            (c) =>
              (c.due
                ? c.due < now
                  ? "🔴 Просрочено"
                  : "📞 " + stamp(c.due)
                : "🆕 Первый контакт") +
              " · " +
              c.name +
              "\n" +
              topicUrl(c),
          )
          .join("\n\n")
      : "На сегодня нет необработанных заявок и звонков.") +
    (list.length > 25 ? "\nЕщё " + (list.length - 25) + " — в CRM." : "")
  ).slice(0, 4000);
  if (cfg.text === text) return;
  const body = {
    chat_id: cfg.chatId,
    text,
    link_preview_options: { is_disabled: true },
    disable_notification: true,
  };
  if (cfg.messageId) {
    await tg(env, "editMessageText", {
      ...body,
      message_id: cfg.messageId,
    }).catch((e) => {
      if (!/not[ _]modified/i.test(String(e))) throw e;
    });
  } else {
    const m = await tg(env, "sendMessage", {
      ...body,
      message_thread_id: cfg.topicId,
    });
    cfg.messageId = m.message_id;
    await setMeta(env, "today", cfg);
    await tg(env, "pinChatMessage", {
      chat_id: cfg.chatId,
      message_id: m.message_id,
      disable_notification: true,
    });
  }
  cfg.text = text;
  await setMeta(env, "today", cfg);
}
export async function salesTick(env) {
  if (!env.TG_SALES_BOT_TOKEN) return;
  await ensureSales(env);
  const old = await env.DB.prepare(
    "SELECT data FROM work_states WHERE storage_key='admin_panel' AND work_id='aiChats'",
  ).first();
  const chats = JSON.parse(old?.data || "{}");
  let n = 0;
  for (const [id, c] of Object.entries(chats)) {
    if (!c.topicId || c.source !== "avito" || (await get(env, id))) continue;
    const userTexts = (c.messages || [])
      .filter((m) => m.role === "user")
      .map((m) => m.text);
    try {
      await upsertSalesCard(env, {
        id,
        crmId: "avito-" + id.slice(6),
        chatId: env.TG_SALES_CHAT_ID,
        topicId: c.topicId,
        source: "avito",
        name: c.name,
        phone: extractPhone(userTexts.join("\n")),
        summary: userTexts.at(-1) || "",
        interestText: userTexts.join("\n"),
      });
    } catch (e) {
      console.error("sales migration", String(e));
    }
    if (++n >= 3) break;
  }
  const crmRow = await env.DB.prepare(
    "SELECT data FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients'",
  ).first();
  const crm = JSON.parse(crmRow?.data || "[]");
  const rows = await env.DB.prepare("SELECT data FROM sales_cards").all();
  for (const r of rows.results) {
    const c = JSON.parse(r.data);
    const lead = crm.find((x) => x.id === c.crmId);
    if (
      lead &&
      (lead.name !== c.syncedName ||
        normalizePhone(lead.phone) !== c.syncedPhone ||
        lead.stage !== c.syncedStage)
    )
      c.dirty = true;
    try {
      if (c.dirty || !c.cardId) await refresh(env, c);
      if (c.due && c.due <= Date.now() && !c.reminded && !closed(c.status)) {
        await tg(env, "sendMessage", {
          chat_id: c.chatId,
          message_thread_id: c.topicId,
          text:
            "⏰ Пора перезвонить: " +
            c.name +
            "\n" +
            (c.phone || "Телефон не получен") +
            "\nНазначено: " +
            stamp(c.due) +
            " МСК\n" +
            topicUrl(c),
        });
        c.reminded = Date.now();
        await save(env, c);
      }
    } catch (e) {
      console.error("sales card retry", String(e));
    }
  }
  await refreshToday(env);
}

export async function salesClosed(env, id) {
  await ensureSales(env);
  const c = await get(env, id);
  return !!c && closed(c.status);
}

// Authenticated, administrator-only rollout/health endpoint. No customer data returned.
export async function salesSetup(env) {
  await ensureSales(env);
  if (!(await meta(env, "setup-v1"))) {
    await tg(env, "setChatTitle", {
      chat_id: env.TG_SALES_CHAT_ID,
      title: "🅰️ КубрДом · Заявки с Авито",
    });
    await salesService(
      env,
      "✅ Рабочее место заявок подключено. Тесты и ошибки будут появляться здесь.",
    );
    await setMeta(env, "setup-v1", { at: Date.now() });
  }
  await salesTick(env);
  const rows = await env.DB.prepare("SELECT data FROM sales_cards").all();
  const cards = rows.results.map((r) => JSON.parse(r.data));
  const pendingErrors = [];
  for (const c of cards.filter((c) => c.dirty || !c.cardId)) {
    try {
      await refresh(env, c);
    } catch (e) {
      pendingErrors.push(String(e));
    }
  }
  return {
    pendingErrors,
    success: true,
    cards: cards.length,
    pending: cards.filter((c) => c.dirty || !c.cardId).length,
    today: !!(await meta(env, "today"))?.messageId,
    service: !!(await meta(env, "service"))?.topicId,
  };
}
