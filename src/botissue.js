// ─── ВОПРОС С ОБЪЕКТА ЧЕРЕЗ БОТА ─────────────────────────────────────────────
// Вопрос возникает у человека на площадке, а завести его до сих пор мог только тот,
// кто сидит в панели. Отсюда весь смысл модуля: вход туда, где люди уже находятся.
//
// Три решения, которые стоит понимать, прежде чем править:
//
// 1. Тип спрашиваем ПЕРВЫМ, до текста. Он определяет не оформление, а адресата:
//    «материал» будит снабженца, «изменение» — админа и сопровождение. Один вопрос
//    в начале дешевле, чем разбор ленты вручную потом.
// 2. Тикет создаётся на ПЕРВОМ же сообщении, каким бы оно ни было — текст, голос или
//    фото. Бригадир на морозе не станет соблюдать порядок «сначала опишите, потом
//    приложите»; всё, что придёт следом, доклеивается к тому же тикету.
// 3. Голосовые и фото НЕ скачиваем в портал: снимок D1 ограничен 2 МБ на строку.
//    Копируем сообщение в тему объекта (там уже живут фото и видео со стройки) и
//    храним ссылку. Поэтому голос работает «как есть» и не стоит ни копейки.

import { sendTg, escapeHtml, MAIN_BTNS } from "./notify.js";
import { objTeam } from "./reminders.js";
import { logEvent } from "./audit.js";
import { ensureTopic, copyToTopic, tgBase } from "./tgapi.js";
import { transcribeVoice } from "./stt.js";

export const ISSUE_BTN = "❓ Вопрос";
const PAGE = 8;
// Тип назначает ОДНОГО адресата-роль — она же пишется в тикет полем `to`, и по ней
// панель строит сводку «кто тормозит». Список ролей вместо одной означал бы, что
// у вопроса нет ответственного: отвечают все, а значит никто.
// Держать в синхроне с ISSUE_KIND в public/admin.js — это разные бандлы.
const KINDS = {
  supply:   { n: "Материал",  i: "📦", to: "supply" },
  change:   { n: "Изменение", i: "✏️", to: "client_mgr" },
  question: { n: "Вопрос",    i: "❓", to: "brigadier" },
  money:    { n: "Деньги",    i: "💰", to: "financier" },
};
// Роль сужаем объектом: «снабженцу» на десяти объектах — один и тот же человек,
// которому падает всё подряд. Некому на объекте — отдаём всем носителям роли,
// иначе вопрос повиснет там, где ответственных ещё не расставили.
function addresseeIds(role, oid, users, contracts) {
  const resp = new Set();
  (contracts || []).forEach(function (d) {
    if (d.objId !== oid) return;
    if (d.status !== "signed" && d.status !== "closed") return;
    (d.responsible || []).forEach(function (u) { resp.add(u); });
  });
  const onObj = (users || []).filter(function (u) { return resp.has(u.id) && (u.roles || []).indexOf(role) >= 0; });
  const pool = onObj.length ? onObj : (users || []).filter(function (u) { return (u.roles || []).indexOf(role) >= 0; });
  return new Set(pool.map(function (u) { return u.id; }));
}
const has = (roles, list) => (roles || []).some(function (r) { return list.indexOf(r) >= 0; });
const stamp = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

async function snap(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of (rows.results || [])) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}
async function saveIssues(env, issues) {
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES ('admin_panel','issues',?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(JSON.stringify(issues), Date.now()).run();
}
async function saveObjects(env, objects) {
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES ('admin_panel','objects',?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(JSON.stringify(objects), Date.now()).run();
}
async function dlgSet(env, uid, st) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
  if (!st) { await env.DB.prepare("DELETE FROM tg_dialog WHERE uid=?").bind(uid).run(); return; }
  await env.DB.prepare("INSERT INTO tg_dialog (uid, state, updated_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at")
    .bind(uid, JSON.stringify(st), Date.now()).run();
}
async function dlgGet(env, uid) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
  const r = await env.DB.prepare("SELECT state FROM tg_dialog WHERE uid=?").bind(uid).first();
  if (!r || !r.state) return null;
  try { return JSON.parse(r.state); } catch { return null; }
}

// Объекты, по которым человек вправе задать вопрос. Админ, финансист и начальник
// производства видят все; остальные — только свои, как и в отметке работ.
function myObjects(st, uid, roles) {
  const objs = st.objects || [];
  if (has(roles, ["admin", "financier", "prod_head"])) return objs;
  return objs.filter(function (o) { return objTeam(st, o.id).has(uid); });
}

// ─── Шаг 1: выбор объекта ────────────────────────────────────────────────────
export async function issueStart(env, chat, uid, roles, page) {
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const objs = myObjects(st, uid, roles);
  if (!objs.length) return await sendTg(env, chat, "К вам не привязан ни один объект — задать вопрос не по чему. Это делает админ во вкладке «Договора».");
  const p = Math.max(0, Number(page) || 0);
  const rows = objs.slice(p * PAGE, p * PAGE + PAGE).map(function (o) {
    return [{ text: (o.icon || "🏗") + " " + String(o.name || "Объект").slice(0, 40), callback_data: "i:o:" + o.id }];
  });
  const nav = [];
  if (p > 0) nav.push({ text: "‹ Назад", callback_data: "i:s:" + (p - 1) });
  if ((p + 1) * PAGE < objs.length) nav.push({ text: "Ещё ›", callback_data: "i:s:" + (p + 1) });
  if (nav.length) rows.push(nav);
  return await sendTg(env, chat, "❓ <b>Вопрос по какому объекту?</b>", { reply_markup: { inline_keyboard: rows } });
}

// ─── Шаг 2: тип вопроса ──────────────────────────────────────────────────────
export async function issueKindAsk(env, chat, uid, roles, oid) {
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const o = (st.objects || []).find(function (x) { return x.id === oid; });
  if (!o) return await sendTg(env, chat, "Объект не найден.");
  if (!myObjects(st, uid, roles).some(function (x) { return x.id === oid; })) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const rows = Object.keys(KINDS).map(function (k) {
    return [{ text: KINDS[k].i + " " + KINDS[k].n, callback_data: "i:k:" + oid + ":" + k }];
  });
  return await sendTg(env, chat, "«" + escapeHtml(o.name || "Объект") + "»\n\n<b>Что за вопрос?</b>\n"
    + "📦 <b>Материал</b> — не хватило, нужно докупить\n"
    + "✏️ <b>Изменение</b> — клиент или проект просит поменять\n"
    + "❓ <b>Вопрос</b> — нужно решение, без денег",
    { reply_markup: { inline_keyboard: rows } });
}

export async function issueKindPick(env, chat, uid, roles, oid, kind) {
  if (!KINDS[kind]) return await sendTg(env, chat, "Неизвестный тип вопроса.");
  await dlgSet(env, uid, { mode: "issue", oid: oid, kind: kind, iid: null });
  return await sendTg(env, chat, KINDS[kind].i + " <b>" + KINDS[kind].n + "</b>\n\nОпишите вопрос — текстом или голосовым. Можно приложить фото.\n\n<i>Всё, что пришлёте следом, добавится к этому же вопросу.</i>");
}

// ─── Создание/дополнение тикета ──────────────────────────────────────────────
// Возвращает id тикета: и текст, и голос, и фото попадают сюда, кто бы ни пришёл первым.
async function upsertIssue(env, uid, d, text, tgLink) {
  const st = await snap(env, ["issues", "users"]);
  const issues = Array.isArray(st.issues) ? st.issues : [];
  const me = (st.users || []).find(function (x) { return x.id === uid; });
  if (d.iid) {
    const next = issues.map(function (t) {
      if (t.id !== d.iid) return t;
      const patch = {};
      if (text) patch.text = (t.text && t.text !== "(голосовое сообщение)" ? t.text + " " : "") + text;
      if (tgLink && !t.tgLink) patch.tgLink = tgLink;
      return Object.assign({}, t, patch);
    });
    await saveIssues(env, next);
    return d.iid;
  }
  const iid = "iss" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rec = {
    id: iid, objId: d.oid, wid: "", kind: d.kind, to: (KINDS[d.kind] || KINDS.question).to,
    text: text || "(голосовое сообщение)",
    status: "new", src: "bot", by: uid, byName: (me && me.name) || "", at: stamp(),
  };
  if (tgLink) rec.tgLink = tgLink;
  await saveIssues(env, issues.concat([rec]));
  return iid;
}

// Кто узнаёт о вопросе. Адресаты — по типу: будить всех подряд на «не хватило саморезов»
// значит добиться, что через неделю уведомления отключат все.
async function notifyIssue(env, uid, d, iid, text) {
  const st = await snap(env, ["objects", "users", "contractDocs"]);
  const o = (st.objects || []).find(function (x) { return x.id === d.oid; });
  const me = (st.users || []).find(function (x) { return x.id === uid; });
  const kd = KINDS[d.kind] || KINDS.question;
  const to = addresseeIds(kd.to, d.oid, st.users, st.contractDocs);
  const msg = kd.i + " <b>Вопрос с объекта</b> · " + kd.n + "\n"
    + "«" + escapeHtml((o && o.name) || "Объект") + "»\n"
    + escapeHtml(text || "(голосовое сообщение)") + "\n\n"
    + "<i>" + escapeHtml((me && me.name) || uid) + " · " + stamp() + "</i>";
  const links = await env.DB.prepare("SELECT uid, chat_id FROM tg_links").all();
  for (const l of (links.results || [])) {
    if (l.uid === uid) continue;
    if (!to.has(l.uid)) continue;
    await sendTg(env, l.chat_id, msg);
  }
  await logEvent(env, { uid: uid }, "issues", "add", ((o && o.name) || "Объект") + " › вопрос", kd.n + ": " + String(text || "голосовое").slice(0, 120));
  return iid;
}

async function confirmToAuthor(env, chat, d, iid, st) {
  const o = (st.objects || []).find(function (x) { return x.id === d.oid; });
  return await sendTg(env, chat, "✅ <b>Записал вопрос</b> по объекту «" + escapeHtml((o && o.name) || "Объект") + "».\n"
    + "Отправил тем, кто за это отвечает. Ответ придёт сюда же.\n\n"
    + "<i>Можно дослать фото или голосовое — добавится к этому вопросу.</i>",
    { reply_markup: { inline_keyboard: [[{ text: "❓ Задать ещё вопрос", callback_data: "i:s:0" }]] } });
}

// ─── Медиа: фото и голосовые ─────────────────────────────────────────────────
// В портал не тянем — копия уходит в тему объекта, в тикет попадает ссылка на неё.
export async function issueMedia(env, uid, chat, msg, roles) {
  const d = await dlgGet(env, uid);
  if (!d || d.mode !== "issue") return false;
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const o = (st.objects || []).find(function (x) { return x.id === d.oid; });
  if (!o) { await sendTg(env, chat, "Объект не найден."); return true; }
  if (!myObjects(st, uid, roles).some(function (x) { return x.id === o.id; })) { await sendTg(env, chat, "Этот объект вам недоступен."); return true; }

  const me = (st.users || []).find(function (x) { return x.id === uid; });
  const kd = KINDS[d.kind] || KINDS.question;
  const caption = kd.i + " Вопрос · " + (o.name || "") + " · " + ((me && me.name) || uid);

  const t = await ensureTopic(env, tgBase(env), o.name, o.tgTopicId);
  if (t.error) { await sendTg(env, chat, "Не удалось открыть тему объекта: " + t.error); return true; }
  const mid = await copyToTopic(env, chat, msg.message_id, t.topicId, caption);
  if (!mid) { await sendTg(env, chat, "Telegram не принял файл."); return true; }

  // Тема объекта могла быть создана прямо сейчас — сохраняем её id, иначе следующее
  // сообщение заведёт вторую тему по тому же объекту.
  if (!o.tgTopicId) {
    await saveObjects(env, (st.objects || []).map(function (x) { return x.id !== o.id ? x : Object.assign({}, x, { tgTopicId: t.topicId }); }));
  }

  const link = "https://t.me/c/" + String(env.TG_CHAT_ID || "").replace(/^-100/, "") + "/" + t.topicId + "/" + mid;
  const capText = typeof msg.caption === "string" ? msg.caption.trim() : "";

  // Голосовое расшифровываем в текст: иначе вопрос не найти поиском и не показать
  // в сводке. Подпись к сообщению, если она есть, важнее — её человек написал сам.
  let voiceText = "", voiceWhy = "", voiceParts = 0;
  if (msg.voice && !capText) {
    // Длинную запись режем и распознаём кусками — это заметно дольше одного запроса,
    // поэтому предупреждаем, иначе человек решит, что бот завис.
    if (msg.voice.duration && msg.voice.duration > 45) {
      await sendTg(env, chat, "🎤 Записываю текст с голосового, это займёт несколько секунд…");
    }
    const tr = await transcribeVoice(env, msg.voice.file_id, msg.voice.duration);
    if (tr.ok) { voiceText = tr.text; voiceParts = tr.chunks || 0; }
    else voiceWhy = tr.reason || "";
  }

  const isNew = !d.iid;
  const iid = await upsertIssue(env, uid, d, capText || voiceText, link);
  await dlgSet(env, uid, Object.assign({}, d, { iid: iid }));

  if (isNew) {
    const shown = capText || voiceText
      || (msg.voice ? "(голосовое" + (voiceWhy ? ": " + voiceWhy : "") + ")" : "(фото)");
    await notifyIssue(env, uid, d, iid, shown);
    await confirmToAuthor(env, chat, d, iid, st);
    // Показываем автору, что именно записали с его слов: расшифровка бывает кривой,
    // и поправить её проще сразу, пока он ещё в диалоге.
    if (voiceText) await sendTg(env, chat, "🎤 Расшифровал" + (voiceParts > 1 ? " (запись длинная, склеил из " + voiceParts + " частей)" : "") + ": «" + escapeHtml(voiceText) + "»\n\n<i>Не то? Напишите текстом — допишется к вопросу.</i>");
    else if (msg.voice && voiceWhy) await sendTg(env, chat, "🎤 Голосовое приложено, но текстом не записал: " + escapeHtml(voiceWhy) + ".\n\n<i>Опишите словами, если нужно, чтобы вопрос читался в портале.</i>");
  } else {
    if (msg.voice && voiceText) {
      await sendTg(env, chat, "🎤 Расшифровал и добавил: «" + escapeHtml(voiceText) + "»");
    } else {
      await sendTg(env, chat, (msg.voice ? "🎤 Голосовое" : "📎 Файл") + " добавлен к вопросу"
        + (voiceWhy ? " (текстом не записал: " + escapeHtml(voiceWhy) + ")" : "") + ".");
    }
  }
  return true;
}

// ─── Роутер ──────────────────────────────────────────────────────────────────
export async function issueText(env, uid, chat, text, roles) {
  const t = String(text || "").trim();
  if (t === ISSUE_BTN) { await issueStart(env, chat, uid, roles, 0); return true; }
  const d = await dlgGet(env, uid);
  if (!d || d.mode !== "issue") return false;
  // Выход из диалога: кнопка нижней клавиатуры или команда — это НЕ текст вопроса.
  // Без этой проверки «🏗 Объекты» уехало бы в тикет, а человек остался бы в диалоге.
  if (MAIN_BTNS.indexOf(t) >= 0 || t.charAt(0) === "/") {
    await dlgSet(env, uid, null);
    if (d.iid) await sendTg(env, chat, "Вопрос сохранён. Возвращаемся в меню.");
    return false;
  }
  if (t.length < 3) { await sendTg(env, chat, "Слишком коротко — опишите, что именно нужно решить."); return true; }
  const isNew = !d.iid;
  const iid = await upsertIssue(env, uid, d, t, null);
  await dlgSet(env, uid, Object.assign({}, d, { iid: iid }));
  if (isNew) {
    await notifyIssue(env, uid, d, iid, t);
    await confirmToAuthor(env, chat, d, iid, await snap(env, ["objects"]));
  } else {
    await sendTg(env, chat, "Дописал к вопросу.");
  }
  return true;
}

export async function issueCallback(env, uid, chat, data, roles) {
  const p = String(data || "").split(":");
  if (p[0] !== "i") return false;
  if (p[1] === "s") { await issueStart(env, chat, uid, roles, p[2]); return true; }
  if (p[1] === "o") { await issueKindAsk(env, chat, uid, roles, p[2]); return true; }
  if (p[1] === "k") { await issueKindPick(env, chat, uid, roles, p[2], p[3]); return true; }
  return false;
}

// ─── Ответ из панели → автору в личку ────────────────────────────────────────
// Зовётся эндпоинтом, когда в портале закрывают вопрос. Автор не должен ходить
// проверять портал: он спросил в мессенджере — там же и получает ответ.
export async function issueReplyToAuthor(env, iid) {
  const st = await snap(env, ["issues", "objects", "users"]);
  const t = (st.issues || []).find(function (x) { return x.id === iid; });
  if (!t || !t.by) return { success: false, error: "Вопрос не найден" };
  const link = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE uid=?").bind(t.by).first();
  if (!link || !link.chat_id) return { success: true, sent: false, reason: "У автора не привязан Telegram" };
  const o = (st.objects || []).find(function (x) { return x.id === t.objId; });
  const who = (st.users || []).find(function (x) { return x.id === t.answerBy; });
  const head = t.status === "rejected" ? "✖️ <b>Вопрос отклонён</b>" : "✅ <b>Ответ по вашему вопросу</b>";
  const ok = await sendTg(env, link.chat_id, head + "\n«" + escapeHtml((o && o.name) || "Объект") + "»\n"
    + "<i>" + escapeHtml(String(t.text || "").slice(0, 160)) + "</i>\n\n"
    + escapeHtml(t.answer || "—")
    + (t.linkedNote ? "\n\n➡️ " + escapeHtml(t.linkedNote) : "")
    + (who ? "\n\n<i>" + escapeHtml(who.name) + "</i>" : ""));
  return { success: true, sent: ok };
}
